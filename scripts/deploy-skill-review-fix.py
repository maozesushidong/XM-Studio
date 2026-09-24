"""Deploy the skill-review visibility fix without changing release or client data."""

import hashlib
import json
import os
import posixpath
import shlex
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148").strip()
USER = os.environ.get("XIANMA_SERVER_USER", "root").strip()
PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
REMOTE_ROOT = os.environ.get("XIANMA_REMOTE_ROOT", "/opt/xianma-update-service").rstrip("/")
TARGET_SUBMISSION_ID = os.environ.get(
    "XIANMA_TARGET_SUBMISSION_ID",
    "submission-1787968480593-374d3b4de70e1312735f",
).strip()
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(PROJECT_ROOT, "update-service")
LOCAL_FILES = ["company-skills.js", "v11-platform.js"]


def quoted(value):
    return shlex.quote(str(value))


def run(client, command, *, timeout=180, check=True):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    del stdin
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        raise RuntimeError(f"remote command failed ({status}): {error or output}")
    return output


def read_json(sftp, remote_path):
    try:
        with sftp.open(remote_path, "rb") as source:
            raw = source.read()
    except FileNotFoundError as error:
        raise RuntimeError(f"required remote JSON is missing: {remote_path}") from error
    return json.loads(raw.decode("utf-8", errors="strict")), hashlib.sha256(raw).hexdigest()


def read_optional_json(sftp, remote_path, fallback):
    try:
        with sftp.open(remote_path, "rb") as source:
            raw = source.read()
    except FileNotFoundError:
        return fallback, None
    return json.loads(raw.decode("utf-8", errors="strict")), hashlib.sha256(raw).hexdigest()


def wait_for_health(client, attempts=90):
    health = ""
    for _ in range(attempts):
        health = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
        if '"ok":true' in health and '"v11StorageMode":"postgres"' in health:
            return json.loads(health)
        time.sleep(2)
    raise RuntimeError(f"production health check timed out: {health[:300]}")


def public_api_json(client, path):
    raw = run(client, f"curl -fsS {quoted('http://127.0.0.1:18091' + path)}")
    return json.loads(raw)


def main():
    if not PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = posixpath.join(REMOTE_ROOT, "backups", f"skill-review-fix-{timestamp}")
    temporary_uploads = []
    files_replaced = False
    service_stopped = False

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, auth_timeout=20)
    sftp = client.open_sftp()
    try:
        health_before = wait_for_health(client)
        submissions_path = posixpath.join(REMOTE_ROOT, "data", "skill-submissions.json")
        catalog_path = posixpath.join(REMOTE_ROOT, "data", "company-skills.json")
        releases_path = posixpath.join(REMOTE_ROOT, "data", "releases.json")
        telemetry_path = posixpath.join(REMOTE_ROOT, "data", "telemetry.json")
        submissions, submissions_sha_before = read_json(sftp, submissions_path)
        catalog, catalog_sha_before = read_optional_json(sftp, catalog_path, {"skills": [], "revokedSkillIds": []})
        releases, _ = read_json(sftp, releases_path)
        telemetry, _ = read_json(sftp, telemetry_path)
        target = next((item for item in submissions.get("submissions", []) if item.get("submissionId") == TARGET_SUBMISSION_ID), None)
        if not target:
            raise RuntimeError("the expected pending skill submission is missing before deployment")
        if target.get("status") != "pending":
            raise RuntimeError(f"the expected skill submission is not pending: {target.get('status')}")
        package_path = posixpath.join(REMOTE_ROOT, "data", "skills", "submissions", TARGET_SUBMISSION_ID, "package.zip")
        package_sha_before = run(client, f"sha256sum {quoted(package_path)} | awk '{{print $1}}'")
        before = {
            "submissions": len(submissions.get("submissions", [])),
            "pending": len([item for item in submissions.get("submissions", []) if item.get("status") == "pending"]),
            "companySkills": len(catalog.get("skills", [])),
            "telemetryUsers": len(telemetry.get("users", {})),
            "releases": len(releases.get("releases", [])),
        }

        run(client, f"mkdir -p {quoted(posixpath.join(backup_dir, 'data', 'skills'))}")
        run(client, "docker stop xianma-update-service", timeout=120)
        service_stopped = True
        try:
            for name in ["company-skills.js", "v11-platform.js", ".env"]:
                source = posixpath.join(REMOTE_ROOT, name)
                run(client, f"cp -a {quoted(source)} {quoted(backup_dir)}")
            for name in ["skill-submissions.json", "company-skills.json", "skill-usage.json"]:
                source = posixpath.join(REMOTE_ROOT, "data", name)
                run(client, f"if test -f {quoted(source)}; then cp -a {quoted(source)} {quoted(posixpath.join(backup_dir, 'data'))}; fi")
            submissions_root = posixpath.join(REMOTE_ROOT, "data", "skills", "submissions")
            run(client, f"cp -a {quoted(submissions_root)} {quoted(posixpath.join(backup_dir, 'data', 'skills'))}")
        finally:
            run(client, "docker start xianma-update-service", timeout=120, check=False)
            service_stopped = False
            wait_for_health(client, attempts=45)

        for name in LOCAL_FILES:
            local_path = os.path.join(SERVICE_ROOT, name)
            remote_path = posixpath.join(REMOTE_ROOT, name)
            temporary_path = f"{remote_path}.uploading-{timestamp}"
            sftp.put(local_path, temporary_path)
            with open(local_path, "rb") as source:
                local_sha = hashlib.sha256(source.read()).hexdigest()
            remote_sha = run(client, f"sha256sum {quoted(temporary_path)} | awk '{{print $1}}'")
            if remote_sha != local_sha:
                raise RuntimeError(f"uploaded checksum mismatch: {name}")
            temporary_uploads.append((temporary_path, remote_path))

        for temporary_path, remote_path in temporary_uploads:
            run(client, f"mv -- {quoted(temporary_path)} {quoted(remote_path)}")
        files_replaced = True
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800)
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --no-deps xianma-update-service", timeout=600)
        health_after = wait_for_health(client)

        pending_payload = public_api_json(client, "/api/admin/skill-submissions?status=pending")
        pending_items = pending_payload.get("submissions", [])
        public_target = next((item for item in pending_items if item.get("submissionId") == TARGET_SUBMISSION_ID), None)
        if not public_target:
            raise RuntimeError("the pending skill is still missing from the production review queue")
        serialized_target = json.dumps(public_target, ensure_ascii=False)
        if public_target.get("submitter", {}).get("name") != "内部提交" or public_target.get("submitter", {}).get("department"):
            raise RuntimeError("the pending skill submitter was not anonymized")
        if "林动" in serialized_target:
            raise RuntimeError("the pending skill response leaks the developer nickname")

        detail = public_api_json(client, f"/api/admin/skill-submissions/{TARGET_SUBMISSION_ID}").get("submission", {})
        if detail.get("submissionId") != TARGET_SUBMISSION_ID or detail.get("submitter", {}).get("name") != "内部提交":
            raise RuntimeError("the pending skill detail is unavailable or not anonymized")
        package_sha_api = run(
            client,
            f"curl -fsS {quoted('http://127.0.0.1:18091/api/admin/skill-submissions/' + TARGET_SUBMISSION_ID + '/package')} | sha256sum | awk '{{print $1}}'",
        )
        if package_sha_api != package_sha_before:
            raise RuntimeError("the review package download does not match the stored ZIP")

        overview = public_api_json(client, "/api/admin/v11/overview")
        if int(overview.get("realtime", {}).get("pendingReview", -1)) != before["pending"]:
            raise RuntimeError("the overview pending-review count does not match the review queue")
        release_status = run(client, "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18091/api/admin/releases")
        if release_status != "401":
            raise RuntimeError("release management is no longer password protected")

        submissions_after, submissions_sha_after = read_json(sftp, submissions_path)
        catalog_after, catalog_sha_after = read_optional_json(sftp, catalog_path, {"skills": [], "revokedSkillIds": []})
        releases_after, _ = read_json(sftp, releases_path)
        telemetry_after, _ = read_json(sftp, telemetry_path)
        package_sha_after = run(client, f"sha256sum {quoted(package_path)} | awk '{{print $1}}'")
        after = {
            "submissions": len(submissions_after.get("submissions", [])),
            "pending": len([item for item in submissions_after.get("submissions", []) if item.get("status") == "pending"]),
            "companySkills": len(catalog_after.get("skills", [])),
            "telemetryUsers": len(telemetry_after.get("users", {})),
            "releases": len(releases_after.get("releases", [])),
        }
        if after != before:
            raise RuntimeError(f"production counts changed during deployment: {before} -> {after}")
        catalog_unchanged = catalog_sha_after == catalog_sha_before if catalog_sha_before else not catalog_after.get("skills")
        if submissions_sha_after != submissions_sha_before or not catalog_unchanged or package_sha_after != package_sha_before:
            raise RuntimeError("production skill data changed during code deployment")

        print(json.dumps({
            "deployed": True,
            "service": health_after.get("service"),
            "storageMode": health_after.get("v11StorageMode"),
            "backupDirectory": backup_dir,
            "before": before,
            "after": after,
            "submissionId": TARGET_SUBMISSION_ID,
            "submitter": public_target.get("submitter", {}).get("name"),
            "packageSha256": package_sha_after,
            "healthBefore": health_before.get("ok"),
            "healthAfter": health_after.get("ok"),
        }, ensure_ascii=False))
    except Exception:
        for temporary_path, _ in temporary_uploads:
            run(client, f"rm -f -- {quoted(temporary_path)}", check=False)
        if files_replaced:
            for name in LOCAL_FILES:
                source = posixpath.join(backup_dir, name)
                target = posixpath.join(REMOTE_ROOT, name)
                run(client, f"cp -a {quoted(source)} {quoted(target)}", check=False)
            run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800, check=False)
            run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --no-deps xianma-update-service", timeout=600, check=False)
            wait_for_health(client, attempts=45)
        raise
    finally:
        if service_stopped:
            run(client, "docker start xianma-update-service", timeout=120, check=False)
        sftp.close()
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=os.sys.stderr)
        raise SystemExit(1)

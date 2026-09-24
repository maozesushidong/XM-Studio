"""Migrate one legacy direct-published skill to a verified MAPMS admin identity."""

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
SKILL_ID = os.environ.get("XIANMA_TARGET_SKILL_ID", "").strip()
ADMIN_ID = os.environ.get("XIANMA_MAPMS_ADMIN_ID", "").strip()
ADMIN_USERNAME = os.environ.get("XIANMA_MAPMS_ADMIN_USERNAME", "").strip()
ADMIN_DISPLAY_NAME = os.environ.get("XIANMA_MAPMS_ADMIN_DISPLAY_NAME", "").strip()
EXPECTED_CREATOR_NAME = os.environ.get("XIANMA_EXPECTED_CREATOR_NAME", "平台管理员").strip()


def quoted(value):
    return shlex.quote(str(value))


def run(client, command, *, timeout=180, check=True):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    del stdin
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        raise RuntimeError(error or output)
    return output


def command_sha(client, command):
    output = run(client, command)
    return output.split()[0] if output else ""


def wait_for_health(client, attempts=90):
    last = ""
    for _ in range(attempts):
        last = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
        if '"ok":true' in last:
            return json.loads(last)
        time.sleep(1)
    raise RuntimeError(f"production health check timed out: {last[:300]}")


def read_json(sftp, path):
    with sftp.open(path, "rb") as source:
        return json.loads(source.read().decode("utf-8"))


def write_json_atomic(sftp, path, value, timestamp):
    temporary_path = f"{path}.migrating-{timestamp}"
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with sftp.open(temporary_path, "wb") as target:
        target.write(payload)
        target.flush()
    sftp.posix_rename(temporary_path, path)
    return hashlib.sha256(payload).hexdigest()


def identity():
    return {
        "name": ADMIN_DISPLAY_NAME,
        "realName": ADMIN_DISPLAY_NAME,
        "department": "",
        "adminId": ADMIN_ID,
        "userId": ADMIN_ID,
        "username": ADMIN_USERNAME,
    }


def migrate(catalog, submissions):
    skills = [item for item in catalog.get("skills", []) if item.get("skillId") == SKILL_ID]
    if len(skills) != 1:
        raise RuntimeError(f"expected exactly one target skill, found {len(skills)}")
    skill = skills[0]
    submission_ids = {
        str(version.get("submissionId") or "")
        for version in skill.get("versions", [])
        if version.get("submissionId")
    }
    related = [
        item
        for item in submissions.get("submissions", [])
        if item.get("skillId") == SKILL_ID and item.get("submissionId") in submission_ids
    ]
    if len(related) != 1:
        raise RuntimeError(f"expected exactly one matching submission, found {len(related)}")
    if str(skill.get("creator", {}).get("name") or "") != EXPECTED_CREATOR_NAME:
        raise RuntimeError("target skill creator no longer matches the expected source identity")

    verified_identity = identity()
    skill["creator"] = dict(verified_identity)
    for event in skill.get("auditTrail", []):
        if event.get("action") == "direct-published" and event.get("actor") == EXPECTED_CREATOR_NAME:
            event["actor"] = ADMIN_DISPLAY_NAME

    submission = related[0]
    submission["submitter"] = dict(verified_identity)
    for event in submission.get("auditTrail", []):
        if event.get("action") == "direct-published" and event.get("actor") == EXPECTED_CREATOR_NAME:
            event["actor"] = ADMIN_DISPLAY_NAME
    return submission.get("submissionId")


def main():
    required = {
        "XIANMA_SERVER_PASSWORD": PASSWORD,
        "XIANMA_TARGET_SKILL_ID": SKILL_ID,
        "XIANMA_MAPMS_ADMIN_ID": ADMIN_ID,
        "XIANMA_MAPMS_ADMIN_USERNAME": ADMIN_USERNAME,
        "XIANMA_MAPMS_ADMIN_DISPLAY_NAME": ADMIN_DISPLAY_NAME,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"missing required environment variables: {', '.join(missing)}")

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    catalog_path = posixpath.join(REMOTE_ROOT, "data", "company-skills.json")
    submissions_path = posixpath.join(REMOTE_ROOT, "data", "skill-submissions.json")
    releases_path = posixpath.join(REMOTE_ROOT, "data", "releases.json")
    skills_path = posixpath.join(REMOTE_ROOT, "data", "skills")
    backup_dir = posixpath.join(REMOTE_ROOT, "backups", f"mapms-admin-record-{timestamp}")
    service_stopped = False
    backup_ready = False
    data_written = False

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, auth_timeout=20)
    sftp = client.open_sftp()
    try:
        health_before = wait_for_health(client)
        run(client, "docker stop xianma-update-service", timeout=120)
        service_stopped = True
        run(client, f"mkdir -p {quoted(backup_dir)}")
        run(client, f"cp -a {quoted(catalog_path)} {quoted(posixpath.join(backup_dir, 'company-skills.json'))}")
        run(client, f"cp -a {quoted(submissions_path)} {quoted(posixpath.join(backup_dir, 'skill-submissions.json'))}")
        backup_ready = True

        package_tree_before = command_sha(
            client,
            f"find {quoted(skills_path)} -type f -printf '%P %s %T@\\n' | sort | sha256sum",
        )
        releases_before = command_sha(client, f"sha256sum {quoted(releases_path)}")
        catalog = read_json(sftp, catalog_path)
        submissions = read_json(sftp, submissions_path)
        submission_id = migrate(catalog, submissions)
        catalog_sha = write_json_atomic(sftp, catalog_path, catalog, timestamp)
        submissions_sha = write_json_atomic(sftp, submissions_path, submissions, timestamp)
        data_written = True

        package_tree_after = command_sha(
            client,
            f"find {quoted(skills_path)} -type f -printf '%P %s %T@\\n' | sort | sha256sum",
        )
        releases_after = command_sha(client, f"sha256sum {quoted(releases_path)}")
        if package_tree_before != package_tree_after:
            raise RuntimeError("skill package tree changed unexpectedly")
        if releases_before != releases_after:
            raise RuntimeError("release data changed unexpectedly")

        run(client, "docker start xianma-update-service", timeout=120)
        service_stopped = False
        health_after = wait_for_health(client)
        print(json.dumps({
            "migrated": True,
            "skillId": SKILL_ID,
            "submissionId": submission_id,
            "identity": identity(),
            "backup": backup_dir,
            "catalogSha256": catalog_sha,
            "submissionsSha256": submissions_sha,
            "packageTreeUnchanged": package_tree_before == package_tree_after,
            "releaseDataUnchanged": releases_before == releases_after,
            "healthBefore": health_before.get("ok"),
            "healthAfter": health_after.get("ok"),
        }, ensure_ascii=False))
    except Exception:
        if data_written and backup_ready:
            run(client, f"cp -a {quoted(posixpath.join(backup_dir, 'company-skills.json'))} {quoted(catalog_path)}", check=False)
            run(client, f"cp -a {quoted(posixpath.join(backup_dir, 'skill-submissions.json'))} {quoted(submissions_path)}", check=False)
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

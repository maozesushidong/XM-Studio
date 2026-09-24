"""Deploy direct-publish compatibility and the neutral admin theme safely."""

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
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(PROJECT_ROOT, "update-service")
FILES = [
    ("company-skills.js", "company-skills.js"),
    ("public/admin-v11.html", "public/admin-v11.html"),
    ("public/admin-v11.js", "public/admin-v11.js"),
    ("public/admin-v11-theme.css", "public/admin-v11-theme.css"),
]
DATA_STORES = [
    "skill-submissions.json",
    "company-skills.json",
    "skill-usage.json",
    "releases.json",
    "telemetry.json",
]


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


def wait_for_health(client, attempts=90):
    health = ""
    for _ in range(attempts):
        health = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
        if '"ok":true' in health and '"v11StorageMode":"postgres"' in health:
            return json.loads(health)
        time.sleep(2)
    raise RuntimeError(f"production health check timed out: {health[:300]}")


def remote_sha(client, remote_path):
    return run(
        client,
        f"if test -f {quoted(remote_path)}; then sha256sum {quoted(remote_path)} | awk '{{print $1}}'; else printf missing; fi",
    )


def local_sha(local_path):
    digest = hashlib.sha256()
    with open(local_path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def data_snapshot(client):
    data_root = posixpath.join(REMOTE_ROOT, "data")
    stores = {name: remote_sha(client, posixpath.join(data_root, name)) for name in DATA_STORES}
    skill_tree = run(
        client,
        f"find {quoted(posixpath.join(data_root, 'skills'))} -type f -printf '%P %s\\n' 2>/dev/null | sort | sha256sum | awk '{{print $1}}'",
    )
    return {"stores": stores, "skillTree": skill_tree}


def backup_production(client, backup_dir):
    run(client, f"mkdir -p {quoted(posixpath.join(backup_dir, 'public'))} {quoted(posixpath.join(backup_dir, 'data'))}")
    for _, relative_path in FILES:
        source = posixpath.join(REMOTE_ROOT, relative_path)
        target = posixpath.join(backup_dir, relative_path)
        run(client, f"mkdir -p {quoted(posixpath.dirname(target))} && cp -a {quoted(source)} {quoted(target)}")
    for name in DATA_STORES:
        source = posixpath.join(REMOTE_ROOT, "data", name)
        target = posixpath.join(backup_dir, "data", name)
        run(client, f"if test -f {quoted(source)}; then cp -a {quoted(source)} {quoted(target)}; fi")
    skills_source = posixpath.join(REMOTE_ROOT, "data", "skills")
    skills_backup = posixpath.join(backup_dir, "data", "skills")
    run(client, f"if test -d {quoted(skills_source)}; then cp -al {quoted(skills_source)} {quoted(skills_backup)}; fi")


def restore_code(client, backup_dir):
    for _, relative_path in FILES:
        source = posixpath.join(backup_dir, relative_path)
        target = posixpath.join(REMOTE_ROOT, relative_path)
        run(client, f"cp -a {quoted(source)} {quoted(target)}", check=False)


def verify_deployment(client, expected_hashes):
    for relative_path, expected in expected_hashes.items():
        deployed = remote_sha(client, posixpath.join(REMOTE_ROOT, relative_path))
        if deployed != expected:
            raise RuntimeError(f"deployed checksum mismatch: {relative_path}")
    server_marker = run(client, f"grep -c 'prepareDirectPublishPackage' {quoted(posixpath.join(REMOTE_ROOT, 'company-skills.js'))}")
    admin_html = run(client, "curl -fsS http://127.0.0.1:18091/admin")
    admin_js = run(client, "curl -fsS http://127.0.0.1:18091/admin/v11.js")
    admin_theme = run(client, "curl -fsS http://127.0.0.1:18091/admin/v11-theme.css")
    if int(server_marker or 0) < 1:
        raise RuntimeError("direct-publish normalizer is missing after deployment")
    if "directFolderStatus" not in admin_html or "updateDirectFolderStatus" not in admin_js:
        raise RuntimeError("direct-publish folder feedback is missing after deployment")
    if "background: #f5f6f8" not in admin_theme or "background: #fff;" not in admin_theme:
        raise RuntimeError("neutral admin theme is missing after deployment")


def main():
    if not PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = posixpath.join(REMOTE_ROOT, "backups", f"direct-publish-theme-{timestamp}")
    uploaded = []
    files_replaced = False
    service_stopped = False

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, auth_timeout=20)
    sftp = client.open_sftp()
    try:
        health_before = wait_for_health(client)
        run(client, "docker stop xianma-update-service", timeout=120)
        service_stopped = True
        before = data_snapshot(client)
        backup_production(client, backup_dir)

        expected_hashes = {}
        for local_relative, remote_relative in FILES:
            local_path = os.path.join(SERVICE_ROOT, *local_relative.split("/"))
            if not os.path.isfile(local_path):
                raise RuntimeError(f"deployment file is missing: {local_relative}")
            remote_path = posixpath.join(REMOTE_ROOT, remote_relative)
            temporary_path = f"{remote_path}.uploading-{timestamp}"
            expected_hashes[remote_relative] = local_sha(local_path)
            sftp.put(local_path, temporary_path)
            if remote_sha(client, temporary_path) != expected_hashes[remote_relative]:
                raise RuntimeError(f"uploaded checksum mismatch: {local_relative}")
            uploaded.append((temporary_path, remote_path))

        for temporary_path, remote_path in uploaded:
            run(client, f"mv -- {quoted(temporary_path)} {quoted(remote_path)}")
        files_replaced = True
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800)
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --no-deps xianma-update-service", timeout=600)
        service_stopped = False
        health_after = wait_for_health(client)
        after = data_snapshot(client)
        if before != after:
            raise RuntimeError("production data changed during code deployment")
        verify_deployment(client, expected_hashes)
        release_status = run(client, "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18091/api/admin/releases")
        if release_status != "401":
            raise RuntimeError("release management is no longer password protected")
        print(json.dumps({
            "deployed": True,
            "backupDirectory": backup_dir,
            "healthBefore": health_before.get("ok"),
            "healthAfter": health_after.get("ok"),
            "storageMode": health_after.get("v11StorageMode"),
            "dataUnchanged": before == after,
            "releaseDataUnchanged": before["stores"].get("releases.json") == after["stores"].get("releases.json"),
        }, ensure_ascii=False))
    except Exception:
        for temporary_path, _ in uploaded:
            run(client, f"rm -f -- {quoted(temporary_path)}", check=False)
        if files_replaced:
            restore_code(client, backup_dir)
            run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800, check=False)
            run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --no-deps xianma-update-service", timeout=600, check=False)
            service_stopped = False
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

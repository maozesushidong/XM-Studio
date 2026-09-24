"""Deploy company-skill submission fixes while preserving production data."""

import hashlib
import json
import os
import posixpath
import shlex
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148").strip()
USER = os.environ.get("XIANMA_SERVER_USER", "root").strip()
REMOTE_ROOT = os.environ.get("XIANMA_REMOTE_ROOT", "/opt/xianma-update-service").rstrip("/")
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(PROJECT_ROOT, "update-service")
FILES = [
    ("company-skills.js", "company-skills.js"),
    ("public/admin-v11.js", "public/admin-v11.js"),
]


def quoted(value):
    return shlex.quote(str(value))


def deployment_password():
    configured = os.environ.get("XIANMA_SERVER_PASSWORD", "").strip()
    if configured:
        return configured
    raise RuntimeError("XIANMA_SERVER_PASSWORD is required")


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
        if '"ok":true' in health:
            return json.loads(health)
        time.sleep(2)
    raise RuntimeError(f"production health check timed out: {health[:300]}")


def remote_sha(client, remote_path):
    return run(client, f"if test -f {quoted(remote_path)}; then sha256sum {quoted(remote_path)} | awk '{{print $1}}'; else printf missing; fi")


def data_snapshot(client):
    data_root = posixpath.join(REMOTE_ROOT, "data")
    stores = {}
    for name in ["skill-submissions.json", "company-skills.json", "skill-usage.json"]:
        stores[name] = remote_sha(client, posixpath.join(data_root, name))
    skill_tree = run(client, f"find {quoted(posixpath.join(data_root, 'skills'))} -type f -printf '%P %s\n' 2>/dev/null | sort | sha256sum | awk '{{print $1}}'")
    return {"stores": stores, "skillTree": skill_tree}


def main():
    password = deployment_password()
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = posixpath.join(REMOTE_ROOT, "backups", f"company-skill-delete-{timestamp}")
    uploaded = []
    replaced = False
    service_stopped = False

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20, auth_timeout=20)
    sftp = client.open_sftp()
    try:
        health_before = wait_for_health(client)
        before = data_snapshot(client)
        run(client, f"mkdir -p {quoted(posixpath.join(backup_dir, 'public'))} {quoted(posixpath.join(backup_dir, 'data'))}")
        run(client, f"cp -a {quoted(posixpath.join(REMOTE_ROOT, 'company-skills.js'))} {quoted(posixpath.join(backup_dir, 'company-skills.js'))}")
        run(client, f"cp -a {quoted(posixpath.join(REMOTE_ROOT, 'public', 'admin-v11.js'))} {quoted(posixpath.join(backup_dir, 'public', 'admin-v11.js'))}")
        run(client, "docker stop xianma-update-service", timeout=120)
        service_stopped = True
        try:
            for name in ["skill-submissions.json", "company-skills.json", "skill-usage.json"]:
                source = posixpath.join(REMOTE_ROOT, "data", name)
                run(client, f"if test -f {quoted(source)}; then cp -a {quoted(source)} {quoted(posixpath.join(backup_dir, 'data', name))}; fi")
            skills_source = posixpath.join(REMOTE_ROOT, "data", "skills")
            skills_backup = posixpath.join(backup_dir, "data", "skills")
            run(client, f"if test -d {quoted(skills_source)}; then cp -al {quoted(skills_source)} {quoted(skills_backup)}; fi")
        finally:
            run(client, "docker start xianma-update-service", timeout=120, check=False)
            service_stopped = False
            wait_for_health(client, attempts=45)

        for local_relative, remote_relative in FILES:
            local_path = os.path.join(SERVICE_ROOT, *local_relative.split("/"))
            remote_path = posixpath.join(REMOTE_ROOT, remote_relative)
            temporary_path = f"{remote_path}.uploading-{timestamp}"
            sftp.put(local_path, temporary_path)
            with open(local_path, "rb") as source:
                local_digest = hashlib.sha256(source.read()).hexdigest()
            if remote_sha(client, temporary_path) != local_digest:
                raise RuntimeError(f"uploaded checksum mismatch: {local_relative}")
            uploaded.append((temporary_path, remote_path))

        for temporary_path, remote_path in uploaded:
            run(client, f"mv -- {quoted(temporary_path)} {quoted(remote_path)}")
        replaced = True
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800)
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --no-deps xianma-update-service", timeout=600)
        health_after = wait_for_health(client)
        after = data_snapshot(client)
        if before != after:
            raise RuntimeError("production skill or release data changed during code deployment")
        server_marker = run(client, f"grep -c 'deleteAdminCompanySkill' {quoted(posixpath.join(REMOTE_ROOT, 'company-skills.js'))}")
        admin_marker = run(client, "curl -fsS http://127.0.0.1:18091/admin/v11.js | grep -c 'data-delete-company-skill'")
        if int(server_marker or 0) < 1 or int(admin_marker or 0) < 1:
            raise RuntimeError("deployed deletion endpoints or admin controls are missing")
        print(json.dumps({
            "deployed": True,
            "backupDirectory": backup_dir,
            "healthBefore": health_before.get("ok"),
            "healthAfter": health_after.get("ok"),
            "service": health_after.get("service"),
            "dataUnchanged": before == after,
        }, ensure_ascii=False))
    except Exception:
        for temporary_path, _ in uploaded:
            run(client, f"rm -f -- {quoted(temporary_path)}", check=False)
        if replaced:
            run(client, f"cp -a {quoted(posixpath.join(backup_dir, 'company-skills.js'))} {quoted(posixpath.join(REMOTE_ROOT, 'company-skills.js'))}", check=False)
            run(client, f"cp -a {quoted(posixpath.join(backup_dir, 'public', 'admin-v11.js'))} {quoted(posixpath.join(REMOTE_ROOT, 'public', 'admin-v11.js'))}", check=False)
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
    main()

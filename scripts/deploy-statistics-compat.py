"""Deploy V2 statistics compatibility without changing the admin UI or publishing a client."""

import hashlib
import json
import os
import posixpath
import shlex
import sys
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148").strip()
USER = os.environ.get("XIANMA_SERVER_USER", "root").strip()
PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
REMOTE_ROOT = os.environ.get("XIANMA_REMOTE_ROOT", "/opt/xianma-update-service").rstrip("/")
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(PROJECT_ROOT, "update-service")
FILES = ["server.js", "v11-platform.js", "public/admin-v11.js"]
UNCHANGED_ADMIN_UI_FILES = ["public/admin-v11.html", "public/admin-v11.css"]


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


def local_sha256(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remote_sha256(client, file_path):
    return run(client, f"sha256sum {quoted(file_path)} | awk '{{print $1}}'")


def data_manifest(client):
    data_root = posixpath.join(REMOTE_ROOT, "data")
    return run(
        client,
        f"cd {quoted(data_root)} && find . -type f -printf '%P\\0' | sort -z | xargs -0 -r sha256sum | sha256sum | awk '{{print $1}}'",
    )


def wait_for_health(client, attempts=90):
    health = ""
    for _ in range(attempts):
        health = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
        if '"ok":true' in health and '"v11StorageMode":"postgres"' in health:
            return json.loads(health)
        time.sleep(2)
    raise RuntimeError(f"production health check timed out: {health[:300]}")


def backup(client, backup_dir):
    code_root = posixpath.join(backup_dir, "code")
    run(client, f"mkdir -p {quoted(code_root)}")
    for relative_path in FILES:
        source = posixpath.join(REMOTE_ROOT, relative_path)
        target = posixpath.join(code_root, relative_path)
        run(client, f"mkdir -p {quoted(posixpath.dirname(target))} && cp -a {quoted(source)} {quoted(target)}")
    run(client, f"cp -a {quoted(posixpath.join(REMOTE_ROOT, '.env'))} {quoted(posixpath.join(backup_dir, '.env'))}")
    run(client, f"cp -a {quoted(posixpath.join(REMOTE_ROOT, 'data'))} {quoted(posixpath.join(backup_dir, 'data'))}", timeout=1800)
    dump_path = posixpath.join(backup_dir, "xianma-studio-postgres.dump")
    run(
        client,
        f"docker exec xianma-update-postgres pg_dump -U xianma_studio -d xianma_studio --format=custom > {quoted(dump_path)}",
        timeout=1800,
    )
    run(client, f"docker exec -i xianma-update-postgres pg_restore --list < {quoted(dump_path)} >/dev/null", timeout=1800)
    return {"directory": backup_dir, "postgresDumpSha256": remote_sha256(client, dump_path)}


def restore_code(client, backup_dir):
    for relative_path in FILES:
        source = posixpath.join(backup_dir, "code", relative_path)
        target = posixpath.join(REMOTE_ROOT, relative_path)
        run(client, f"cp -a {quoted(source)} {quoted(target)}", check=False)


def main():
    if not PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = posixpath.join(REMOTE_ROOT, "backups", f"statistics-compat-{timestamp}")
    uploaded = []
    files_replaced = False
    service_stopped = False

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, auth_timeout=20)
    sftp = client.open_sftp()
    try:
        health_before = wait_for_health(client)
        unchanged_admin_hashes_before = {
            item: remote_sha256(client, posixpath.join(REMOTE_ROOT, item)) for item in UNCHANGED_ADMIN_UI_FILES
        }
        run(client, "docker stop xianma-update-service", timeout=120)
        service_stopped = True
        data_before = data_manifest(client)
        backup_result = backup(client, backup_dir)

        expected_hashes = {}
        for relative_path in FILES:
            local_path = os.path.join(SERVICE_ROOT, *relative_path.split("/"))
            remote_path = posixpath.join(REMOTE_ROOT, relative_path)
            temporary_path = f"{remote_path}.uploading-{timestamp}"
            expected_hashes[relative_path] = local_sha256(local_path)
            sftp.put(local_path, temporary_path)
            if remote_sha256(client, temporary_path) != expected_hashes[relative_path]:
                raise RuntimeError(f"uploaded checksum mismatch: {relative_path}")
            uploaded.append((temporary_path, remote_path))
        for temporary_path, remote_path in uploaded:
            run(client, f"mv -- {quoted(temporary_path)} {quoted(remote_path)}")
        files_replaced = True
        if data_manifest(client) != data_before:
            raise RuntimeError("production data changed while the application service was stopped")

        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800)
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --no-deps xianma-update-service", timeout=600)
        service_stopped = False
        health_after = wait_for_health(client)

        for relative_path, expected_hash in expected_hashes.items():
            if remote_sha256(client, posixpath.join(REMOTE_ROOT, relative_path)) != expected_hash:
                raise RuntimeError(f"deployed checksum mismatch: {relative_path}")
        unchanged_admin_hashes_after = {
            item: remote_sha256(client, posixpath.join(REMOTE_ROOT, item)) for item in UNCHANGED_ADMIN_UI_FILES
        }
        if unchanged_admin_hashes_after != unchanged_admin_hashes_before:
            raise RuntimeError("administrator HTML or CSS changed during statistics display deployment")
        platform_source = run(client, f"cat {quoted(posixpath.join(REMOTE_ROOT, 'v11-platform.js'))}")
        server_source = run(client, f"cat {quoted(posixpath.join(REMOTE_ROOT, 'server.js'))}")
        if not all(marker in platform_source for marker in ["recordLegacyTelemetryEvents", "legacyResidual", "LEGACY_USAGE_MODULES"]):
            raise RuntimeError("deployed statistics compatibility markers are incomplete")
        if 'compareVersions(clientVersion, "2.0.0") < 0' not in server_source:
            raise RuntimeError("deployed client-version compatibility guard is missing")
        admin_source = run(client, "curl -fsS http://127.0.0.1:18091/admin/v11.js")
        if not all(marker in admin_source for marker in ["<h3>功能使用排行</h3></div>", "rankingModules.length"]):
            raise RuntimeError("deployed module ranking does not use the requested display")
        release_status = run(client, "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18091/api/admin/releases")
        if release_status != "401":
            raise RuntimeError("release management is no longer password protected")

        print(json.dumps({
            "deployed": True,
            "clientPublished": False,
            "adminUiChanged": "module-ranking-copy-only",
            "backup": backup_result,
            "healthBefore": health_before.get("ok"),
            "healthAfter": health_after.get("ok"),
            "storageMode": health_after.get("v11StorageMode"),
            "files": FILES,
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
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

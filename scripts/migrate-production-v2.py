"""Migrate the production update service to the V2 management stack safely."""

import hashlib
import json
import os
import posixpath
import secrets
import stat
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148")
USER = os.environ.get("XIANMA_SERVER_USER", "root")
PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
REMOTE_ROOT = os.environ.get("XIANMA_REMOTE_ROOT", "/opt/xianma-update-service")
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(PROJECT_ROOT, "update-service")


def run(client, command, *, timeout=120, check=True):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    del stdin
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        raise RuntimeError(f"remote command failed ({status}): {error or output}")
    return output


def parse_env(text):
    values = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def render_env(original, updates):
    keys = set(updates)
    lines = [line for line in original.splitlines() if line.split("=", 1)[0].strip() not in keys]
    lines.extend(f"{key}={json.dumps(value, ensure_ascii=False)}" for key, value in updates.items())
    return "\n".join(lines).rstrip() + "\n"


def merge_csv(current, additions):
    values = []
    for value in str(current or "").replace(";", ",").split(","):
        value = value.strip()
        if value and value not in values:
            values.append(value)
    for value in additions:
        value = str(value or "").strip()
        if value and value not in values:
            values.append(value)
    return ",".join(values)


def developer_identifiers(telemetry):
    identifiers = []
    for user_key, user in (telemetry.get("users") or {}).items():
        names = [
            user.get("name"), user.get("nickname"), user.get("nickName"),
            user.get("displayName"), user.get("realName"), user.get("dingtalkRealName"),
            user.get("dingtalkNickname"),
        ]
        if "林动" not in {str(value or "").strip() for value in names}:
            continue
        mapms = user.get("mapms") or {}
        identifiers.extend([
            user_key, user.get("userId"), user.get("dingtalkUserId"),
            mapms.get("userId"), mapms.get("userNo"),
        ])
    return [str(value).strip() for value in identifiers if str(value or "").strip()]


def file_manifest():
    relative = [
        ".dockerignore",
        "Dockerfile",
        "docker-compose.yml",
        "package.json",
        "package-lock.json",
        "server.js",
        "company-skills.js",
        "v11-platform.js",
        "v11-store.js",
        "scripts/migrate-v11-json-to-postgres.js",
        "public/admin-v11.html",
        "public/admin-v11.css",
        "public/admin-v11-theme.css",
        "public/admin-v11.js",
        "public/admin-v11-icon.png",
    ]
    files = []
    for item in relative:
        local_path = os.path.join(SERVICE_ROOT, *item.split("/"))
        if not os.path.isfile(local_path):
            raise RuntimeError(f"deployment file is missing: {item}")
        files.append((local_path, posixpath.join(REMOTE_ROOT, item)))
    return files


def production_counts(telemetry, releases):
    return {
        "telemetryUsers": len(telemetry.get("users") or {}),
        "releases": len(releases.get("releases") or []),
        "publishedReleases": len([item for item in (releases.get("releases") or []) if item.get("status") == "published"]),
    }


def main():
    if not PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    existing_archive = os.environ.get("XIANMA_EXISTING_BACKUP_ARCHIVE", "").strip()
    existing_backup_dir = os.environ.get("XIANMA_EXISTING_BACKUP_DIRECTORY", "").strip()
    expected_backup_sha256 = os.environ.get("XIANMA_EXISTING_BACKUP_SHA256", "").strip().lower()
    reuse_backup = bool(existing_archive and existing_backup_dir and expected_backup_sha256)
    backup_dir = existing_backup_dir if reuse_backup else posixpath.join(REMOTE_ROOT, "backups", f"production-v2-{timestamp}")
    snapshot_dir = posixpath.join(backup_dir, "snapshot")
    archive_path = existing_archive if reuse_backup else f"/root/xianma-update-production-v2-{timestamp}.tar.gz"
    uploaded = []
    files_replaced = False
    switched = False

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15, auth_timeout=15)
    sftp = client.open_sftp()
    try:
        free_bytes = int(run(client, f"df -Pk {json.dumps(REMOTE_ROOT)} | awk 'NR==2 {{print $4 * 1024}}'"))
        data_bytes = int(run(client, f"du -sb {json.dumps(posixpath.join(REMOTE_ROOT, 'data'))} | awk '{{print $1}}'"))
        if free_bytes < data_bytes + 3 * 1024 * 1024 * 1024:
            raise RuntimeError("production server does not have enough free space for a verified backup")

        with sftp.open(posixpath.join(REMOTE_ROOT, "data", "telemetry.json"), "r") as source:
            telemetry = json.loads(source.read().decode("utf-8"))
        with sftp.open(posixpath.join(REMOTE_ROOT, "data", "releases.json"), "r") as source:
            releases = json.loads(source.read().decode("utf-8"))
        before_counts = production_counts(telemetry, releases)
        mutable_root_files = [
            entry.filename for entry in sftp.listdir_attr(posixpath.join(REMOTE_ROOT, "data"))
            if stat.S_ISREG(entry.st_mode)
        ]

        if reuse_backup:
            if run(client, f"test -d {json.dumps(backup_dir)} && test -f {json.dumps(archive_path)}; printf '%s' $?") != "0":
                raise RuntimeError("the requested verified production backup is unavailable")
            archive_sha256 = run(client, f"sha256sum {json.dumps(archive_path)} | awk '{{print $1}}'").lower()
            if archive_sha256 != expected_backup_sha256:
                raise RuntimeError("the requested production backup checksum does not match")
            run(client, f"rm -rf -- {json.dumps(snapshot_dir)}")
        else:
            run(client, f"mkdir -p {json.dumps(backup_dir)}")
            run(client, f"cp -a {json.dumps(posixpath.join(REMOTE_ROOT, '.env'))} {json.dumps(posixpath.join(backup_dir, '.env'))}")
            for name in ["docker-compose.yml", "package.json", "server.js", "company-skills.js", "public"]:
                source = posixpath.join(REMOTE_ROOT, name)
                run(client, f"if test -e {json.dumps(source)}; then cp -a {json.dumps(source)} {json.dumps(backup_dir)}; fi")

            run(client, "docker stop xianma-update-service", timeout=120)
            try:
                run(client, f"mkdir -p {json.dumps(snapshot_dir)}")
                run(client, f"cp -al {json.dumps(posixpath.join(REMOTE_ROOT, 'data'))} {json.dumps(posixpath.join(snapshot_dir, 'data'))}")
                run(client, f"cp -a {json.dumps(posixpath.join(REMOTE_ROOT, 'secrets'))} {json.dumps(posixpath.join(snapshot_dir, 'secrets'))}")
                for name in mutable_root_files:
                    source = posixpath.join(REMOTE_ROOT, "data", name)
                    target = posixpath.join(snapshot_dir, "data", name)
                    detached = f"{target}.detached"
                    run(client, f"cp --reflink=auto --preserve=all {json.dumps(source)} {json.dumps(detached)} && mv -- {json.dumps(detached)} {json.dumps(target)}")
            finally:
                run(client, "docker start xianma-update-service", timeout=120, check=False)
                service_restored = False
                for _ in range(30):
                    if '"ok":true' in run(client, "curl -fsS http://127.0.0.1:18091/health", check=False):
                        service_restored = True
                        break
                    time.sleep(1)
                if not service_restored:
                    raise RuntimeError("production service did not recover after creating the backup snapshot")

            run(
                client,
                f"tar -C {json.dumps(snapshot_dir)} -czf {json.dumps(archive_path)} data secrets",
                timeout=1800,
            )
            run(client, f"tar -tzf {json.dumps(archive_path)} >/dev/null", timeout=1800)
            archive_sha256 = run(client, f"sha256sum {json.dumps(archive_path)} | awk '{{print $1}}'")
            run(client, f"rm -rf -- {json.dumps(snapshot_dir)}")

        for local_path, remote_path in file_manifest():
            parent = posixpath.dirname(remote_path)
            run(client, f"mkdir -p {json.dumps(parent)}")
            temporary_path = f"{remote_path}.uploading-{timestamp}"
            sftp.put(local_path, temporary_path)
            uploaded.append((temporary_path, remote_path))

        env_path = posixpath.join(REMOTE_ROOT, ".env")
        with sftp.open(env_path, "r") as source:
            env_text = source.read().decode("utf-8", errors="replace")
        env_values = parse_env(env_text)
        postgres_password = env_values.get("POSTGRES_PASSWORD") or secrets.token_urlsafe(32)
        updates = {
            "POSTGRES_PASSWORD": postgres_password,
            "MAPMS_USER_REMARK": "桌面端注册",
            "ENABLE_COMPANY_SKILL_PLATFORM": "1",
            "COMPANY_SKILL_ADMIN_PUBLIC": "1",
            "ENABLE_V11_ADMIN_UI": "1",
            "V11_MANAGEMENT_PUBLIC": "1",
            "TELEMETRY_EXCLUDED_NAMES": merge_csv(env_values.get("TELEMETRY_EXCLUDED_NAMES"), ["林动"]),
            "TELEMETRY_EXCLUDED_IDENTIFIERS": merge_csv(
                env_values.get("TELEMETRY_EXCLUDED_IDENTIFIERS"),
                developer_identifiers(telemetry),
            ),
            "UPDATE_NEXT_INTERNAL_VERSION": "2.0.0",
        }
        temporary_env = f"{env_path}.uploading-{timestamp}"
        with sftp.open(temporary_env, "w") as target:
            target.write(render_env(env_text, updates).encode("utf-8"))

        for temporary_path, remote_path in uploaded:
            run(client, f"mv -- {json.dumps(temporary_path)} {json.dumps(remote_path)}")
        run(client, f"mv -- {json.dumps(temporary_env)} {json.dumps(env_path)}")
        files_replaced = True

        run(client, f"cd {json.dumps(REMOTE_ROOT)} && docker compose build xianma-update-service", timeout=1800)
        switched = True
        run(client, f"cd {json.dumps(REMOTE_ROOT)} && docker compose up -d", timeout=600)

        health = ""
        for _ in range(90):
            health = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
            if '"ok":true' in health and '"v11StorageMode":"postgres"' in health:
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"production health check timed out: {health[:300]}")

        admin_html = run(client, "curl -fsS http://127.0.0.1:18091/admin")
        theme_css = run(client, "curl -fsS http://127.0.0.1:18091/admin/v11-theme.css")
        overview = json.loads(run(client, "curl -fsS http://127.0.0.1:18091/api/admin/v11/overview"))
        release_status = run(client, "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18091/api/admin/releases")
        if "XMAI Studio" not in admin_html or "admin/v11-theme.css" not in admin_html:
            raise RuntimeError("production admin page did not switch to V2")
        if "#d9353f" not in theme_css.lower():
            raise RuntimeError("production admin theme is unavailable")
        if release_status != "401":
            raise RuntimeError("release management is not password protected")
        if int((overview.get("period") or {}).get("tasks") or 0) != 0:
            raise RuntimeError("new task statistics did not start from zero")

        with sftp.open(posixpath.join(REMOTE_ROOT, "data", "telemetry.json"), "r") as source:
            telemetry_after = json.loads(source.read().decode("utf-8"))
        with sftp.open(posixpath.join(REMOTE_ROOT, "data", "releases.json"), "r") as source:
            releases_after = json.loads(source.read().decode("utf-8"))
        after_counts = production_counts(telemetry_after, releases_after)
        if after_counts != before_counts:
            raise RuntimeError(f"production data counts changed during migration: {before_counts} -> {after_counts}")

        print(json.dumps({
            "migrated": True,
            "host": HOST,
            "service": "xianma-update-service",
            "storageMode": "postgres",
            "backupDirectory": backup_dir,
            "backupArchive": archive_path,
            "backupSha256": archive_sha256,
            "before": before_counts,
            "after": after_counts,
            "newStatistics": {
                "tasks": (overview.get("period") or {}).get("tasks", 0),
                "modules": len(overview.get("modules") or []),
            },
        }, ensure_ascii=False))
    except Exception:
        for temporary_path, _ in uploaded:
            run(client, f"rm -f -- {json.dumps(temporary_path)}", check=False)
        if files_replaced:
            run(client, f"cp -a {json.dumps(posixpath.join(backup_dir, '.env'))} {json.dumps(posixpath.join(REMOTE_ROOT, '.env'))}", check=False)
            for name in ["docker-compose.yml", "package.json", "server.js", "company-skills.js"]:
                source = posixpath.join(backup_dir, name)
                target = posixpath.join(REMOTE_ROOT, name)
                run(client, f"if test -e {json.dumps(source)}; then cp -a {json.dumps(source)} {json.dumps(target)}; fi", check=False)
            run(client, f"rm -rf -- {json.dumps(posixpath.join(REMOTE_ROOT, 'public'))} && cp -a {json.dumps(posixpath.join(backup_dir, 'public'))} {json.dumps(posixpath.join(REMOTE_ROOT, 'public'))}", check=False)
            if switched:
                run(client, f"cd {json.dumps(REMOTE_ROOT)} && docker compose up -d --force-recreate xianma-update-service", timeout=600, check=False)
        raise
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=os.sys.stderr)
        raise SystemExit(1)

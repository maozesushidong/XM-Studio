"""Deploy the isolated XMAI client download service without touching the main service."""

import hashlib
import os
import posixpath
import shlex
import sys
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148").strip()
USER = os.environ.get("XIANMA_SERVER_USER", "root").strip()
SSH_PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
DOWNLOAD_PASSWORD = os.environ.get("XMAI_DOWNLOAD_ADMIN_PASSWORD", "").strip()
REMOTE_ROOT = "/opt/xmai-client-download-service"
REMOTE_NGINX = "/etc/nginx/conf.d/rencaipandian.conf"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(PROJECT_ROOT, "standalone-download-service")
FILES = ["server.js", "Dockerfile", "docker-compose.yml", "public/admin.html", "public/admin.js"]


def quoted(value):
    return shlex.quote(str(value))


def run(client, command, timeout=180, check=True):
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


def main():
    if not SSH_PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    if not DOWNLOAD_PASSWORD or len(DOWNLOAD_PASSWORD) < 12:
        raise RuntimeError("XMAI_DOWNLOAD_ADMIN_PASSWORD must contain at least 12 characters")

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_root = f"/opt/xmai-client-download-service-backups/{timestamp}"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=SSH_PASSWORD, timeout=20, auth_timeout=20)
    sftp = client.open_sftp()
    nginx_replaced = False
    try:
        run(client, f"mkdir -p {quoted(REMOTE_ROOT + '/public')} {quoted(REMOTE_ROOT + '/data')} {quoted(backup_root)}")
        run(client, f"if test -f {quoted(REMOTE_NGINX)}; then cp -a {quoted(REMOTE_NGINX)} {quoted(backup_root + '/xmai-client-download.conf')}; fi")
        for relative in FILES:
            remote_path = posixpath.join(REMOTE_ROOT, relative)
            if run(client, f"test -f {quoted(remote_path)} && echo present", check=False) == "present":
                run(client, f"mkdir -p {quoted(posixpath.dirname(posixpath.join(backup_root, relative)))} && cp -a {quoted(remote_path)} {quoted(posixpath.join(backup_root, relative))}")
            local_path = os.path.join(SERVICE_ROOT, *relative.split("/"))
            temporary = f"{remote_path}.uploading-{timestamp}"
            sftp.put(local_path, temporary)
            if run(client, f"sha256sum {quoted(temporary)} | awk '{{print $1}}'") != local_sha256(local_path):
                raise RuntimeError(f"checksum mismatch: {relative}")
            run(client, f"mv -- {quoted(temporary)} {quoted(remote_path)}")

        env_body = f"ADMIN_PASSWORD={DOWNLOAD_PASSWORD}\nPUBLIC_BASE_URL=http://{HOST}/xmai-download\n"
        env_path = posixpath.join(REMOTE_ROOT, ".env")
        if run(client, f"test -f {quoted(env_path)} && echo present", check=False) == "present":
            run(client, f"cp -a {quoted(env_path)} {quoted(backup_root + '/.env')}")
        with sftp.open(env_path + f".uploading-{timestamp}", "w") as target:
            target.write(env_body)
        run(client, f"mv -- {quoted(env_path + f'.uploading-{timestamp}')} {quoted(env_path)} && chmod 600 {quoted(env_path)}")

        nginx_local = os.path.join(SERVICE_ROOT, "nginx-path.conf")
        nginx_temporary = f"{REMOTE_NGINX}.uploading-{timestamp}"
        sftp.put(nginx_local, nginx_temporary)
        run(client, f"mv -- {quoted(nginx_temporary)} {quoted(REMOTE_NGINX)}")
        nginx_replaced = True
        run(client, "nginx -t && systemctl reload nginx", timeout=120)
        run(client, f"cd {quoted(REMOTE_ROOT)} && docker compose up -d --build --force-recreate", timeout=1800)
        health = run(client, "curl -fsS http://127.0.0.1:18093/health", timeout=60)
        public_health = run(client, "curl -fsS -H 'Host: 47.96.184.148' http://127.0.0.1/xmai-download/health", timeout=60)
        unauthorized = run(client, "curl -sS -o /dev/null -w '%{http_code}' -H 'Host: 47.96.184.148' http://127.0.0.1/xmai-download/api/admin/resources", timeout=60)
        if '"ok":true' not in health or '"ok":true' not in public_health or unauthorized != "401":
            raise RuntimeError(f"standalone download service verification failed: {health} / {public_health} / {unauthorized}")
        print(f"{{\"deployed\":true,\"address\":\"http://{HOST}/xmai-download/\",\"admin\":\"http://{HOST}/xmai-download/admin\",\"download\":\"每个资源上传后生成独立下载地址\",\"clientPublished\":false,\"backup\":\"{backup_root}\"}}")
    except Exception:
        if nginx_replaced:
            run(client, f"if test -f {quoted(backup_root + '/xmai-client-download.conf')}; then cp -a {quoted(backup_root + '/xmai-client-download.conf')} {quoted(REMOTE_NGINX)}; nginx -t && systemctl reload nginx; fi", check=False)
        raise
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

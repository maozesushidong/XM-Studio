"""Rotate the update-service admin token without storing credentials in source."""

import json
import os
import posixpath
import sys
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148")
USER = os.environ.get("XIANMA_SERVER_USER", "root")
PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
NEW_TOKEN = os.environ.get("XIANMA_NEW_UPDATE_ADMIN_TOKEN", "")
REMOTE_ROOT = os.environ.get("XIANMA_UPDATE_SERVICE_ROOT", "/opt/xianma-update-service")


def run(client, command, check=True):
    stdin, stdout, stderr = client.exec_command(command, timeout=90)
    del stdin
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        raise RuntimeError(error or output or f"remote command failed: {status}")
    return output, status


def main():
    if not PASSWORD or not NEW_TOKEN:
        raise RuntimeError("server password and new admin token are required")
    if "\n" in NEW_TOKEN or "\r" in NEW_TOKEN:
        raise RuntimeError("admin token contains invalid characters")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15, auth_timeout=15)
    sftp = client.open_sftp()
    env_path = posixpath.join(REMOTE_ROOT, ".env")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_path = f"{env_path}.backup-{timestamp}"
    temporary_path = f"{env_path}.uploading-{timestamp}"
    try:
        with sftp.open(env_path, "r") as source:
            text = source.read().decode("utf-8", errors="strict")
        lines = [line for line in text.splitlines() if not line.startswith("UPDATE_ADMIN_TOKEN=")]
        lines.append(f"UPDATE_ADMIN_TOKEN={NEW_TOKEN}")
        run(client, f"cp -- {json.dumps(env_path)} {json.dumps(backup_path)}")
        with sftp.open(temporary_path, "w") as target:
            target.write(("\n".join(lines).rstrip() + "\n").encode("utf-8"))
        run(client, f"mv -- {json.dumps(temporary_path)} {json.dumps(env_path)}")
        run(client, f"cd -- {json.dumps(REMOTE_ROOT)} && docker compose up -d --force-recreate xianma-update-service")
        for _ in range(30):
            health, _ = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
            if '"ok":true' in health:
                break
            time.sleep(1)
        else:
            raise RuntimeError("service health check timed out")
        print(json.dumps({"rotated": True, "service": "xianma-update-service", "backupCreated": True}))
    except Exception:
        run(client, f"cp -- {json.dumps(backup_path)} {json.dumps(env_path)}", check=False)
        run(client, f"cd -- {json.dumps(REMOTE_ROOT)} && docker compose up -d --force-recreate xianma-update-service", check=False)
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

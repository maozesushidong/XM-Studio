"""Deploy the update/telemetry service without storing server credentials."""

import json
import os
import posixpath
import sys
import time

import paramiko


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148")
USER = os.environ.get("XIANMA_SERVER_USER", "root")
PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
TELEMETRY_CORP_ID = os.environ.get("XIANMA_TELEMETRY_CORP_ID", "").strip()
FRAME_ANCESTORS = os.environ.get("XIANMA_ADMIN_FRAME_ANCESTORS", "").strip()
MAPMS_BASE_URL = os.environ.get("XIANMA_MAPMS_BASE_URL", "").strip()
MAPMS_API_KEY = os.environ.get("XIANMA_MAPMS_API_KEY", "").strip()
MAPMS_API_SECRET = os.environ.get("XIANMA_MAPMS_API_SECRET", "").strip()
MAPMS_USER_REMARK = os.environ.get("XIANMA_MAPMS_USER_REMARK", "").strip()
MAPMS_ADMIN_BASE_URL = os.environ.get("XIANMA_MAPMS_ADMIN_BASE_URL", "").strip()
MAPMS_ADMIN_USERNAME = os.environ.get("XIANMA_MAPMS_ADMIN_USERNAME", "").strip()
MAPMS_ADMIN_PASSWORD = os.environ.get("XIANMA_MAPMS_ADMIN_PASSWORD", "")
DINGTALK_APP_KEY = os.environ.get("XIANMA_DINGTALK_APP_KEY", "").strip()
DINGTALK_APP_SECRET = os.environ.get("XIANMA_DINGTALK_APP_SECRET", "").strip()
MODEL_GATEWAY_GPT_BASE_URL = os.environ.get("XIANMA_MODEL_GATEWAY_GPT_BASE_URL", "").strip()
MODEL_GATEWAY_GPT_API_KEY = os.environ.get("XIANMA_MODEL_GATEWAY_GPT_API_KEY", "").strip()
MODEL_GATEWAY_GPT_DEFAULT_MODEL = os.environ.get("XIANMA_MODEL_GATEWAY_GPT_DEFAULT_MODEL", "").strip()
MODEL_GATEWAY_FALLBACK_BASE_URL = os.environ.get("XIANMA_MODEL_GATEWAY_FALLBACK_BASE_URL", "").strip()
MODEL_GATEWAY_FALLBACK_API_KEY = os.environ.get("XIANMA_MODEL_GATEWAY_FALLBACK_API_KEY", "").strip()
MODEL_GATEWAY_FALLBACK_MODEL = os.environ.get("XIANMA_MODEL_GATEWAY_FALLBACK_MODEL", "").strip()
MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS = os.environ.get("XIANMA_MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS", "").strip()
MODEL_GATEWAY_GPT_MAX_CONCURRENCY = os.environ.get("XIANMA_MODEL_GATEWAY_GPT_MAX_CONCURRENCY", "").strip()
ENABLE_COMPANY_SKILL_PLATFORM = os.environ.get("XIANMA_ENABLE_COMPANY_SKILL_PLATFORM", "").strip()
COMPANY_SKILL_ADMIN_PUBLIC = os.environ.get("XIANMA_COMPANY_SKILL_ADMIN_PUBLIC", "").strip()
COMPANY_SKILL_ADMIN_PREVIEW_PATH = os.environ.get("XIANMA_COMPANY_SKILL_ADMIN_PREVIEW_PATH", "").strip()
DEPLOY_ADMIN_UI = os.environ.get("XIANMA_DEPLOY_ADMIN_UI", "0") == "1"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(client, command, check=True):
    stdin, stdout, stderr = client.exec_command(command, timeout=60)
    del stdin
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        raise RuntimeError(f"remote command failed ({status}): {error or output}")
    return output


def main():
    if not PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    environment_updates = {
        key: value for key, value in {
            "TELEMETRY_ALLOWED_CORP_ID": TELEMETRY_CORP_ID,
            "ADMIN_FRAME_ANCESTORS": FRAME_ANCESTORS,
            "MAPMS_BASE_URL": MAPMS_BASE_URL,
            "MAPMS_API_KEY": MAPMS_API_KEY,
            "MAPMS_API_SECRET": MAPMS_API_SECRET,
            "MAPMS_USER_REMARK": MAPMS_USER_REMARK,
            "MAPMS_ADMIN_BASE_URL": MAPMS_ADMIN_BASE_URL,
            "MAPMS_ADMIN_USERNAME": MAPMS_ADMIN_USERNAME,
            "MAPMS_ADMIN_PASSWORD": MAPMS_ADMIN_PASSWORD,
            "DINGTALK_APP_KEY": DINGTALK_APP_KEY,
            "DINGTALK_APP_SECRET": DINGTALK_APP_SECRET,
            "MODEL_GATEWAY_GPT_BASE_URL": MODEL_GATEWAY_GPT_BASE_URL,
            "MODEL_GATEWAY_GPT_API_KEY": MODEL_GATEWAY_GPT_API_KEY,
            "MODEL_GATEWAY_GPT_DEFAULT_MODEL": MODEL_GATEWAY_GPT_DEFAULT_MODEL,
            "MODEL_GATEWAY_FALLBACK_BASE_URL": MODEL_GATEWAY_FALLBACK_BASE_URL,
            "MODEL_GATEWAY_FALLBACK_API_KEY": MODEL_GATEWAY_FALLBACK_API_KEY,
            "MODEL_GATEWAY_FALLBACK_MODEL": MODEL_GATEWAY_FALLBACK_MODEL,
            "MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS": MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS,
            "MODEL_GATEWAY_GPT_MAX_CONCURRENCY": MODEL_GATEWAY_GPT_MAX_CONCURRENCY,
            "ENABLE_COMPANY_SKILL_PLATFORM": ENABLE_COMPANY_SKILL_PLATFORM,
            "COMPANY_SKILL_ADMIN_PUBLIC": COMPANY_SKILL_ADMIN_PUBLIC,
            "COMPANY_SKILL_ADMIN_PREVIEW_PATH": COMPANY_SKILL_ADMIN_PREVIEW_PATH,
        }.items() if value
    }
    if any("\n" in value or "\r" in value for value in environment_updates.values()):
        raise RuntimeError("deployment environment contains invalid characters")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15, auth_timeout=15)
    sftp = client.open_sftp()
    backups = []
    remote_server = None
    try:
        mounts = json.loads(run(client, "docker inspect xianma-update-service --format '{{json .Mounts}}'"))
        mount_by_destination = {item.get("Destination"): item.get("Source") for item in mounts}
        remote_server = mount_by_destination.get("/app/server.js")
        remote_public = mount_by_destination.get("/app/public")
        remote_data = mount_by_destination.get("/data")
        if not remote_server or not remote_public or not remote_data:
            raise RuntimeError("unable to resolve existing update-service bind mounts")

        timestamp = time.strftime("%Y%m%d-%H%M%S")
        remote_root = posixpath.dirname(remote_server)
        files = [
            (os.path.join(PROJECT_ROOT, "update-service", "server.js"), remote_server),
            (os.path.join(PROJECT_ROOT, "update-service", "company-skills.js"), posixpath.join(remote_root, "company-skills.js")),
        ]
        if DEPLOY_ADMIN_UI:
            files.append((os.path.join(PROJECT_ROOT, "update-service", "public", "admin.html"), posixpath.join(remote_public, "admin.html")))
        if TELEMETRY_CORP_ID:
            if not TELEMETRY_CORP_ID.replace("-", "").replace("_", "").isalnum():
                raise RuntimeError("XIANMA_TELEMETRY_CORP_ID contains invalid characters")
        if environment_updates:
            files.append((os.path.join(PROJECT_ROOT, "update-service", "docker-compose.yml"), posixpath.join(remote_root, "docker-compose.yml")))
        for local_path, remote_path in files:
            temporary_path = f"{remote_path}.uploading-{timestamp}"
            backup_path = f"{remote_path}.backup-{timestamp}"
            sftp.put(local_path, temporary_path)
            existed = run(client, f"if test -e {json.dumps(remote_path)}; then printf yes; else printf no; fi") == "yes"
            if existed:
                is_directory = run(client, f"if test -d {json.dumps(remote_path)}; then printf yes; else printf no; fi") == "yes"
                if is_directory:
                    run(client, f"mv -- {json.dumps(remote_path)} {json.dumps(backup_path)}")
                    backups.append((remote_path, backup_path, "move"))
                else:
                    run(client, f"cp -- {json.dumps(remote_path)} {json.dumps(backup_path)}")
                    backups.append((remote_path, backup_path, "copy"))
            else:
                backups.append((remote_path, None, "remove"))
            run(client, f"mv -- {json.dumps(temporary_path)} {json.dumps(remote_path)}")

        if environment_updates:
            remote_env = posixpath.join(remote_root, ".env")
            env_backup = f"{remote_env}.backup-{timestamp}"
            run(client, f"cp -- {json.dumps(remote_env)} {json.dumps(env_backup)}")
            backups.append((remote_env, env_backup, "copy"))
            with sftp.open(remote_env, "r") as env_file:
                env_text = env_file.read().decode("utf-8", errors="replace")
            updated_keys = set(environment_updates) | {
                "MODEL_GATEWAY_DEEPSEEK_BASE_URL",
                "MODEL_GATEWAY_DEEPSEEK_API_KEY",
                "MODEL_GATEWAY_DEEPSEEK_MODEL",
            }
            env_lines = [line for line in env_text.splitlines() if line.split("=", 1)[0] not in updated_keys]
            # Compose's .env parser treats an unquoted value containing spaces as
            # separate tokens. JSON strings are valid double-quoted dotenv values.
            env_lines.extend(f"{key}={json.dumps(value, ensure_ascii=False)}" for key, value in environment_updates.items())
            temporary_env = f"{remote_env}.uploading-{timestamp}"
            with sftp.open(temporary_env, "w") as env_file:
                env_file.write(("\n".join(env_lines).rstrip() + "\n").encode("utf-8"))
            run(client, f"mv -- {json.dumps(temporary_env)} {json.dumps(remote_env)}")
            run(client, f"cd -- {json.dumps(remote_root)} && docker compose up -d --force-recreate xianma-update-service")
        else:
            run(client, "docker restart xianma-update-service")
        for _ in range(30):
            health = run(client, "curl -fsS http://127.0.0.1:18091/health", check=False)
            if '"ok":true' in health:
                break
            time.sleep(1)
        else:
            raise RuntimeError("service health check timed out")
        admin_probe = run(client, "curl -fsS http://127.0.0.1:18091/admin")
        legacy_admin_ok = "使用统计" in admin_probe and "/api/admin/telemetry/overview" in admin_probe
        v11_admin_ok = 'data-view="overview"' in admin_probe and 'data-view="releases"' in admin_probe
        if not (legacy_admin_ok or v11_admin_ok):
            raise RuntimeError("deployed admin page does not contain telemetry UI")
        print(json.dumps({
            "deployed": True,
            "host": HOST,
            "service": "xianma-update-service",
            "dataRoot": remote_data,
            "backupCount": len(backups),
        }, ensure_ascii=False))
    except Exception:
        for remote_path, backup_path, restore_mode in reversed(backups):
            if restore_mode == "move":
                run(client, f"rm -rf -- {json.dumps(remote_path)} && mv -- {json.dumps(backup_path)} {json.dumps(remote_path)}", check=False)
            elif backup_path:
                run(client, f"cp -- {json.dumps(backup_path)} {json.dumps(remote_path)}", check=False)
            else:
                run(client, f"rm -f -- {json.dumps(remote_path)}", check=False)
        if backups:
            if environment_updates and remote_server:
                run(client, f"cd -- {json.dumps(posixpath.dirname(remote_server))} && docker compose up -d --force-recreate xianma-update-service", check=False)
            else:
                run(client, "docker restart xianma-update-service", check=False)
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

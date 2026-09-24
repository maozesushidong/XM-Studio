"""Deploy the isolated V1.1 preview service without storing credentials in source."""

import json
import hashlib
import os
import posixpath
import re
import secrets
import shlex
import sys
import time
from pathlib import Path

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


HOST = os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148").strip()
USER = os.environ.get("XIANMA_SERVER_USER", "root").strip()
PASSWORD = os.environ.get("XIANMA_SERVER_PASSWORD", "")
ADMIN_TOKEN = os.environ.get("XIANMA_V11_PREVIEW_ADMIN_TOKEN", "")
PUBLIC_PATH_OVERRIDE = os.environ.get("XIANMA_V11_PREVIEW_PUBLIC_PATH", "").strip().strip("/")
REMOTE_ROOT = "/opt/xianma-v11-preview"
COMPOSE_DIR = posixpath.join(REMOTE_ROOT, "deploy", "v11-preview")
PUBLIC_PORT = 18092
NGINX_CONFIG = "/etc/nginx/conf.d/rencaipandian.conf"
MARKER_START = "# BEGIN XIANMA V11 PREVIEW"
MARKER_END = "# END XIANMA V11 PREVIEW"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOCAL_SERVICE_ROOT = PROJECT_ROOT / "update-service"
LOCAL_METADATA = PROJECT_ROOT / "build" / "v11-preview-deployment.json"
LOCAL_SIGNING_PUBLIC_KEY = PROJECT_ROOT / "build" / "v11-preview-signing-public.pem"

INHERITED_ENV_KEYS = {
    "TELEMETRY_ALLOWED_CORP_ID",
    "TELEMETRY_EXCLUDED_IDENTIFIERS",
    "TELEMETRY_EXCLUDED_NAMES",
    "ADMIN_FRAME_ANCESTORS",
    "MAPMS_BASE_URL",
    "MAPMS_API_KEY",
    "MAPMS_API_SECRET",
    "MAPMS_USER_REMARK",
    "MAPMS_ADMIN_BASE_URL",
    "MAPMS_ADMIN_USERNAME",
    "MAPMS_ADMIN_PASSWORD",
    "DINGTALK_APP_KEY",
    "DINGTALK_APP_SECRET",
    "MODEL_GATEWAY_GPT_BASE_URL",
    "MODEL_GATEWAY_GPT_API_KEY",
    "MODEL_GATEWAY_GPT_DEFAULT_MODEL",
    "MODEL_GATEWAY_FALLBACK_BASE_URL",
    "MODEL_GATEWAY_FALLBACK_API_KEY",
    "MODEL_GATEWAY_FALLBACK_MODEL",
    "MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS",
    "MODEL_GATEWAY_GPT_MAX_CONCURRENCY",
}


def run(client, command, check=True, timeout=60):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    del stdin
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error = stderr.read().decode("utf-8", errors="replace").strip()
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        raise RuntimeError(f"remote command failed ({status}): {error or output}")
    return output or error


def remote_exists(sftp, remote_path):
    try:
        sftp.stat(remote_path)
        return True
    except FileNotFoundError:
        return False


def ensure_remote_directory(sftp, remote_path):
    current = "/"
    for part in remote_path.strip("/").split("/"):
        current = posixpath.join(current, part)
        if not remote_exists(sftp, current):
            sftp.mkdir(current)


def upload_file(sftp, local_path, remote_path):
    ensure_remote_directory(sftp, posixpath.dirname(remote_path))
    temporary_path = f"{remote_path}.uploading-{os.getpid()}-{int(time.time())}"
    sftp.put(str(local_path), temporary_path)
    try:
        sftp.posix_rename(temporary_path, remote_path)
    except (AttributeError, IOError):
        if remote_exists(sftp, remote_path):
            sftp.remove(remote_path)
        sftp.rename(temporary_path, remote_path)


def upload_tree(sftp):
    files = [
        LOCAL_SERVICE_ROOT / "package.json",
        LOCAL_SERVICE_ROOT / "package-lock.json",
        LOCAL_SERVICE_ROOT / "server.js",
        LOCAL_SERVICE_ROOT / "company-skills.js",
        LOCAL_SERVICE_ROOT / "v11-platform.js",
        LOCAL_SERVICE_ROOT / "v11-store.js",
        LOCAL_SERVICE_ROOT / "deploy" / "v11-preview" / "Dockerfile",
        LOCAL_SERVICE_ROOT / "deploy" / "v11-preview" / "docker-compose.yml",
        LOCAL_SERVICE_ROOT / "scripts" / "migrate-v11-json-to-postgres.js",
    ]
    files.extend(path for path in (LOCAL_SERVICE_ROOT / "public").iterdir() if path.is_file())
    for local_path in files:
        if not local_path.exists():
            raise RuntimeError(f"preview deployment file is missing: {local_path}")
        relative_path = local_path.relative_to(LOCAL_SERVICE_ROOT).as_posix()
        upload_file(sftp, local_path, posixpath.join(REMOTE_ROOT, relative_path))


def parse_environment(values):
    result = {}
    for item in values:
        key, separator, value = str(item).partition("=")
        if separator:
            result[key] = value
    return result


def read_remote_text(sftp, remote_path):
    if not remote_exists(sftp, remote_path):
        return ""
    with sftp.open(remote_path, "r") as source:
        return source.read().decode("utf-8", errors="replace")


def write_remote_text(sftp, remote_path, value):
    ensure_remote_directory(sftp, posixpath.dirname(remote_path))
    temporary_path = f"{remote_path}.uploading-{os.getpid()}-{int(time.time())}"
    with sftp.open(temporary_path, "w") as target:
        target.write(value.encode("utf-8"))
    try:
        sftp.posix_rename(temporary_path, remote_path)
    except (AttributeError, IOError):
        if remote_exists(sftp, remote_path):
            sftp.remove(remote_path)
        sftp.rename(temporary_path, remote_path)


def dotenv_text(values):
    return "\n".join(f"{key}={json.dumps(str(value), ensure_ascii=False)}" for key, value in values.items()) + "\n"


def resolve_public_path(sftp):
    marker_path = posixpath.join(REMOTE_ROOT, ".public-path")
    existing = read_remote_text(sftp, marker_path).strip().strip("/")
    public_path = PUBLIC_PATH_OVERRIDE or existing or f"studio-v11-{secrets.token_urlsafe(32)}"
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", public_path):
        raise RuntimeError("preview public path must contain 32-128 letters, numbers, underscores, or hyphens")
    write_remote_text(sftp, marker_path, f"{public_path}\n")
    return public_path


def configure_environment(client, sftp, public_path):
    formal_environment = parse_environment(json.loads(run(
        client,
        "docker inspect xianma-update-service --format '{{json .Config.Env}}'",
    )))
    existing_env = read_remote_text(sftp, posixpath.join(COMPOSE_DIR, ".env"))
    existing_values = {}
    for line in existing_env.splitlines():
        key, separator, value = line.partition("=")
        if not separator:
            continue
        try:
            existing_values[key] = json.loads(value)
        except json.JSONDecodeError:
            existing_values[key] = value.strip().strip('"').strip("'")
    postgres_password = existing_values.get("POSTGRES_PASSWORD") or secrets.token_urlsafe(36)
    base_url = f"http://{HOST}/{public_path}"
    values = {
        "POSTGRES_PASSWORD": postgres_password,
        "V11_PREVIEW_PORT": str(PUBLIC_PORT),
        "UPDATE_ADMIN_TOKEN": ADMIN_TOKEN,
        "UPDATE_PUBLIC_BASE_URL": base_url,
        "UPDATE_NEXT_INTERNAL_VERSION": "1.4.0",
        "UPDATE_MAX_UPLOAD_BYTES": "2147483648",
        "UPDATE_UPLOAD_CHUNK_BYTES": "8388608",
        "ADMIN_FRAME_ANCESTORS": formal_environment.get("ADMIN_FRAME_ANCESTORS", "'self'"),
    }
    for key in sorted(INHERITED_ENV_KEYS):
        inherited_value = os.environ.get(key) or existing_values.get(key) or formal_environment.get(key)
        if inherited_value:
            values[key] = inherited_value
    env_path = posixpath.join(COMPOSE_DIR, ".env")
    write_remote_text(sftp, env_path, dotenv_text(values))
    run(client, f"chmod 600 {shlex.quote(env_path)}")
    return base_url


def ensure_signing_key(client, sftp):
    secrets_dir = posixpath.join(COMPOSE_DIR, "secrets")
    private_key_path = posixpath.join(secrets_dir, "update-signing-private.pem")
    run(client, f"mkdir -p {shlex.quote(secrets_dir)}")
    if not remote_exists(sftp, private_key_path) or sftp.stat(private_key_path).st_size == 0:
        private_key = Ed25519PrivateKey.generate().private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        write_remote_text(sftp, private_key_path, private_key.decode("ascii"))
    run(client, f"chmod 600 {shlex.quote(private_key_path)}")


def nginx_block(public_path):
    return f"""    {MARKER_START}
    location ^~ /{public_path}/ {{
        proxy_pass http://127.0.0.1:{PUBLIC_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 0;
        proxy_connect_timeout 60s;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }}
    {MARKER_END}
"""


def configure_nginx(client, sftp, public_path):
    original = read_remote_text(sftp, NGINX_CONFIG)
    if not original:
        raise RuntimeError("existing Nginx configuration is unavailable")
    block = nginx_block(public_path)
    marker_pattern = re.compile(
        rf"^[ \t]*{re.escape(MARKER_START)}.*?^[ \t]*{re.escape(MARKER_END)}[ \t]*$",
        re.DOTALL | re.MULTILINE,
    )
    if marker_pattern.search(original):
        updated = marker_pattern.sub(block.rstrip(), original, count=1)
    else:
        # Older preview deployments may already have this route without our
        # markers. Replace that exact test route before considering insertion.
        route_pattern = re.compile(
            rf"^[ \t]*location \^~ /{re.escape(public_path)}/ \{{\r?\n.*?^[ \t]*\}}[ \t]*$",
            re.DOTALL | re.MULTILINE,
        )
        if route_pattern.search(original):
            updated = route_pattern.sub(block.rstrip(), original, count=1)
        else:
            anchor = "    location / {"
            if anchor not in original:
                raise RuntimeError("unable to locate the Nginx insertion point")
            updated = original.replace(anchor, f"{block}\n{anchor}", 1)
    if updated == original:
        return ""
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_path = f"{NGINX_CONFIG}.v11-preview-{timestamp}.bak"
    run(client, f"cp -- {shlex.quote(NGINX_CONFIG)} {shlex.quote(backup_path)}")
    write_remote_text(sftp, NGINX_CONFIG, updated)
    validation = run(client, "nginx -t", check=False)
    if "successful" not in validation.lower():
        run(client, f"cp -- {shlex.quote(backup_path)} {shlex.quote(NGINX_CONFIG)}")
        raise RuntimeError(f"Nginx validation failed: {validation}")
    run(client, "nginx -s reload")
    return backup_path


def main():
    if not PASSWORD:
        raise RuntimeError("XIANMA_SERVER_PASSWORD is required")
    if not ADMIN_TOKEN:
        raise RuntimeError("XIANMA_V11_PREVIEW_ADMIN_TOKEN is required")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15, auth_timeout=15)
    sftp = client.open_sftp()
    try:
        public_path = resolve_public_path(sftp)
        upload_tree(sftp)
        base_url = configure_environment(client, sftp, public_path)
        ensure_signing_key(client, sftp)
        run(client, f"cd {shlex.quote(COMPOSE_DIR)} && docker compose up -d --build", timeout=900)
        for _ in range(60):
            health = run(client, f"curl -fsS http://127.0.0.1:{PUBLIC_PORT}/health", check=False)
            if '"ok":true' in health:
                break
            time.sleep(2)
        else:
            logs = run(client, f"cd {shlex.quote(COMPOSE_DIR)} && docker compose logs --tail=120 service", check=False)
            raise RuntimeError(f"preview service health check timed out: {logs}")
        nginx_backup = configure_nginx(client, sftp, public_path)
        public_health = run(client, f"curl -fsS {shlex.quote(base_url + '/health')}")
        if '"ok":true' not in public_health:
            raise RuntimeError("public preview health check failed")
        storage_mode = json.loads(public_health).get("v11StorageMode", "unknown")
        signing_key_response = json.loads(run(client, f"curl -fsS {shlex.quote(base_url + '/api/app-updates/public-key')}"))
        signing_public_key = str(signing_key_response.get("publicKey") or "").strip()
        if not signing_public_key.startswith("-----BEGIN PUBLIC KEY-----") or not signing_public_key.endswith("-----END PUBLIC KEY-----"):
            raise RuntimeError("preview service signing public key is unavailable")
        LOCAL_SIGNING_PUBLIC_KEY.parent.mkdir(parents=True, exist_ok=True)
        LOCAL_SIGNING_PUBLIC_KEY.write_text(f"{signing_public_key}\n", encoding="ascii")
        signing_key_sha256 = hashlib.sha256(f"{signing_public_key}\n".encode("ascii")).hexdigest().upper()
        result = {
            "deployed": True,
            "baseUrl": base_url,
            "adminUrl": f"{base_url}/admin",
            "channel": "v11-preview",
            "storageMode": storage_mode,
            "remoteRoot": REMOTE_ROOT,
            "nginxBackupCreated": bool(nginx_backup),
            "signingPublicKeyPath": str(LOCAL_SIGNING_PUBLIC_KEY),
            "signingPublicKeySha256": signing_key_sha256,
        }
        LOCAL_METADATA.parent.mkdir(parents=True, exist_ok=True)
        LOCAL_METADATA.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

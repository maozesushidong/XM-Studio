"""Update only model routing and backup credentials, with rollback on failure."""

import datetime
import hashlib
import json
import os
import pathlib
import shlex
import time

import paramiko


def main():
    password = os.environ["XIANMA_SERVER_PASSWORD"]
    api_key = os.environ["XIANMA_MODEL_GATEWAY_ERROR_FALLBACK_API_KEY"].strip()
    expected_sha = os.environ["XIANMA_MODEL_DEPLOY_EXPECTED_SHA"]
    base_url = os.environ["XIANMA_MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL"].strip().rstrip("/")
    if not api_key or not base_url or any(c in api_key + base_url for c in "\r\n"):
        raise ValueError("Invalid backup configuration")
    source = (pathlib.Path(__file__).resolve().parents[1] / "update-service" / "server.js").read_bytes()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148"),
                   username=os.environ.get("XIANMA_SERVER_USER", "root"),
                   password=password, timeout=20)
    sftp = client.open_sftp()
    root = "/opt/xianma-update-service"
    server_path, env_path = root + "/server.js", root + "/.env"
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = root + "/backups/model-fallback-" + stamp

    def run(command):
        _, stdout, stderr = client.exec_command(command, timeout=90)
        output = stdout.read().decode("utf-8", errors="replace")
        stderr.read()
        if stdout.channel.recv_exit_status() != 0:
            raise RuntimeError("Remote operation failed; sensitive command output omitted")
        return output

    def read(path):
        with sftp.open(path, "rb") as handle:
            return handle.read()

    def write(path, data, mode):
        temporary = path + ".model-upload-" + stamp
        with sftp.open(temporary, "wb") as handle:
            handle.write(data)
        sftp.chmod(temporary, mode)
        run("mv -- " + shlex.quote(temporary) + " " + shlex.quote(path))

    recreate = "cd " + shlex.quote(root) + " && docker compose up -d --no-deps --no-build --force-recreate xianma-update-service"

    def health_check():
        for _ in range(30):
            try:
                health = json.loads(run("curl -fsS --max-time 3 http://127.0.0.1:18091/health"))
                if health.get("ok"):
                    return
            except (RuntimeError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError("Service health check failed")

    changed = False
    try:
        previous_source, previous_env = read(server_path), read(env_path)
        if hashlib.sha256(previous_source).hexdigest() != expected_sha:
            raise RuntimeError("Live source changed since inspection; deployment cancelled")
        protected = [root + "/public/admin-v11.html", root + "/public/admin-v11.js",
                     root + "/public/admin-v11.css", root + "/data/releases.json"]
        hashes = {p: hashlib.sha256(read(p)).hexdigest() for p in protected}
        updates = {"MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL": base_url,
                   "MODEL_GATEWAY_ERROR_FALLBACK_API_KEY": api_key}
        lines = [line for line in previous_env.decode("utf-8").splitlines()
                 if line.split("=", 1)[0].strip() not in updates]
        lines.extend(key + "=" + json.dumps(value) for key, value in updates.items())
        new_env = ("\n".join(lines).rstrip() + "\n").encode("utf-8")
        run("mkdir -m 700 -- " + shlex.quote(backup))
        write(backup + "/server.js", previous_source, 0o600)
        write(backup + "/.env", previous_env, 0o600)
        changed = True
        write(server_path, source, 0o644)
        write(env_path, new_env, 0o600)
        run(recreate)
        health_check()
        inspection = json.loads(run("docker inspect xianma-update-service"))[0]
        live_env = dict(item.split("=", 1) for item in inspection["Config"]["Env"] if "=" in item)
        if any(live_env.get(key) != value for key, value in updates.items()):
            raise RuntimeError("Backup configuration did not take effect")
        if read(server_path) != source or any(hashlib.sha256(read(p)).hexdigest() != h for p, h in hashes.items()):
            raise RuntimeError("Source or protected UI/release verification failed")
        print(json.dumps({"deployed": True, "backup": backup, "health": True,
                          "backupKeyVerified": True, "adminAndReleasesUnchanged": True}))
    except Exception:
        if changed:
            write(server_path, previous_source, 0o644)
            write(env_path, previous_env, 0o600)
            run(recreate)
            health_check()
        raise
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    main()

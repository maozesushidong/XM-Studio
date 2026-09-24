"""Copy only existing model fallback settings into the isolated test environment."""
import hashlib
import json
import os
import pathlib
import shlex
import datetime
import paramiko

ROOT = "/opt/xianma-v11-preview"
PREVIEW = "xianma-v11-preview-service-1"
PRODUCTION = "xianma-update-service"
BASE = "http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.96.184.148", username="root", password=os.environ["XIANMA_SERVER_PASSWORD"], timeout=20)
try:
    def run(command, timeout=120):
        _, out, err = client.exec_command(command, timeout=timeout)
        data = out.read()
        if out.channel.recv_exit_status():
            raise RuntimeError("Remote model configuration check failed")
        return data
    def inspect(name):
        return json.loads(run("docker inspect " + name))[0]
    def env(info):
        return dict(item.split("=",1) for item in info["Config"]["Env"] if "=" in item)
    def fingerprint(info):
        files = run("docker exec xianma-update-service sh -c 'sha256sum /app/server.js /app/public/admin-v11.js /app/package-lock.json /data/releases.json'")
        return hashlib.sha256(json.dumps({"id": info["Id"], "image": info["Image"], "config": info["Config"], "started": info["State"]["StartedAt"], "files": files.decode()},sort_keys=True).encode()).hexdigest()
    production = inspect(PRODUCTION)
    before = fingerprint(production)
    preview = inspect(PREVIEW)
    testenv, formalenv = env(preview), env(production)
    assert testenv["UPDATE_PUBLIC_BASE_URL"] == BASE
    assert "xianma_v11_preview" in testenv["DATABASE_URL"]
    keys = ["MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL", "MODEL_GATEWAY_ERROR_FALLBACK_API_KEY", "MODEL_GATEWAY_ERROR_FALLBACK_TEXT_MODEL", "MODEL_GATEWAY_ERROR_FALLBACK_VISION_MODEL", "MODEL_GATEWAY_ERROR_FALLBACK_SUPPORTS_TOOLS"]
    values = {key: formalenv.get(key, "") for key in keys}
    print(json.dumps({"testConfigured": bool(testenv.get(keys[1])), "sourceConfigured": bool(values[keys[1]]), "textModel": values[keys[2]], "visionModel": values[keys[3]]}), flush=True)
    assert all(values[key] for key in keys[:4]), "Production fallback settings unavailable"
    if os.environ.get("XIANMA_APPLY_PREVIEW_MODELS") != "1":
        raise SystemExit(0)
    directory = ROOT + "/deploy/v11-preview"
    # Use the same explicit .env file as the already running preview Compose project.
    assert preview["Config"]["Labels"]["com.docker.compose.project.working_dir"] == directory
    sftp = client.open_sftp()
    envpath = directory + "/.env"
    with sftp.open(envpath) as handle:
        original = handle.read().decode()
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = ROOT + "/backups/model-config-" + stamp + ".env"
    with sftp.open(backup,"w") as handle:
        handle.write(original)
    sftp.chmod(backup,0o600)
    lines = [line for line in original.splitlines() if line.partition("=")[0].strip() not in values]
    assert not any("\n" in value or "\r" in value or "'" in value for value in values.values())
    lines.extend(key + "='" + value + "'" for key,value in values.items())
    with sftp.open(envpath,"w") as handle:
        handle.write("\n".join(lines)+"\n")
    sftp.chmod(envpath,0o600)
    port = preview["HostConfig"]["PortBindings"]["8080/tcp"][0]["HostPort"]
    try:
        run("cd " + shlex.quote(directory) + " && V11_PREVIEW_PORT=" + shlex.quote(port) + " docker compose up -d --no-deps --no-build --force-recreate service")
        actual = env(inspect(PREVIEW))
        assert all(actual.get(key) == value for key,value in values.items())
        after = fingerprint(inspect(PRODUCTION))
        assert before == after
        report = {"ok": True,"baseUrl": BASE,"productionUnchanged": True,"models": [values[keys[2]],values[keys[3]]],"backup": backup}
        (pathlib.Path(__file__).resolve().parent.parent / "build/preview-model-configuration.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
        print(json.dumps(report),flush=True)
    except Exception:
        with sftp.open(envpath,"w") as handle:
            handle.write(original)
        run("cd " + shlex.quote(directory) + " && V11_PREVIEW_PORT=" + shlex.quote(port) + " docker compose up -d --no-deps --no-build --force-recreate service")
        raise
    finally:
        sftp.close()
finally:
    client.close()

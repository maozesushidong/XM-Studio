"""Copy running production features to preview while preserving preview isolation."""

import datetime
import hashlib
import json
import os
import pathlib
import shlex
import time

import paramiko


PRODUCTION = "xianma-update-service"
PREVIEW = "xianma-v11-preview-service-1"
PREVIEW_DB = "xianma-v11-preview-postgres-1"
ROOT = "/opt/xianma-v11-preview"
COMPOSE = ROOT + "/deploy/v11-preview"
FILES = [
    "server.js", "company-skills.js", "v11-platform.js", "v11-store.js",
    "package.json", "package-lock.json", "public/admin.html",
    "public/admin-v11.html", "public/admin-v11.css", "public/admin-v11-theme.css",
    "public/admin-v11.js", "public/admin-v11-icon.png",
    "scripts/migrate-v11-json-to-postgres.js",
]


def main():
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = ROOT + "/backups/formal-alignment-" + stamp
    stage = backup + "/source"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(os.environ.get("XIANMA_SERVER_HOST", "47.96.184.148"),
                   username=os.environ.get("XIANMA_SERVER_USER", "root"),
                   password=os.environ["XIANMA_SERVER_PASSWORD"], timeout=20)
    sftp = client.open_sftp()

    def run(command, timeout=90, build_output=False):
        _, output, error = client.exec_command(command, timeout=timeout)
        data = output.read()
        error_text = error.read()
        if output.channel.recv_exit_status():
            if build_output:
                print(error_text.decode("utf-8", errors="replace")[-4000:], flush=True)
            raise RuntimeError("Remote operation failed; sensitive output omitted")
        return data

    def inspect(name):
        return json.loads(run("docker inspect " + shlex.quote(name)))[0]

    def env(container):
        return dict(item.split("=", 1) for item in container["Config"]["Env"] if "=" in item)

    def file_bytes(path):
        with sftp.open(path, "rb") as handle:
            return handle.read()

    def write(path, data):
        with sftp.open(path, "wb") as handle:
            handle.write(data)

    def container_file(name, path):
        return run("docker exec " + shlex.quote(name) + " cat " + shlex.quote(path))

    def hashes(name):
        return {p: hashlib.sha256(container_file(name, "/app/" + p)).hexdigest() for p in FILES}

    def production_fingerprint():
        info = inspect(PRODUCTION)
        return {"id": info["Id"], "started": info["State"]["StartedAt"],
                "image": info["Image"], "env": env(info), "files": hashes(PRODUCTION),
                "releases": hashlib.sha256(file_bytes("/opt/xianma-update-service/data/releases.json")).hexdigest()}

    def health(port):
        for _ in range(30):
            try:
                result = json.loads(run(f"curl -fsS --max-time 3 http://127.0.0.1:{port}/health"))
                if result.get("ok") and result.get("v11StorageMode") == "postgres":
                    return
            except (RuntimeError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError("Service health check failed")

    compose_cmd = "cd " + shlex.quote(COMPOSE) + " && docker compose "
    previous = inspect(PREVIEW)
    previous_env = env(previous)
    previous_image = previous["Image"]
    image_tag = previous["Config"]["Image"]
    test_base = previous_env["UPDATE_PUBLIC_BASE_URL"]
    expected_base = "http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM"
    if test_base != expected_base or previous_env["DATABASE_URL"] == env(inspect(PRODUCTION))["DATABASE_URL"]:
        raise RuntimeError("Preview isolation check failed")
    mounts = {m["Destination"]: m for m in previous["Mounts"]}
    if mounts["/data"].get("Name") != "xianma_v11_preview_data":
        raise RuntimeError("Unexpected preview data volume")
    test_data = mounts["/data"]["Source"]
    if not test_data.endswith("/volumes/xianma_v11_preview_data/_data"):
        raise RuntimeError("Unexpected preview data directory")
    protected_paths = [COMPOSE + "/.env", COMPOSE + "/docker-compose.yml",
                       COMPOSE + "/secrets/update-signing-private.pem"]
    protected_hashes = {p: hashlib.sha256(file_bytes(p)).hexdigest() for p in protected_paths}
    baseline = production_fingerprint()
    for p in ("package.json", "package-lock.json"):
        if container_file(PREVIEW, "/app/" + p) != container_file(PRODUCTION, "/app/" + p):
            raise RuntimeError("Dependency manifests differ; a dependency rebuild is required")
    old_preview_js = container_file(PREVIEW, "/app/public/admin-v11.js").decode("utf-8")
    if "channel=v11-preview" not in old_preview_js:
        raise RuntimeError("Unexpected preview release channel")
    stopped = False
    source_changed = False
    image_built = False
    try:
        run("mkdir -p " + shlex.quote(stage + "/public") + " " + shlex.quote(stage + "/scripts"))
        run("chmod 700 " + shlex.quote(backup))
        tar_files = " ".join(shlex.quote(p) for p in [
            "server.js", "company-skills.js", "v11-platform.js", "v11-store.js",
            "package.json", "package-lock.json", "public", "scripts", "deploy/v11-preview"])
        run("tar -C " + shlex.quote(ROOT) + " -czf " + shlex.quote(backup + "/previous-code-config.tar.gz") + " " + tar_files)
        expected_hashes = {}
        for name in FILES:
            data = container_file(PRODUCTION, "/app/" + name)
            if name == "public/admin-v11.js":
                source = data.decode("utf-8")
                if source.count("stable-v2") != 4:
                    raise RuntimeError("Release channel references changed; review required")
                source = source.replace("stable-v2", "v11-preview")
                source = source.replace("正式更新通道为", "测试更新通道为")
                source = source.replace("上传并发布正式更新", "上传并发布测试更新")
                source = source.replace("正式版本已发布", "测试版本已发布")
                data = source.encode("utf-8")
            write(stage + "/" + name, data)
            expected_hashes[name] = hashlib.sha256(data).hexdigest()
        base_tag = "xianma-v11-preview-service:alignment-base-" + stamp
        run("docker tag " + shlex.quote(previous_image) + " " + shlex.quote(base_tag))
        dockerfile = "FROM " + base_tag + "\nWORKDIR /app\nCOPY . /app/\n"
        write(backup + "/Dockerfile", dockerfile.encode("ascii"))
        run("docker build --network=none --pull=false -t " + shlex.quote(image_tag)
            + " -f " + shlex.quote(backup + "/Dockerfile") + " " + shlex.quote(stage), timeout=180, build_output=True)
        image_built = True
        print(json.dumps({"stage": "image-built", "files": len(FILES)}), flush=True)
        if production_fingerprint() != baseline:
            raise RuntimeError("Production changed during source capture; retry with a new snapshot")
        run(compose_cmd + "stop service")
        stopped = True
        run("tar -C " + shlex.quote(test_data) + " -czf " + shlex.quote(backup + "/preview-data.tar.gz") + " .")
        run("docker exec " + PREVIEW_DB + " pg_dump -U xianma_v11 -d xianma_v11_preview -Fc > "
            + shlex.quote(backup + "/preview-postgres.dump"))
        def data_manifest(directory, prefix=""):
            import stat
            result = {}
            for entry in sftp.listdir_attr(directory):
                name = prefix + entry.filename
                target = directory + "/" + entry.filename
                if stat.S_ISDIR(entry.st_mode):
                    result.update(data_manifest(target, name + "/"))
                elif stat.S_ISREG(entry.st_mode):
                    result[name] = hashlib.sha256(file_bytes(target)).hexdigest()
            return result
        before_data = data_manifest(test_data)
        source_changed = True
        for name in FILES:
            write(ROOT + "/" + name, file_bytes(stage + "/" + name))
        run(compose_cmd + "up -d --no-deps --no-build service")
        health(18092)
        current = inspect(PREVIEW)
        if env(current) != previous_env or sorted(current["Mounts"], key=lambda m: m["Destination"]) != sorted(previous["Mounts"], key=lambda m: m["Destination"]):
            raise RuntimeError("Preview environment or mount isolation changed")
        if hashes(PREVIEW) != expected_hashes:
            raise RuntimeError("Deployed source verification failed")
        for p, sha in protected_hashes.items():
            if hashlib.sha256(file_bytes(p)).hexdigest() != sha:
                raise RuntimeError("Protected preview configuration changed")
        after_data = data_manifest(test_data)
        if any(after_data.get(p) != h for p, h in before_data.items() if p != "telemetry.json"):
            raise RuntimeError("Existing preview skill or release files changed")
        if production_fingerprint() != baseline:
            raise RuntimeError("Production verification failed")
        health(18091)
        result = {"deployed": True, "adminUrl": test_base + "/admin", "backup": backup,
                  "files": len(FILES), "productionUnchanged": True, "testEnvironmentUnchanged": True,
                  "existingTestFilesPreserved": len(before_data), "releaseChannel": "v11-preview",
                  "productionSourceHashes": baseline["files"], "previewSourceHashes": expected_hashes}
        write(backup + "/result.json", json.dumps(result, indent=2).encode("utf-8"))
        destination = pathlib.Path(__file__).resolve().parents[1] / "build" / "preview-alignment-result.json"
        destination.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({k: v for k, v in result.items() if not k.endswith("Hashes")}), flush=True)
    except Exception:
        if source_changed:
            run("tar -C " + shlex.quote(ROOT) + " -xzf " + shlex.quote(backup + "/previous-code-config.tar.gz"))
        if image_built:
            run("docker tag " + shlex.quote(previous_image) + " " + shlex.quote(image_tag))
        if stopped:
            run(compose_cmd + "up -d --no-deps --no-build service")
            health(18092)
        raise
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    main()

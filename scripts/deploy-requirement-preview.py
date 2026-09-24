"""Build, verify and activate requirement intake only in the isolated preview."""
import datetime
import hashlib
import json
import os
import pathlib
import shlex
import tarfile
import time
import sys
import paramiko

ROOT = "/opt/xianma-v11-preview"
PREVIEW = "xianma-v11-preview-service-1"
PRODUCTION = "xianma-update-service"
BASE = "http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM"
PROJECT = pathlib.Path(__file__).resolve().parent.parent

def main():
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    stage = ROOT + "/releases/requirement-" + stamp
    backup = ROOT + "/backups/requirement-" + stamp
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("47.96.184.148", username="root", password=os.environ["XIANMA_SERVER_PASSWORD"], timeout=20)
    sftp = client.open_sftp()
    def run(cmd, timeout=180):
        _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        data, errors = stdout.read(), stderr.read()
        if stdout.channel.recv_exit_status():
            raise RuntimeError("Remote operation failed: " + errors.decode("utf-8", errors="replace")[-2000:])
        return data
    def inspect(name):
        return json.loads(run("docker inspect " + shlex.quote(name)))[0]
    def environment(info):
        return dict(item.split("=", 1) for item in info["Config"]["Env"] if "=" in item)
    def fingerprint():
        info = inspect(PRODUCTION)
        files = run("docker exec xianma-update-service sh -c 'sha256sum /app/server.js /app/public/admin-v11.js /app/public/admin-v11.html /app/package-lock.json /data/releases.json'")
        return hashlib.sha256(json.dumps({"id": info["Id"], "image": info["Image"], "env": info["Config"]["Env"], "started": info["State"]["StartedAt"], "files": files.decode() }, sort_keys=True).encode()).hexdigest()
    before = fingerprint()
    previous = inspect(PREVIEW)
    env = environment(previous)
    if env["UPDATE_PUBLIC_BASE_URL"] != BASE or "xianma_v11_preview" not in env["DATABASE_URL"] or env["DATABASE_URL"] == environment(inspect(PRODUCTION))["DATABASE_URL"]:
        raise RuntimeError("Preview isolation check failed")
    network = next(iter(previous["NetworkSettings"]["Networks"]))
    binding = previous["HostConfig"]["PortBindings"]["8080/tcp"][0]
    if binding["HostIp"] != "127.0.0.1":
        raise RuntimeError("Unexpected preview port binding")
    health_base = "http://127.0.0.1:" + binding["HostPort"]
    run("mkdir -p " + shlex.quote(stage) + " " + shlex.quote(backup))
    source = PROJECT / "update-service"
    # Carry forward every unrelated module from the active test image.
    run("docker cp " + PREVIEW + ":/app/. " + shlex.quote(stage))
    if "--intake-only" in sys.argv or "--models-only" in sys.argv:
        run("mkdir -p " + shlex.quote(stage + "/deploy/v11-preview"))
        run("cp " + shlex.quote(ROOT + "/deploy/v11-preview/Dockerfile") + " " + shlex.quote(stage + "/deploy/v11-preview/Dockerfile"))
    if "--intake-only" in sys.argv:
        selected_names = ["requirement-intake"]
    elif "--models-only" in sys.argv:
        selected_names = ["server.js", "preview-model-catalog.js"]
    else:
        selected_names = ["server.js", "preview-model-catalog.js", "requirement-intake", "deploy/v11-preview/Dockerfile"]
    selected = [source / name for name in selected_names]
    archive = PROJECT / "build/requirement-preview-source.tar.gz"
    with tarfile.open(archive, "w:gz") as package:
        for item in selected:
            package.add(item, arcname=item.relative_to(source).as_posix())
    sftp.put(str(archive), stage + "/source.tar.gz")
    run("tar -xzf " + shlex.quote(stage + "/source.tar.gz") + " -C " + shlex.quote(stage))
    image = "xianma-requirement-preview:" + stamp
    print("Building isolated preview image", flush=True)
    run("docker build -t " + shlex.quote(image) + " -f " + shlex.quote(stage + "/deploy/v11-preview/Dockerfile") + " " + shlex.quote(stage), 600)
    env_path = backup + "/test.env"
    with sftp.open(env_path, "w") as handle:
        handle.write("\n".join(f"{key}={value}" for key, value in env.items() if "\n" not in value) + "\n")
    sftp.chmod(env_path, 0o600)
    print("Running fixture and PostgreSQL integration tests in a temporary schema", flush=True)
    regression = run(f"docker run --rm --network {shlex.quote(network)} --env-file {shlex.quote(env_path)} {shlex.quote(image)} node --test requirement-intake/model-test.js", 180)
    (PROJECT / "build/requirement-model-regression.tap").write_bytes(regression)
    tests = run(f"docker run --rm --network {shlex.quote(network)} --env-file {shlex.quote(env_path)} {shlex.quote(image)} node requirement-intake/test.js", 180)
    test_result = json.loads(tests)
    if not test_result["ok"]:
        raise RuntimeError("Integration tests failed")
    (PROJECT / "build/requirement-integration-results.json").write_bytes(tests)
    print(f"Passed {len(test_result['results'])} fixture/integration groups", flush=True)
    if "--reuse-live-evidence" in sys.argv:
        live = (PROJECT / "build/requirement-live-results.json").read_bytes()
    else:
        print("Evaluating the embedded Skill with real models before activation", flush=True)
        live = run(f"docker run --rm --network {shlex.quote(network)} --env-file {shlex.quote(env_path)} {shlex.quote(image)} node requirement-intake/live-test.js", 1100)
        (PROJECT / "build/requirement-live-results.json").write_bytes(live)
    evaluation = json.loads(live)
    manifest = json.loads((source / "requirement-intake/manifest.json").read_text(encoding="utf-8"))
    if evaluation.get("buildHash") != manifest["buildHash"]:
        raise RuntimeError("Real model evidence belongs to a different controlled build")
    live_failures = [{"name": item["name"], "code": item.get("code")} for item in evaluation["results"] if not item["passed"]]
    if live_failures:
        # A narrow bug fix may ship with a recorded upstream outage, never with a
        # failed bug reproducer, invalid output, or a weakened semantic check.
        timeout_exception = "--record-upstream-timeouts" in sys.argv and ("--intake-only" in sys.argv or "--models-only" in sys.argv)
        reproduced = any(item["name"] == "REGRESSION scheduling rename question" and item["passed"] for item in evaluation["results"])
        if not (timeout_exception and reproduced and all(item["code"] == "MODEL_TIMEOUT" for item in live_failures)):
            raise RuntimeError("Real model evaluation failed; current service unchanged")
        print(json.dumps({"livePassed": len(evaluation["results"]) - len(live_failures), "liveFailures": live_failures}), flush=True)
    else:
        print("Real model evaluation passed", flush=True)
    run("docker exec xianma-v11-preview-postgres-1 pg_dump -U xianma_v11 xianma_v11_preview > " + shlex.quote(backup + "/database.sql"))
    run("tar -czf " + shlex.quote(backup + "/runtime.tar.gz") + " -C " + shlex.quote(ROOT) + " server.js public package.json package-lock.json requirement-intake deploy/v11-preview/docker-compose.yml")
    original_tag = previous["Config"]["Image"]
    old_image = previous["Image"]
    activated = False
    try:
        run("docker tag " + shlex.quote(image) + " " + shlex.quote(original_tag))
        run("tar -xzf " + shlex.quote(stage + "/source.tar.gz") + " -C " + shlex.quote(ROOT))
        print("Activating tested preview service", flush=True)
        run("cd " + shlex.quote(ROOT + "/deploy/v11-preview") + " && V11_PREVIEW_PORT=" + shlex.quote(binding["HostPort"]) + " docker compose up -d --no-deps --no-build --force-recreate service")
        activated = True
        active_info = inspect(PREVIEW)
        print(json.dumps({"activeImage": active_info["Image"], "feature": environment(active_info).get("ENABLE_REQUIREMENT_INTAKE")}), flush=True)
        healthy = False
        health = {}
        for _ in range(30):
            try:
                health = json.loads(run("curl -fsS --max-time 3 " + shlex.quote(health_base + "/health")))
                if health.get("requirementIntake") == "enabled" and health.get("v11StorageMode") == "postgres":
                    healthy = True
                    break
            except Exception:
                pass
            time.sleep(1)
        if not healthy:
            print(json.dumps({"lastHealth": health}), flush=True)
            print(run("docker logs --tail 12 " + PREVIEW).decode(), flush=True)
            raise RuntimeError("Preview health check failed")
        admin = json.loads(run("curl -fsS --max-time 5 " + shlex.quote(health_base + "/api/admin/requirements")))
        if "items" not in admin:
            raise RuntimeError("Requirement read service unavailable")
        after = fingerprint()
        if before != after:
            raise RuntimeError("Production fingerprint changed during deployment")
        report = {"ok": True, "baseUrl": BASE, "backup": backup, "image": image, "productionUnchanged": before == after, "scope": selected_names, "tests": len(test_result["results"]), "modelRegression": "passed", "livePassed": len(evaluation["results"]) - len(live_failures), "liveTotal": len(evaluation["results"]), "liveFailures": live_failures, "buildHash": manifest["buildHash"], "deployedAt": datetime.datetime.now().isoformat(), "adminAuthorization": "display_only_not_accepted", "capabilityReview": "pending_product_confirmation"}
        (PROJECT / "build/requirement-preview-deployment.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report), flush=True)
    except Exception:
        if activated:
            run("docker tag " + shlex.quote(old_image) + " " + shlex.quote(original_tag))
            run("tar -xzf " + shlex.quote(backup + "/runtime.tar.gz") + " -C " + shlex.quote(ROOT))
            run("cd " + shlex.quote(ROOT + "/deploy/v11-preview") + " && V11_PREVIEW_PORT=" + shlex.quote(binding["HostPort"]) + " docker compose up -d --no-deps --no-build --force-recreate service")
        raise
    finally:
        sftp.close()
        client.close()

if __name__ == "__main__":
    main()

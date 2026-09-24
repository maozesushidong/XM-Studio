"""Export the owner's requested credential handoff without changing the server."""

import datetime
import hashlib
import json
import pathlib

import paramiko
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64


ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "config" / "plaintext"


def write_json(name, value):
    (OUTPUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def decrypt_bundled(kind):
    envelope = json.loads((ROOT / "electron" / f"bundled-{kind}-credential.json").read_text(encoding="utf-8"))
    part = json.loads((ROOT / "electron" / f"bundled-{kind}-key-part.json").read_text(encoding="utf-8"))
    first = base64.b64decode(envelope["keyPartA"])
    second = base64.b64decode(part["keyPartB"])
    if len(first) != 32 or len(second) != 32 or envelope["algorithm"] != "aes-256-gcm":
        raise ValueError("Unsupported credential envelope")
    key = bytes(a ^ b for a, b in zip(first, second))
    return AESGCM(key).decrypt(
        base64.b64decode(envelope["iv"]),
        base64.b64decode(envelope["ciphertext"]) + base64.b64decode(envelope["tag"]),
        None,
    ).decode("utf-8")


def environment(info):
    return dict(value.split("=", 1) for value in info["Config"]["Env"] if "=" in value)


def main():
    access = json.loads((OUTPUT / "deployment-access.json").read_text(encoding="utf-8"))
    write_json("client-credentials.json", {
        "modelApiKey": decrypt_bundled("ai"),
        "dingtalkClientSecret": decrypt_bundled("dingtalk"),
        "source": "electron/bundled-*-credential.json and bundled-*-key-part.json",
    })
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(access["host"], username=access["username"], password=access["password"], timeout=20)
    try:
        def run(command):
            _, stdout, stderr = client.exec_command(command, timeout=30)
            content = stdout.read()
            stderr.read()
            if stdout.channel.recv_exit_status() != 0:
                raise RuntimeError("Read-only remote export command failed")
            return content

        before = json.loads(run("docker inspect xianma-v11-preview-service-1"))[0]
        env = environment(before)
        if env.get("UPDATE_PUBLIC_BASE_URL", "").rstrip("/") != access["previewBaseUrl"]:
            raise RuntimeError("Unexpected preview base URL")
        if "xianma_v11_preview" not in env.get("DATABASE_URL", ""):
            raise RuntimeError("Unexpected preview database")
        write_json("preview-service-environment.json", env)
        postgres = json.loads(run("docker inspect xianma-v11-preview-postgres-1"))[0]
        postgres_env = environment(postgres)
        write_json("preview-postgres-environment.json", {
            key: value for key, value in postgres_env.items() if key.startswith("POSTGRES_")
        })
        compose_dir = access["previewRoot"] + "/deploy/v11-preview"
        with client.open_sftp() as sftp:
            for remote, local in [
                (compose_dir + "/.env", "preview-compose.env"),
                (compose_dir + "/secrets/update-signing-private.pem", "preview-signing-private.pem"),
            ]:
                with sftp.open(remote, "rb") as handle:
                    (OUTPUT / local).write_bytes(handle.read())
        after = json.loads(run("docker inspect xianma-v11-preview-service-1"))[0]
        if before["Id"] != after["Id"] or before["State"]["StartedAt"] != after["State"]["StartedAt"]:
            raise RuntimeError("Preview container changed during export")
        records = []
        for name in ["client-credentials.json", "deployment-access.json", "preview-compose.env", "preview-postgres-environment.json", "preview-service-environment.json", "preview-signing-private.pem"]:
            file = OUTPUT / name
            records.append({"file": file.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
        write_json("manifest.json", {
            "exportedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "previewBaseUrl": access["previewBaseUrl"],
            "containerImage": before["Config"]["Image"],
            "readOnlyServerExport": True,
            "expiry": access["expiry"],
            "files": records,
        })
        print(json.dumps({"exported": len(records), "readOnlyServerExport": True, "credentialsPrinted": False}))
    finally:
        client.close()


if __name__ == "__main__":
    main()

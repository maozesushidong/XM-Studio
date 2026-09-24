"""Read test-only diagnostics without requirement bodies or credentials."""
import json
import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.96.184.148", username="root", password=os.environ["XIANMA_SERVER_PASSWORD"], timeout=20)
try:
    commands = [
        "docker exec xianma-v11-preview-service-1 node -e 'require(\"./preview-model-catalog\").catalog().then(x=>console.log(JSON.stringify({modelCount:x.models.length,stale:x.stale,models:x.models.map(m=>m.value)})))'",
        "docker exec xianma-v11-preview-service-1 node -e 'console.log(JSON.stringify({model:process.env.REQUIREMENT_MODEL,defaultModel:process.env.MODEL_GATEWAY_GPT_DEFAULT_MODEL,resources:require(\"./requirement-intake/resources\").loadResources().manifest?.adapterVersion}))'",
        "docker exec xianma-v11-preview-postgres-1 psql -U xianma_v11 -d xianma_v11_preview -c \"SELECT status, result->>'code' AS code, count(*) FROM intake_operations WHERE action='analyze' GROUP BY status,result->>'code';\"",
        "docker exec xianma-v11-preview-postgres-1 psql -U xianma_v11 -d xianma_v11_preview -c \"SELECT request_id,status,result->>'code' AS code,updated_at-created_at AS duration FROM intake_operations WHERE action='analyze' ORDER BY created_at DESC LIMIT 8;\""
    ]
    for command in commands:
        _, out, err = client.exec_command(command, timeout=30)
        print(out.read().decode())
        if out.channel.recv_exit_status():
            print(err.read().decode()[-400:])
finally:
    client.close()

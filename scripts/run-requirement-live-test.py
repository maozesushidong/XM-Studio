import os
import pathlib
import paramiko
import time

project = pathlib.Path(__file__).resolve().parent.parent
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.96.184.148", username="root", password=os.environ["XIANMA_SERVER_PASSWORD"], timeout=20)
sftp = client.open_sftp()
remote = "/opt/xianma-v11-preview/requirement-intake/live-test.js"
sftp.put(str(project / "update-service/requirement-intake/live-test.js"), remote)
_, out, err = client.exec_command("docker cp " + remote + " xianma-v11-preview-service-1:/app/requirement-intake/live-test.js && docker exec xianma-v11-preview-service-1 node requirement-intake/live-test.js", timeout=1000)
channel = out.channel
data = bytearray()
while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
    if channel.recv_ready():
        data.extend(channel.recv(65536))
    if channel.recv_stderr_ready():
        print(channel.recv_stderr(65536).decode(), end="", flush=True)
    time.sleep(0.2)
status = channel.recv_exit_status()
(project / "build/requirement-live-results.json").write_bytes(data)
print("evaluation_process_exit=" + str(status))
sftp.close()
client.close()

"""Probe configured text/vision providers without exposing secrets or user content."""
import json
import os
import pathlib
import shlex
import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.96.184.148", username="root", password=os.environ["XIANMA_SERVER_PASSWORD"], timeout=20)
script = r'''
const env = process.env;
const routes = [
 [env.MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL,env.MODEL_GATEWAY_ERROR_FALLBACK_API_KEY,env.MODEL_GATEWAY_ERROR_FALLBACK_TEXT_MODEL],
 [env.MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL,env.MODEL_GATEWAY_ERROR_FALLBACK_API_KEY,env.MODEL_GATEWAY_ERROR_FALLBACK_VISION_MODEL],
 [env.MODEL_GATEWAY_FALLBACK_BASE_URL,env.MODEL_GATEWAY_FALLBACK_API_KEY,env.MODEL_GATEWAY_FALLBACK_MODEL]
];
(async()=>{
 const results=[];
 for(const [base,key,model] of routes){
  const start=Date.now();
  try {
   const response=await fetch(base.replace(/\/+$/," ").trim()+"/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},signal:AbortSignal.timeout(60000),body:JSON.stringify({model,messages:[{role:"user",content:"Reply with OK only."}],stream:false,max_tokens:64})});
   const value=await response.json().catch(()=>({}));
   results.push({model,status:response.status,hasReply:Boolean(value.choices?.[0]?.message?.content),elapsedMs:Date.now()-start});
  }catch(e){results.push({model,status:0,error:e.name,elapsedMs:Date.now()-start});}
 }
 console.log(JSON.stringify({ok:results.every(r=>r.status===200&&r.hasReply),results}));
})();
'''
try:
    _, out, err = client.exec_command("docker exec xianma-v11-preview-service-1 node -e " + shlex.quote(script), timeout=220)
    result = out.read()
    if out.channel.recv_exit_status():
        raise RuntimeError("Provider probe process failed")
    value = json.loads(result)
    (pathlib.Path(__file__).resolve().parent.parent / "build/preview-provider-check.json").write_bytes(result)
    print(json.dumps(value))
finally:
    client.close()

const fs = require("fs");
const path = require("path");

async function main() {
  const config = JSON.parse(fs.readFileSync("C:/ProgramData/XianmaAIStudio/ai-config.json", "utf8"));
  const baseUrl = String(config.apiBaseUrl || config.baseUrl || "").replace(/\/+$/, "");
  const apiKey = String(config.apiKey || "");
  const filePath = "C:/Users/Administrator/Downloads/拼多多智能Agent项目周会_20260811.mp3";
  const report = { configured: Boolean(baseUrl && apiKey), attempts: [] };
  if (!report.configured) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const model of ["gpt-4o-mini-transcribe", "whisper-1", "gpt-5.6-luna"]) {
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([fs.readFileSync(filePath)], { type: "audio/mpeg" }), path.basename(filePath));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal
      });
      const body = await response.text();
      report.attempts.push({
        model,
        status: response.status,
        ok: response.ok,
        response: body.slice(0, 300).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
      });
      if (response.ok) break;
    } catch (error) {
      report.attempts.push({ model, error: error.name || "Error" });
    } finally {
      clearTimeout(timer);
    }
  }
  const audioBase64 = fs.readFileSync(filePath).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model || "gpt-5.6-luna",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "请只转写这段中文录音的前两句话，不要解释。" },
            { type: "input_audio", input_audio: { data: audioBase64, format: "mp3" } }
          ]
        }],
        temperature: 0
      }),
      signal: controller.signal
    });
    const body = await response.text();
    report.chatAudio = {
      status: response.status,
      ok: response.ok,
      response: body.slice(0, 600).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    };
  } catch (error) {
    report.chatAudio = { error: error.name || "Error", message: String(error.message || "").slice(0, 100) };
  } finally {
    clearTimeout(timer);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

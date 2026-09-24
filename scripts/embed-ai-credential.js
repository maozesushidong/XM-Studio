const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputEnvelope = path.join(projectRoot, "electron", "bundled-ai-credential.json");
const outputKeyPart = path.join(projectRoot, "electron", "bundled-ai-key-part.json");
const defaultConfigPath = path.join(process.env.ProgramData || "C:\\ProgramData", "XianmaAIStudio", "ai-config.json");
const configPath = String(process.env.XIANMA_AI_CONFIG || defaultConfigPath).trim();

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

const config = readConfig();
const apiKey = String(process.env.XIANMA_AI_API_KEY || config.apiKey || "").trim();

if (!apiKey) {
  if (fs.existsSync(outputEnvelope) && fs.existsSync(outputKeyPart)) {
    process.stdout.write("Bundled model credential already exists; keeping the existing encrypted payload.\n");
    process.exit(0);
  }
  throw new Error(`No model credential found in XIANMA_AI_API_KEY or ${configPath}`);
}

const encryptionKey = crypto.randomBytes(32);
const keyPartA = crypto.randomBytes(32);
const keyPartB = Buffer.alloc(32);
for (let index = 0; index < encryptionKey.length; index += 1) {
  keyPartB[index] = encryptionKey[index] ^ keyPartA[index];
}

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();

fs.writeFileSync(outputEnvelope, JSON.stringify({
  version: 1,
  algorithm: "aes-256-gcm",
  keyPartA: keyPartA.toString("base64"),
  iv: iv.toString("base64"),
  tag: tag.toString("base64"),
  ciphertext: encrypted.toString("base64")
}, null, 2), "utf8");

fs.writeFileSync(outputKeyPart, JSON.stringify({
  version: 1,
  keyPartB: keyPartB.toString("base64")
}, null, 2), "utf8");

process.stdout.write("Bundled model credential prepared.\n");

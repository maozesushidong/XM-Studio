"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "config/plaintext");
const target = path.join(root, "update-service/deploy/v11-preview");
const env = JSON.parse(fs.readFileSync(path.join(source, "preview-service-environment.json"), "utf8"));
const postgres = JSON.parse(fs.readFileSync(path.join(source, "preview-postgres-environment.json"), "utf8"));
const dotenv = value => "'" + String(value).replace(/'/g, "\\'") + "'";
const ignored = new Set(["PATH", "HOME", "HOSTNAME", "NODE_VERSION", "YARN_VERSION"]);
const runtime = Object.entries(env).filter(([key]) => !ignored.has(key))
  .map(([key, value]) => `${key}=${dotenv(value)}`).join("\n") + "\n";
const compose = `POSTGRES_PASSWORD=${dotenv(postgres.POSTGRES_PASSWORD)}\nV11_ENV_FILE=runtime.env\n`;
const files = [
  [path.join(target, ".env"), Buffer.from(compose)],
  [path.join(target, "runtime.env"), Buffer.from(runtime)],
  [path.join(target, "secrets/update-signing-private.pem"), fs.readFileSync(path.join(source, "preview-signing-private.pem"))]
];
for (const [file, content] of files) {
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(content)) {
    throw new Error(`Existing local configuration differs: ${path.relative(root, file)}`);
  }
}
for (const [file, content] of files) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}
console.log(JSON.stringify({ prepared: files.length, localOnly: true, serverChanged: false }));

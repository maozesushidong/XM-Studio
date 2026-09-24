"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const delivery = path.join(root, "交付");
const sourceInstaller = path.join(root, "dist-1.4.0", "XMAI Studio Setup 1.4.0.exe");
const targetInstaller = path.join(delivery, "XMAI Studio Setup 1.4.0 本地测试版.exe");
const hashFile = path.join(delivery, "XMAI Studio Setup 1.4.0 本地测试版-SHA256.txt");
const serviceZipPath = path.join(delivery, "XMAI Studio 1.4.0 公司技能服务端手工部署包.zip");

const serviceFiles = [
  ["server.js", path.join(root, "update-service", "server.js")],
  ["company-skills.js", path.join(root, "update-service", "company-skills.js")],
  ["docker-compose.yml", path.join(root, "update-service", "docker-compose.yml")],
  [".env.example", path.join(root, "update-service", ".env.example")],
  ["public/admin.html", path.join(root, "update-service", "public", "admin.html")],
  ["手工部署说明.md", path.join(root, "update-service", "1.4.0服务端手工部署说明.md")]
];

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve);
  });
  return hash.digest("hex").toUpperCase();
}

async function main() {
  if (!fs.existsSync(sourceInstaller)) throw new Error(`找不到 1.4.0 安装包：${sourceInstaller}`);
  for (const [, sourcePath] of serviceFiles) {
    if (!fs.existsSync(sourcePath)) throw new Error(`服务端部署文件缺失：${sourcePath}`);
  }

  fs.mkdirSync(delivery, { recursive: true });
  fs.copyFileSync(sourceInstaller, targetInstaller);

  const zip = new JSZip();
  for (const [archivePath, sourcePath] of serviceFiles) zip.file(archivePath, fs.readFileSync(sourcePath));
  fs.writeFileSync(serviceZipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));

  const digest = await sha256(targetInstaller);
  const serviceDigest = await sha256(serviceZipPath);
  const hashText = [
    `安装包：${targetInstaller}`,
    `安装包 SHA-256：${digest}`,
    `安装包大小：${fs.statSync(targetInstaller).size} 字节`,
    "",
    `服务端包：${serviceZipPath}`,
    `服务端包 SHA-256：${serviceDigest}`,
    `服务端包大小：${fs.statSync(serviceZipPath).size} 字节`,
    "状态：本地测试版，未上传更新服务器",
    ""
  ].join("\r\n");
  fs.writeFileSync(hashFile, hashText, "utf8");

  process.stdout.write(`${JSON.stringify({
    installer: targetInstaller,
    installerBytes: fs.statSync(targetInstaller).size,
    installerSha256: digest,
    servicePackage: serviceZipPath,
    servicePackageBytes: fs.statSync(serviceZipPath).size,
    servicePackageSha256: serviceDigest,
    hashFile
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

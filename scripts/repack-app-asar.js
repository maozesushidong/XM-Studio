const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");
const { readReleaseMetadata } = require("./release-version");

const root = path.resolve(__dirname, "..");
const { packageVersion, releaseVersion: version } = readReleaseMetadata(root);
if (!version) throw new Error("package.json 缺少版本号");

function isInsideRoot(targetPath) {
  const relative = path.relative(root, path.resolve(targetPath));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findBaseAsar() {
  const explicitPath = String(process.env.XIANMA_BASE_ASAR || "").trim();
  if (explicitPath) return path.resolve(root, explicitPath);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^dist-\d/i.test(entry.name))
    .map((entry) => path.join(root, entry.name, "win-unpacked", "resources", "app.asar"))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || "";
}

async function main() {
  const baseAsar = findBaseAsar();
  if (!baseAsar || !fs.existsSync(baseAsar)) throw new Error("找不到可复用的已验证应用依赖归档");

  const configuredOutput = String(process.env.XIANMA_APP_RESOURCES_OUTPUT || "").trim();
  const outputDir = configuredOutput
    ? path.resolve(root, configuredOutput)
    : path.join(root, "build", `app-resources-${version}`);
  const stagingDir = `${outputDir}.staging`;
  for (const targetPath of [stagingDir, outputDir]) {
    if (!isInsideRoot(targetPath)) throw new Error(`拒绝清理工程外目录：${targetPath}`);
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  asar.extractAll(baseAsar, stagingDir);
  for (const directory of ["electron", "renderer"]) {
    const targetPath = path.join(stagingDir, directory);
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.cpSync(path.join(root, directory), targetPath, { recursive: true });
  }
  const previewBaseUrl = String(process.env.XIANMA_V11_PREVIEW_BASE_URL || "").trim().replace(/\/+$/, "");
  const previewChannel = String(process.env.XIANMA_V11_PREVIEW_CHANNEL || "v11-preview").trim();
  if (previewBaseUrl) {
    if (process.env.XIANMA_REQUIREMENT_PREVIEW === "1") {
      fs.writeFileSync(path.join(stagingDir, "electron", "build-flavor.json"), JSON.stringify({ flavor: "requirement-preview", baseUrl: previewBaseUrl, productVersion: version }, null, 2));
    }
    if (!/^https?:\/\//i.test(previewBaseUrl)) throw new Error("V1.1 测试服务地址必须使用 HTTP 或 HTTPS");
    if (!previewChannel || ["stable", "stable-v2"].includes(previewChannel)) {
      throw new Error("V1.1 测试包不能使用正式更新通道");
    }
    const stagedUpdateConfigPath = path.join(stagingDir, "electron", "update-config.json");
    const stagedUpdateConfig = JSON.parse(fs.readFileSync(stagedUpdateConfigPath, "utf8"));
    fs.writeFileSync(stagedUpdateConfigPath, `${JSON.stringify({
      ...stagedUpdateConfig,
      baseUrl: previewBaseUrl,
      channel: previewChannel,
      ...(process.env.XIANMA_REQUIREMENT_PREVIEW === "1" ? { isolatedPreview: true } : {})
    }, null, 2)}\n`, "utf8");
    const previewPublicKeyPath = String(process.env.XIANMA_V11_PREVIEW_SIGNING_PUBLIC_KEY || "").trim();
    if (!previewPublicKeyPath) throw new Error("V1.1 测试包必须提供测试服务签名公钥路径");
    const previewPublicKey = fs.readFileSync(path.resolve(root, previewPublicKeyPath), "utf8");
    if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(previewPublicKey)) {
      throw new Error("V1.1 测试服务签名公钥格式不正确");
    }
    fs.writeFileSync(path.join(stagingDir, "electron", "update-signing-public.pem"), previewPublicKey.trimEnd() + "\n", "utf8");
    fs.writeFileSync(path.join(stagingDir, "electron", "company-skill-signing-public.pem"), previewPublicKey.trimEnd() + "\n", "utf8");
  }
  if (/^1\.3\.0\.\d+$/.test(version)) {
    fs.rmSync(path.join(stagingDir, "electron", "company-skills.js"), { force: true });
  }
  fs.copyFileSync(path.join(root, "package.json"), path.join(stagingDir, "package.json"));

  const outputAsar = path.join(outputDir, "app.asar");
  await asar.createPackageWithOptions(stagingDir, outputAsar, {
    unpackDir: path.join("node_modules", "jszip")
  });

  const packedPackage = JSON.parse(asar.extractFile(outputAsar, "package.json").toString("utf8"));
  if (packedPackage.version !== packageVersion) throw new Error("新应用归档版本校验失败");
  for (const requiredFile of ["electron/main.js", "electron/preload.js", "renderer/app.js", "renderer/index.html", "renderer/styles.css"]) {
    if (!asar.extractFile(outputAsar, requiredFile).length) throw new Error(`新应用归档缺少 ${requiredFile}`);
  }

  process.stdout.write(`${JSON.stringify({
    repacked: true,
    version,
    packageVersion,
    baseAsar,
    outputAsar,
    bytes: fs.statSync(outputAsar).size,
    unpackedReady: fs.existsSync(`${outputAsar}.unpacked`)
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

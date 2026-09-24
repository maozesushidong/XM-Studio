"use strict";

const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readReleaseMetadata(projectRoot) {
  const packageJson = readJson(path.join(projectRoot, "package.json"));
  const updateConfig = readJson(path.join(projectRoot, "electron", "update-config.json"));
  const packageVersion = String(packageJson.version || "").trim();
  const releaseVersion = String(
    process.env.XIANMA_RELEASE_VERSION ||
    process.env.XIANMA_PACKAGE_VERSION ||
    updateConfig.internalVersion ||
    updateConfig.displayVersion ||
    packageVersion
  ).trim();
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    throw new Error(`package.json version must use npm-compatible x.y.z format: ${packageVersion}`);
  }
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(releaseVersion)) {
    throw new Error(`release version must use x.y.z or x.y.z.w format: ${releaseVersion}`);
  }
  return { packageJson, updateConfig, packageVersion, releaseVersion };
}

module.exports = { readReleaseMetadata };

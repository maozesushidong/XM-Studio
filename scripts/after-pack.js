const fs = require("fs");
const path = require("path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const outputRoot = context.appOutDir;
  const resourcesRoot = path.join(outputRoot, "resources");
  // Electron can keep the stock archive mapped briefly on Windows. It is not
  // required by the packaged app, so leave it in place when the handle is busy.
  try {
    await fs.promises.rm(path.join(resourcesRoot, "default_app.asar"), { force: true, maxRetries: 5, retryDelay: 250 });
  } catch (error) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
  }
  await fs.promises.rm(path.join(outputRoot, "version"), { force: true });

  const sourceLicense = path.join(outputRoot, "LICENSE");
  const targetLicense = path.join(outputRoot, "LICENSE.electron.txt");
  if (fs.existsSync(sourceLicense)) {
    await fs.promises.rm(targetLicense, { force: true });
    await fs.promises.rename(sourceLicense, targetLicense);
  }
};

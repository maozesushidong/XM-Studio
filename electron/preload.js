const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  requirementRequest: (payload) => ipcRenderer.invoke("desktop:requirement-request", payload),
  getBuildFlavor: () => ipcRenderer.invoke("desktop:build-flavor"),
  controlWindow: (action) => ipcRenderer.send("desktop:window-control", action),
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state"),
  getComputerOperationHistory: (payload) => ipcRenderer.invoke("desktop:get-computer-operation-history", payload),
  resolveComputerOperationConfirmation: (payload) => ipcRenderer.invoke("desktop:resolve-computer-operation-confirmation", payload),
  onComputerOperationConfirmation: (callback) => {
    const listener = (_event, operation) => callback(operation);
    ipcRenderer.on("desktop:computer-operation-confirmation", listener);
    return () => ipcRenderer.removeListener("desktop:computer-operation-confirmation", listener);
  },
  onComputerOperationStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop:computer-operation-status", listener);
    return () => ipcRenderer.removeListener("desktop:computer-operation-status", listener);
  },
  getStartupChatBackup: () => ipcRenderer.sendSync("desktop:get-startup-chat-backup"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  getUpdateStatus: () => ipcRenderer.invoke("desktop:get-update-status"),
  setAutoUpdateCheck: (enabled) => ipcRenderer.invoke("desktop:set-auto-update-check", enabled === true),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
  onWindowStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:window-state-changed", listener);
    return () => ipcRenderer.removeListener("desktop:window-state-changed", listener);
  },
  selectFiles: (payload) => ipcRenderer.invoke("desktop:select-files", payload),
  getInputFileMetadata: (payload) => ipcRenderer.invoke("desktop:get-input-file-metadata", payload),
  readClipboardFiles: () => ipcRenderer.invoke("desktop:read-clipboard-files"),
  saveClipboardImage: (payload) => ipcRenderer.invoke("desktop:save-clipboard-image", payload),
  selectFolder: () => ipcRenderer.invoke("desktop:select-folder"),
  getUserWorkspace: (payload) => ipcRenderer.invoke("desktop:get-user-workspace", payload),
  writeWorkspaceFile: (payload) => ipcRenderer.invoke("desktop:write-workspace-file", payload),
  readWorkspaceFile: (payload) => ipcRenderer.invoke("desktop:read-workspace-file", payload),
  runWorkspaceCommand: (payload) => ipcRenderer.invoke("desktop:run-workspace-command", payload),
  createWebPreview: (payload) => ipcRenderer.invoke("desktop:create-web-preview", payload),
  previewWorkspaceFile: (payload) => ipcRenderer.invoke("desktop:preview-workspace-file", payload),
  openWorkspaceFile: (payload) => ipcRenderer.invoke("desktop:open-workspace-file", payload),
  openPromptLibrary: () => ipcRenderer.invoke("desktop:open-prompt-library"),
  getPublicPromptLibrary: (payload) => ipcRenderer.invoke("desktop:get-public-prompt-library", payload),
  getInstalledSkills: (payload) => ipcRenderer.invoke("desktop:get-installed-skills", payload),
  getInstalledSkillSource: (payload) => ipcRenderer.invoke("desktop:get-installed-skill-source", payload),
  downloadInstalledSkillPackage: (payload) => ipcRenderer.invoke("desktop:download-installed-skill-package", payload),
  openInstalledSkillSource: (payload) => ipcRenderer.invoke("desktop:open-installed-skill-source", payload),
  updateInstalledSkill: (payload) => ipcRenderer.invoke("desktop:update-installed-skill", payload),
  selectSkillSource: (payload) => ipcRenderer.invoke("desktop:select-skill-source", payload),
  selectSkill: () => ipcRenderer.invoke("desktop:select-skill-source", { sourceType: "unified" }),
  selectSkillFile: () => ipcRenderer.invoke("desktop:select-skill-source", { sourceType: "file" }),
  selectSkillFolder: () => ipcRenderer.invoke("desktop:select-skill-source", { sourceType: "folder" }),
  inspectSkillSource: (payload) => ipcRenderer.invoke("desktop:inspect-skill-source", payload),
  installSkill: (payload) => ipcRenderer.invoke("desktop:install-skill", payload),
  onSkillInstallProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("desktop:skill-install-progress", listener);
    return () => ipcRenderer.removeListener("desktop:skill-install-progress", listener);
  },
  searchOnlineSkills: (payload) => ipcRenderer.invoke("desktop:search-online-skills", payload),
  inspectOnlineSkill: (payload) => ipcRenderer.invoke("desktop:inspect-online-skill", payload),
  installOnlineSkill: (payload) => ipcRenderer.invoke("desktop:install-online-skill", payload),
  removeInstalledSkill: (payload) => ipcRenderer.invoke("desktop:remove-installed-skill", payload),
  createSkillPackage: (payload) => ipcRenderer.invoke("desktop:create-skill-package", payload),
  inspectCompanySkill: (payload) => ipcRenderer.invoke("desktop:inspect-company-skill", payload),
  prepareInstalledSkillSubmission: (payload) => ipcRenderer.invoke("desktop:prepare-installed-skill-submission", payload),
  submitCompanySkill: (payload) => ipcRenderer.invoke("desktop:submit-company-skill", payload),
  getMySkillSubmissions: () => ipcRenderer.invoke("desktop:get-my-skill-submissions"),
  withdrawSkillSubmission: (payload) => ipcRenderer.invoke("desktop:withdraw-skill-submission", payload),
  getCompanySkillCatalog: () => ipcRenderer.invoke("desktop:get-company-skill-catalog"),
  getSkillTaxonomy: () => ipcRenderer.invoke("desktop:get-skill-taxonomy"),
  installCompanySkill: (payload) => ipcRenderer.invoke("desktop:install-company-skill", payload),
  downloadCompanySkillPackage: (payload) => ipcRenderer.invoke("desktop:download-company-skill-package", payload),
  syncCompanySkills: (payload) => ipcRenderer.invoke("desktop:sync-company-skills", payload),
  downloadSkillTemplate: () => ipcRenderer.invoke("desktop:download-skill-template"),
  reportCompanySkillUsage: (payload) => ipcRenderer.invoke("desktop:report-company-skill-usage", payload),
  reportV11Facts: (payload) => ipcRenderer.invoke("desktop:report-v11-facts", payload),
  onCompanySkillProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("desktop:company-skill-progress", listener);
    return () => ipcRenderer.removeListener("desktop:company-skill-progress", listener);
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  dingtalkLogin: () => ipcRenderer.invoke("desktop:dingtalk-login"),
  getDingtalkSession: () => ipcRenderer.invoke("desktop:get-dingtalk-session"),
  dingtalkLogout: () => ipcRenderer.invoke("desktop:dingtalk-logout"),
  openPath: (targetPath) => ipcRenderer.invoke("desktop:open-path", targetPath),
  previewLocalFile: (targetPath) => ipcRenderer.invoke("desktop:preview-local-file", targetPath),
  previewArtifact: (targetPath) => ipcRenderer.invoke("desktop:preview-artifact", targetPath),
  copyArtifact: (targetPath) => ipcRenderer.invoke("desktop:copy-artifact", targetPath),
  downloadArtifact: (targetPath) => ipcRenderer.invoke("desktop:download-artifact", targetPath),
  showFileContextMenu: (targetPath) => ipcRenderer.invoke("desktop:show-file-context-menu", targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke("desktop:show-item-in-folder", targetPath),
  copyText: (text) => ipcRenderer.invoke("desktop:copy-text", text),
  notify: (title, body) => ipcRenderer.invoke("desktop:notify", { title, body }),
  getAiRuntimeConfig: () => ipcRenderer.invoke("desktop:get-ai-runtime-config"),
  getGatewayConfig: (payload) => ipcRenderer.invoke("desktop:get-gateway-config", payload),
  getRuntimeSetupStatus: () => ipcRenderer.invoke("desktop:get-runtime-setup-status"),
  prepareRuntime: () => ipcRenderer.invoke("desktop:prepare-runtime"),
  cancelRuntimeSetup: () => ipcRenderer.invoke("desktop:cancel-runtime-setup"),
  onRuntimeSetupProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop:runtime-setup-progress", listener);
    return () => ipcRenderer.removeListener("desktop:runtime-setup-progress", listener);
  },
  getWorkData: (payload) => ipcRenderer.invoke("desktop:get-work-data", payload),
  saveAutomation: (payload) => ipcRenderer.invoke("desktop:save-automation", payload),
  deleteAutomation: (payload) => ipcRenderer.invoke("desktop:delete-automation", payload),
  setAutomationEnabled: (payload) => ipcRenderer.invoke("desktop:set-automation-enabled", payload),
  runAutomationNow: (payload) => ipcRenderer.invoke("desktop:run-automation-now", payload),
  pauseAutomation: (payload) => ipcRenderer.invoke("desktop:pause-automation", payload),
  onAutomationUpdated: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("desktop:automation-updated", listener);
    return () => ipcRenderer.removeListener("desktop:automation-updated", listener);
  },
  createTaskResult: (payload) => ipcRenderer.invoke("desktop:create-task-result", payload),
  downloadTaskResult: (payload) => ipcRenderer.invoke("desktop:download-task-result", payload),
  openTaskResultFolder: (payload) => ipcRenderer.invoke("desktop:open-task-result-folder", payload),
  chatCompletion: (payload) => ipcRenderer.invoke("desktop:chat-completion", payload),
  cancelChatCompletion: (requestId) => ipcRenderer.invoke("desktop:cancel-chat-completion", requestId),
  getBrowserTask: (payload) => ipcRenderer.invoke("desktop:get-browser-task", payload),
  openBrowserTask: (payload) => ipcRenderer.invoke("desktop:open-browser-task", payload),
  pauseBrowserTask: (payload) => ipcRenderer.invoke("desktop:pause-browser-task", payload),
  resumeBrowserTask: (payload) => ipcRenderer.invoke("desktop:resume-browser-task", payload),
  onChatCompletionChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("desktop:chat-completion-chunk", listener);
    return () => ipcRenderer.removeListener("desktop:chat-completion-chunk", listener);
  },
  onGenerationProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("desktop:generation-progress", listener);
    return () => ipcRenderer.removeListener("desktop:generation-progress", listener);
  },
  generateImage: (payload) => ipcRenderer.invoke("desktop:generate-image", payload)
});

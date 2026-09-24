"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("fs"), path = require("path"), assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "build/workspace-model-ui");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { contextIsolation: true } });
  await win.loadFile(path.join(root, "renderer/index.html"));
  const models = require("../electron/preview-models.json").map(value => ({ value, label: value, kind: value.startsWith("gpt-image-") ? "image" : "chat" }));
  await win.webContents.executeJavaScript(`document.getElementById('loginModal').classList.add('hidden');state.modelOptions=[{value:'auto',label:'Auto 自动选择',kind:'auto'},...${JSON.stringify(models)}];renderModelPicker();toggleModelPicker();`);
  const reports = [];
  for (const [width,height] of [[1280,850],[1024,720]]) {
    win.setSize(width,height);
    await new Promise(r=>setTimeout(r,120));
    const metrics = await win.webContents.executeJavaScript(`(()=>{const menu=document.getElementById('modelDropdown'),list=menu.querySelector('.model-options-list'),r=menu.getBoundingClientRect();return {count:list.querySelectorAll('[data-model-value]').length,top:r.top,bottom:r.bottom,height:innerHeight,scrollable:list.scrollHeight>list.clientHeight,last:list.querySelector('[data-model-value="gemini-3.6-flash"]')?.innerText,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.equal(metrics.count,16); assert(metrics.scrollable && !metrics.overflow && metrics.top>=0 && metrics.bottom<=metrics.height,JSON.stringify(metrics)); assert(metrics.last.includes("gemini"));
    reports.push({width,height,...metrics});
    fs.writeFileSync(path.join(output,`models-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
  const search = await win.webContents.executeJavaScript(`(()=>{const field=document.querySelector('.model-catalog-search input');field.value='gemini';field.dispatchEvent(new Event('input',{bubbles:true}));const same=field===document.querySelector('.model-catalog-search input');const button=document.querySelector('[data-model-value="gemini-3.6-flash"]');button.click();return {same,selected:state.config.model};})()`);
  assert(search.same); assert.equal(search.selected,"gemini-3.6-flash");
  fs.writeFileSync(path.join(output,"results.json"),JSON.stringify({ok:true,reports,search},null,2));
  console.log(JSON.stringify({ok:true,count:16,searchable:true,viewports:reports.map(r=>r.width)}));
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});

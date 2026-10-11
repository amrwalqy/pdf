/* Alif — optional update channel (electron-updater).
   Nothing is downloaded or installed without an explicit action in the About dialog.
   The feed comes from ALIF_UPDATE_URL, or from the publish settings written into a packaged build.
   Without a real feed the channel stays off and makes no network request. */

const { app, ipcMain } = require("electron");
const { resolveFeedUrl, readAppUpdateUrl } = require("./update-feed.cjs");

let autoUpdater = null;
let status = {
  supported: false,
  configured: false,
  note: null,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  progress: 0,
  version: null,
  releaseNotes: null,
  error: null,
};
let mainWindow = null;
let listenersWired = false;

function pushStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("alif:update-status", { ...status });
  }
}

function setStatus(patch) {
  status = { ...status, ...patch };
  pushStatus();
}

function resolveFeed() {
  const fromEnv = resolveFeedUrl(process.env.ALIF_UPDATE_URL);
  if (fromEnv.configured || !app.isPackaged) return fromEnv;
  return resolveFeedUrl(readAppUpdateUrl(process.resourcesPath));
}

function tryLoadUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    // Lazy require: a missing dependency must never stop the app from starting.
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = false; // a download starts only when the user asks for it
    autoUpdater.autoInstallOnAppQuit = false; // an install happens only when the user asks for it
    autoUpdater.allowDowngrade = false;
    return autoUpdater;
  } catch {
    setStatus({ supported: false, error: "وحدة التحديث غير متوفرة في هذا البناء" });
    return null;
  }
}

function wireEvents(updater) {
  if (listenersWired) return;
  listenersWired = true;

  updater.on("checking-for-update", () => {
    setStatus({ checking: true, error: null });
  });
  updater.on("update-available", (info) => {
    setStatus({
      checking: false,
      available: true,
      version: info?.version || null,
      releaseNotes: typeof info?.releaseNotes === "string" ? info.releaseNotes : null,
      error: null,
    });
  });
  updater.on("update-not-available", () => {
    setStatus({ checking: false, available: false, version: null, error: null });
  });
  updater.on("download-progress", (p) => {
    setStatus({ downloading: true, progress: Math.round(p?.percent || 0) });
  });
  updater.on("update-downloaded", (info) => {
    setStatus({
      downloading: false,
      downloaded: true,
      progress: 100,
      version: info?.version || status.version,
      error: null,
    });
  });
  updater.on("error", (err) => {
    setStatus({ checking: false, downloading: false, error: err?.message || String(err) });
  });
}

function applyFeed(updater) {
  const feed = resolveFeed();
  setStatus({ configured: feed.configured, note: feed.reason });
  if (!feed.configured) return false;
  updater.setFeedURL({ provider: "generic", url: feed.url });
  return true;
}

function initUpdater(getWindow) {
  mainWindow = typeof getWindow === "function" ? getWindow() : getWindow;
  setStatus({ supported: !!app.isPackaged, error: null });
  if (!app.isPackaged) return; // development runs never check for updates
  const updater = tryLoadUpdater();
  if (updater) wireEvents(updater);
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setStatus({ supported: false, error: "التحديث التلقائي يعمل فقط في النسخة المثبّتة" });
    return status;
  }
  const updater = tryLoadUpdater();
  if (!updater) return status;
  wireEvents(updater);
  if (!applyFeed(updater)) return status; // no real feed: nothing is requested from the network
  setStatus({ checking: true, error: null });
  try {
    await updater.checkForUpdates();
  } catch (err) {
    setStatus({ checking: false, error: err?.message || String(err) });
  }
  return status;
}

async function downloadUpdate() {
  if (!status.available) {
    setStatus({ error: "لا يوجد تحديث متاح للتنزيل" });
    return status;
  }
  const updater = tryLoadUpdater();
  if (!updater) return status;
  setStatus({ downloading: true, progress: 0, error: null });
  try {
    await updater.downloadUpdate();
  } catch (err) {
    setStatus({ downloading: false, error: err?.message || String(err) });
  }
  return status;
}

function installUpdate() {
  if (!status.downloaded) {
    setStatus({ error: "لم يكتمل تنزيل التحديث بعد" });
    return status;
  }
  const updater = tryLoadUpdater();
  if (!updater) return status;
  // The user pressed the install button in the About dialog, so quitting and installing now is intended.
  setImmediate(() => {
    try {
      updater.quitAndInstall(false, true);
    } catch (err) {
      setStatus({ error: err?.message || String(err) });
    }
  });
  return status;
}

function getStatus() {
  return { ...status };
}

function registerUpdateIpc(assertSender, getWindow) {
  ipcMain.handle("alif:update-status", async (e) => {
    assertSender(e);
    mainWindow = getWindow();
    return getStatus();
  });
  ipcMain.handle("alif:update-check", async (e) => {
    assertSender(e);
    mainWindow = getWindow();
    return await checkForUpdates();
  });
  ipcMain.handle("alif:update-download", async (e) => {
    assertSender(e);
    mainWindow = getWindow();
    return await downloadUpdate();
  });
  ipcMain.handle("alif:update-install", async (e) => {
    assertSender(e);
    mainWindow = getWindow();
    return installUpdate();
  });
}

module.exports = {
  initUpdater,
  registerUpdateIpc,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getStatus,
};

/* Alif — Electron main process (Windows .exe).
   Real disk info, native folder/file dialogs, recursive PDF scan & shelves tree,
   Windows PDF file association & default reader registry integration,
   hardware-backed AES-256-GCM Secure Vault,
   and async fs & path security guard. */

const { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, screen, session, shell } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const { VaultManager } = require("./vault.cjs");
const { PathSecurity } = require("./paths.cjs");
const { planRename } = require("./rename.cjs");
const { parseWindowState } = require("./window-state.cjs");
const { scanLibraryTree } = require("./library-scan.cjs");
const { LibraryIndex } = require("./library-index.cjs");
const { initUpdater, registerUpdateIpc } = require("./updater.cjs");

// Declared before the app is ready. It lets pdf.js read a library PDF in byte ranges (see registerAlifFileProtocol).
protocol.registerSchemesAsPrivileged([
  { scheme: "alif-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

/* ---------- Diagnostics log (%APPDATA%\\Alif\\logs\\alif.log) ---------- */

const LOG_MAX_BYTES = 1024 * 1024;

function logPath() {
  return path.join(app.getPath("logs"), "alif.log");
}

function writeLog(level, message, detail) {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) {
      fs.renameSync(file, file.replace(/\.log$/, ".previous.log"));
    }
    const suffix = detail ? ` | ${detail}` : "";
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}${suffix}\n`, "utf8");
  } catch {
    /* Logging must never take the application down. */
  }
}

process.on("uncaughtException", (error) => writeLog("ERROR", "uncaught exception", error?.stack || error));
process.on("unhandledRejection", (reason) => writeLog("ERROR", "unhandled rejection", reason?.stack || reason));

/* ---------- Session hardening ---------- */

// Only what the reader needs. Camera, microphone, location, notifications and the rest are refused.
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);

function configureSessionSecurity() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS.has(permission));
}

let rendererRecoveries = 0;

function guardRenderer(webContents) {
  webContents.on("render-process-gone", (_event, details) => {
    writeLog("ERROR", "renderer process ended", `${details.reason} (exit code ${details.exitCode})`);
    if (details.reason !== "clean-exit" && rendererRecoveries < 3) {
      rendererRecoveries += 1;
      webContents.reload();
    }
  });
  webContents.on("unresponsive", () => writeLog("WARN", "renderer is not responding"));
}

app.on("child-process-gone", (_event, details) => {
  writeLog("WARN", "child process ended", `${details.type}: ${details.reason}`);
});

/* ---------- Window size & position ---------- */

function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readSavedWindowState() {
  try {
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    return parseWindowState(fs.readFileSync(windowStateFile(), "utf8"), workAreas);
  } catch {
    return null;
  }
}

let windowStateTimer = null;

let windowStateTarget = null;

function saveWindowStateNow(target = windowStateTarget) {
  if (!target || target.isDestroyed()) return;
  try {
    const maximized = target.isMaximized();
    const bounds = maximized ? target.getNormalBounds() : target.getBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({ ...bounds, maximized }), "utf8");
  } catch (error) {
    writeLog("WARN", "could not save window state", error?.message);
  }
}

function scheduleWindowStateSave(target) {
  windowStateTarget = target;
  clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(saveWindowStateNow, 400);
}

try {
  app.setAppUserModelId("com.alif.reader");
  app.setName("Alif");
} catch {
  /* ignore */
}

// Every open window. Each one is independent: it has its own documents, pin state and loading state.
const windows = new Set();
const windowStates = new WeakMap(); // window -> { ready, pending, pinned, pinTimer, openedPath }

function stateOf(target) {
  let st = windowStates.get(target);
  if (!st) {
    st = { ready: false, pending: [], loading: null, pinned: false, pinTimer: null, openedPath: null };
    windowStates.set(target, st);
  }
  return st;
}

/** The window the user is working in: the focused one, else the most recently created. */
function activeWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused) && !focused.isDestroyed()) return focused;
  let last = null;
  for (const w of windows) if (!w.isDestroyed()) last = w;
  return last;
}

/** The window that sent an IPC message, so each window answers only for itself. */
function senderWindow(event) {
  const w = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  return w && !w.isDestroyed() ? w : activeWindow();
}

function broadcast(channel, payload, { onlyReady = false } = {}) {
  for (const w of windows) {
    if (w.isDestroyed()) continue;
    if (onlyReady && !stateOf(w).ready) continue;
    w.webContents.send(channel, payload);
  }
}
let watcher = null;
let watchDir = null;

function libFile() {
  return path.join(app.getPath("userData"), "alif-library.json");
}

// The library setting is read once and kept in memory; every change is written back to disk.
let libraryCache;

function loadLibrary() {
  if (libraryCache !== undefined) return libraryCache;
  try {
    libraryCache = JSON.parse(fs.readFileSync(libFile(), "utf8"));
  } catch {
    libraryCache = null;
  }
  return libraryCache;
}

async function saveLibrary(payload) {
  libraryCache = payload || {};
  try {
    await fsp.writeFile(libFile(), JSON.stringify(libraryCache), "utf8");
  } catch {
    /* ignore */
  }
}

/* ---------- Library folder from the command line ---------- */

// `Alif.exe --library "D:\Books"` opens Alif on that folder, for example from a desktop shortcut.
function libraryArgument(argv) {
  const index = argv.indexOf("--library");
  if (index !== -1 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith("--library="));
  return inline ? inline.slice("--library=".length) : null;
}

async function applyLibraryArgument() {
  const requested = libraryArgument(process.argv);
  if (!requested) return;
  try {
    const stat = await fsp.stat(requested);
    if (!stat.isDirectory()) return;
  } catch {
    writeLog("WARN", "library folder from the command line does not exist", requested);
    return;
  }
  pathSecurity.addAllowedRoot(requested);
  await saveLibrary({ path: requested });
}

// Path security
const pathSecurity = new PathSecurity(() => (loadLibrary() || {}).path);

// Vault manager
const vaultManager = new VaultManager(
  () => app.getPath("userData"),
  () => {
    broadcast("vault:autolocked");
  }
);

/* ---------- Windows PDF file association ---------- */

const PROG_ID = "Alif.PDF";

function appExecutable() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return process.env.PORTABLE_EXECUTABLE_FILE;
  }
  return process.execPath;
}

function runReg(args) {
  return new Promise((resolve) => {
    execFile("reg.exe", args, { windowsHide: true }, (err, stdout) => {
      if (err) resolve({ success: false, stdout: "" });
      else resolve({ success: true, stdout });
    });
  });
}

async function regQuery(key, valueName) {
  const args = ["query", key];
  if (valueName) args.push("/v", valueName);
  else args.push("/ve");
  const r = await runReg(args);
  return r.success ? r.stdout : null;
}

async function registerPdfHandler() {
  if (process.platform !== "win32") {
    return { registered: false, isDefault: false, progId: PROG_ID };
  }
  const exe = appExecutable();
  // The packaged .exe embeds the Alif icon (build/icon.ico), so Explorer reads it from the executable itself.
  const iconPath = `${exe},0`;
  const openCmd = `"${exe}" "%1"`;

  await runReg(["add", `HKCU\\Software\\Classes\\${PROG_ID}`, "/ve", "/d", "PDF Document", "/f"]);
  await runReg(["add", `HKCU\\Software\\Classes\\${PROG_ID}\\DefaultIcon`, "/ve", "/d", iconPath, "/f"]);
  await runReg(["add", `HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`, "/ve", "/d", openCmd, "/f"]);
  await runReg(["add", `HKCU\\Software\\Classes\\.pdf\\OpenWithProgids`, "/v", PROG_ID, "/t", "REG_NONE", "/d", "", "/f"]);
  await runReg(["add", `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithProgids`, "/v", PROG_ID, "/t", "REG_NONE", "/d", "", "/f"]);
  await runReg(["add", `HKCU\\Software\\RegisteredApplications`, "/v", "Alif", "/d", "Software\\Alif\\Capabilities", "/f"]);
  await runReg(["add", `HKCU\\Software\\Alif\\Capabilities`, "/v", "ApplicationName", "/d", "Alif", "/f"]);
  await runReg(["add", `HKCU\\Software\\Alif\\Capabilities`, "/v", "ApplicationDescription", "/d", "أليف - قارئ PDF ومستودع المخطوطات", "/f"]);
  await runReg(["add", `HKCU\\Software\\Alif\\Capabilities\\FileAssociations`, "/v", ".pdf", "/d", PROG_ID, "/f"]);

  return await pdfAssociationStatus();
}

async function unregisterPdfHandler() {
  if (process.platform !== "win32") {
    return { registered: false, isDefault: false, progId: PROG_ID };
  }
  await runReg(["delete", `HKCU\\Software\\Classes\\${PROG_ID}`, "/f"]);
  await runReg(["delete", `HKCU\\Software\\Alif`, "/f"]);
  await runReg(["delete", `HKCU\\Software\\RegisteredApplications`, "/v", "Alif", "/f"]);
  await runReg(["delete", `HKCU\\Software\\Classes\\.pdf\\OpenWithProgids`, "/v", PROG_ID, "/f"]);
  await runReg(["delete", `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithProgids`, "/v", PROG_ID, "/f"]);
  return await pdfAssociationStatus();
}

async function pdfAssociationStatus() {
  if (process.platform !== "win32") {
    return { registered: false, isDefault: false, progId: PROG_ID };
  }
  const cmd = await regQuery(`HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`);
  const registered = !!(cmd && (cmd.includes(PROG_ID) || cmd.includes(path.basename(appExecutable()))));

  const userChoice = await regQuery(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice`, "ProgId");
  const isDefault = !!(userChoice && userChoice.includes(PROG_ID));

  return { registered: !!registered, isDefault: !!isDefault, progId: PROG_ID, command: cmd || undefined };
}

async function openDefaultAppsSettings() {
  try {
    await shell.openExternal("ms-settings:defaultapps?registeredAppUser=Alif");
  } catch {
    try {
      await shell.openExternal("ms-settings:defaultapps");
    } catch {
      /* ignore */
    }
  }
}

async function makePdfDefault() {
  await registerPdfHandler();
  await openDefaultAppsSettings();
  return await pdfAssociationStatus();
}

/* ---------- open PDFs from Explorer ---------- */

function extractPdfPaths(argv) {
  const out = [];
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith("--")) continue;
    if (!/\.pdf$/i.test(raw)) continue;
    try {
      const full = path.resolve(raw);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) out.push(full);
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function readPdfObjectAsync(filePath) {
  try {
    pathSecurity.addAllowedFile(filePath);
    const st = await fsp.stat(filePath);
    const buf = await fsp.readFile(filePath);
    try {
      app.addRecentDocument(filePath); // shows in the taskbar jump list and Explorer's recent files
    } catch {
      /* ignore */
    }
    return {
      name: path.basename(filePath),
      path: filePath,
      size: st.size,
      lastModified: Math.floor(st.mtimeMs),
      data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  } catch {
    return null;
  }
}

function focusWindow(target) {
  if (!target || target.isDestroyed()) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

/**
 * Opens each PDF in its own new window and leaves every other window open.
 * A file that is already open in a window just brings that window to the front.
 */
async function openPdfsInNewWindows(paths) {
  for (const p of paths || []) {
    const existing = [...windows].find((w) => !w.isDestroyed() && stateOf(w).openedPath === p);
    if (existing) {
      focusWindow(existing);
      continue;
    }
    createWindow(readPdfObjectAsync(p).then((item) => (item ? [item] : [])));
    // The window opens at once; its file is read while the page loads.
  }
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const files = extractPdfPaths(argv);
    if (files.length) void openPdfsInNewWindows(files);
    else createWindow(); // starting Alif again opens another empty window
  });
}

// Files given on the first launch (double-click in Explorer). Opened once the app is ready.
const initialPaths = extractPdfPaths(process.argv);

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) void openPdfsInNewWindows([filePath]);
  else initialPaths.push(filePath);
});

/* ---------- Application Window ---------- */

const isDev = process.argv.includes("--dev") || !!process.env.VITE_DEV_SERVER_URL;

function windowIcon() {
  // Packaged app serves the logo from dist/ (copied from public/); dev falls back to public/.
  const candidates = [
    path.join(__dirname, "..", "dist", "alif-icon.ico"),
    path.join(__dirname, "..", "public", "alif-icon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
    path.join(__dirname, "..", "dist", "alif-logo.png"),
    path.join(__dirname, "..", "public", "alif-logo.png"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Opens a window right away. `source` is the PDF files for it (or a promise of them): the window never waits for
 * large files to be read, and the page receives them as soon as it asks.
 */
function createWindow(source = [], { restoreSession = false } = {}) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const reference = activeWindow();
  const saved = windows.size === 0 ? readSavedWindowState() : null;
  let size;
  let cascaded = false;
  if (reference) {
    // Additional windows open slightly offset from the one in use, so they never hide each other exactly.
    const b = reference.isMaximized() ? reference.getNormalBounds() : reference.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    let x = b.x + 32;
    let y = b.y + 32;
    if (x + b.width > area.x + area.width || y + b.height > area.y + area.height) {
      x = area.x + 24;
      y = area.y + 24;
    }
    size = { x, y, width: b.width, height: b.height };
    cascaded = true;
  } else if (saved) {
    size = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  } else {
    size = { width: Math.min(1440, Math.round(screenWidth * 0.9)), height: Math.min(900, Math.round(screenHeight * 0.9)) };
  }
  const win = new BrowserWindow({
    ...size,
    // Allow a genuinely tiny floating mini-reader; CSS keeps the PDF essentials usable.
    // The operating system still reserves a small non-client frame around the content.
    minWidth: 120,
    minHeight: 80,
    resizable: true,
    center: !saved && !cascaded,
    title: "Alif PDF Reader — أليف",
    icon: windowIcon(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#090909",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  windows.add(win);
  const st = stateOf(win);
  st.pending = [];
  st.loading = Promise.resolve(source)
    .then((items) => {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      st.pending = list;
      if (list.length === 1) st.openedPath = list[0].path;
      // The page may already be waiting (it asked before the files were read): hand them over now.
      if (st.ready && list.length && !win.isDestroyed()) {
        st.pending = [];
        for (const item of list) win.webContents.send("alif:open-file", item);
      }
    })
    .catch((error) => writeLog("WARN", "could not read the startup file", error?.message));

  guardRenderer(win.webContents);
  if (saved?.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 5000);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(restoreSession ? `${process.env.VITE_DEV_SERVER_URL}?session=1` : process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"), restoreSession ? { query: { session: "1" } } : undefined);
  }

  // Navigation and external link security
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("did-finish-load", () => {
    try {
      win.webContents.setVisualZoomLevelLimits(1, 1);
    } catch {
      /* ignore */
    }
  });

  win.on("blur", () => {
    if (st.pinned && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, "screen-saver", 1);
      win.moveTop();
    }
  });
  // Ctrl+N opens another window.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && !input.shift && !input.alt && !input.meta && input.key.toLowerCase() === "n") {
      event.preventDefault();
      createWindow();
    }
  });
  win.on("resize", () => scheduleWindowStateSave(win));
  win.on("move", () => scheduleWindowStateSave(win));
  win.on("close", () => {
    clearTimeout(windowStateTimer);
    saveWindowStateNow(win);
  });
  win.on("enter-full-screen", () => sendPinState(win));
  win.on("leave-full-screen", () => sendPinState(win));
  win.on("maximize", () => sendWindowState(win));
  win.on("unmaximize", () => sendWindowState(win));

  win.webContents.on("did-start-loading", () => {
    st.ready = false;
  });

  win.on("closed", () => {
    if (st.pinTimer) clearInterval(st.pinTimer);
    st.pinTimer = null;
    st.ready = false;
    windows.delete(win);
    // The vault stays unlocked while any window is still open, and locks when the last one closes.
    if (windows.size === 0) vaultManager.lock();
  });
  return win;
}

/* ---------- pin on top ---------- */

function sendPinState(target) {
  if (!target || target.isDestroyed()) return;
  target.webContents.send("alif:pin-state", { pinned: stateOf(target).pinned, fullscreen: target.isFullScreen() });
}

function sendWindowState(target) {
  if (!target || target.isDestroyed()) return;
  target.webContents.send("alif:window-state", { maximized: target.isMaximized() });
}

function setPinned(target, flag) {
  if (!target || target.isDestroyed()) return;
  const st = stateOf(target);
  st.pinned = !!flag;
  target.setAlwaysOnTop(st.pinned, st.pinned ? "screen-saver" : "normal", st.pinned ? 1 : 0);
  target.setVisibleOnAllWorkspaces(st.pinned, { visibleOnFullScreen: true });
  target.setSkipTaskbar(false);
  if (st.pinTimer) clearInterval(st.pinTimer);
  st.pinTimer = null;
  if (st.pinned) {
    target.moveTop();
    st.pinTimer = setInterval(() => {
      if (!target.isDestroyed() && st.pinned && !target.isAlwaysOnTop()) {
        target.setAlwaysOnTop(true, "screen-saver", 1);
        target.moveTop();
      }
    }, 1500);
  }
  sendPinState(target);
}

// Security: Validate sender frame origin
function assertSender(event) {
  const url = event?.senderFrame?.url || "";
  if (isDev) return true;
  if (url.startsWith("file://")) return true;
  throw new Error("Unauthorized sender frame");
}

/* ---------- IPC Handlers ---------- */

// Pin & window state
ipcMain.handle("alif:set-pin", async (e, flag) => {
  assertSender(e);
  const w = senderWindow(e);
  setPinned(w, flag);
  return { pinned: !!w && stateOf(w).pinned, fullscreen: w ? w.isFullScreen() : false };
});
ipcMain.handle("alif:get-pin", async (e) => {
  assertSender(e);
  const w = senderWindow(e);
  return { pinned: !!w && stateOf(w).pinned, fullscreen: w ? w.isFullScreen() : false };
});
ipcMain.handle("alif:set-fullscreen", async (e, flag) => {
  assertSender(e);
  const w = senderWindow(e);
  if (w) w.setFullScreen(!!flag);
  return { pinned: !!w && stateOf(w).pinned, fullscreen: w ? w.isFullScreen() : false };
});
ipcMain.handle("alif:window-minimize", async (e) => {
  assertSender(e);
  senderWindow(e)?.minimize();
  return true;
});
ipcMain.handle("alif:window-toggle-maximize", async (e) => {
  assertSender(e);
  const w = senderWindow(e);
  if (!w) return false;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
  return w.isMaximized();
});
ipcMain.handle("alif:window-close", async (e) => {
  assertSender(e);
  senderWindow(e)?.close();
  return true;
});
ipcMain.handle("alif:window-state", async (e) => {
  assertSender(e);
  const w = senderWindow(e);
  return { maximized: !!w && w.isMaximized() };
});

// PDF file association
ipcMain.handle("alif:associate-pdf", async (e) => {
  assertSender(e);
  return registerPdfHandler();
});
ipcMain.handle("alif:unregister-pdf", async (e) => {
  assertSender(e);
  return unregisterPdfHandler();
});
ipcMain.handle("alif:pdf-association-status", async (e) => {
  assertSender(e);
  return pdfAssociationStatus();
});
ipcMain.handle("alif:make-pdf-default", async (e) => {
  assertSender(e);
  return makePdfDefault();
});
ipcMain.handle("alif:open-default-apps", async (e) => {
  assertSender(e);
  await openDefaultAppsSettings();
});
ipcMain.handle("alif:take-pending-files", async (e) => {
  assertSender(e);
  const w = senderWindow(e);
  if (!w) return [];
  const st = stateOf(w);
  if (st.loading) await st.loading;
  st.ready = true;
  const files = st.pending;
  st.pending = [];
  return files;
});

// Save file dialog for PDF Tools
ipcMain.handle("alif:save-file", async (e, { defaultName, data }) => {
  assertSender(e);
  if (!data || !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
    throw new Error("بيانات PDF غير صالحة للحفظ");
  }
  const r = await dialog.showSaveDialog(senderWindow(e), {
    title: "حفظ مستند PDF",
    defaultPath: path.basename(defaultName || "document.pdf"),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  // The destination comes from the native save dialog, not a renderer path.
  const target = /\.pdf$/i.test(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
  await fsp.writeFile(target, Buffer.from(data));
  return { canceled: false, path: target };
});

// Secure Vault IPC handlers
ipcMain.handle("vault:status", async (e) => {
  assertSender(e);
  return vaultManager.getStatus();
});
ipcMain.handle("vault:create", async (e, password) => {
  assertSender(e);
  return await vaultManager.createVault(password);
});
ipcMain.handle("vault:unlock", async (e, password) => {
  assertSender(e);
  return await vaultManager.unlock(password);
});
ipcMain.handle("vault:lock", async (e) => {
  assertSender(e);
  return vaultManager.lock();
});
ipcMain.handle("vault:list", async (e) => {
  assertSender(e);
  return await vaultManager.listFiles();
});
ipcMain.handle("vault:add", async (e, sourcePath) => {
  assertSender(e);
  const allowed = pathSecurity.assertAllowed(sourcePath, { requirePdf: true });
  return await vaultManager.addFile(allowed);
});
ipcMain.handle("vault:read", async (e, fileId) => {
  assertSender(e);
  return await vaultManager.readFile(fileId);
});
ipcMain.handle("vault:change-password", async (e, currentPassword, newPassword) => {
  assertSender(e);
  return vaultManager.changePassword(currentPassword, newPassword);
});

// Encrypted backup of the vault. Choosing a folder happens here, in the main process, never in the page.
ipcMain.handle("vault:export-backup", async (e) => {
  assertSender(e);
  const r = await dialog.showOpenDialog(senderWindow(e), {
    title: "اختر مجلدًا لحفظ نسخة الخزنة الاحتياطية",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const result = await vaultManager.exportBackup(path.join(r.filePaths[0], `Alif-Vault-Backup-${stamp}`));
  return { canceled: false, ...result };
});
ipcMain.handle("vault:import-backup", async (e, password, overwrite) => {
  assertSender(e);
  const r = await dialog.showOpenDialog(senderWindow(e), {
    title: "اختر مجلد نسخة الخزنة الاحتياطية",
    properties: ["openDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const status = await vaultManager.importBackup(r.filePaths[0], password, { overwrite: overwrite === true });
  return { canceled: false, status };
});

// Optional update channel. Nothing is downloaded or installed without the user's explicit action.
registerUpdateIpc(assertSender, () => activeWindow());

ipcMain.handle("vault:remove", async (e, fileId) => {
  assertSender(e);
  return await vaultManager.removeFile(fileId);
});

/* ---------- Library scanning (bounded and parallel, see library-scan.cjs) ---------- */

ipcMain.handle("alif:list-tree", async (e, dir) => {
  assertSender(e);
  try {
    const allowed = pathSecurity.assertAllowed(dir);
    return await scanLibraryTree(allowed);
  } catch {
    return null;
  }
});

function driveOf(p) {
  if (!p) return process.cwd();
  const m = /^[a-zA-Z]:/.exec(p);
  return m ? `${m[0]}\\` : p;
}

function diskInfo(targetPath) {
  const target = driveOf(targetPath || (loadLibrary() || {}).path);
  try {
    const s = fs.statfsSync(target);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { used: Math.max(total - free, 0), total, free, label: target };
  } catch {
    return { used: 0, total: 0, free: 0, label: target };
  }
}

/* ---------- Watcher ---------- */

let debounce = null;
/* ---------- Streaming PDF URLs (alif-file://) ---------- */
// The address and byte-range rules live in pdf-stream.cjs, where they are unit-tested.
const { toAlifFileUrl, fromAlifFileUrl, parseByteRange } = require("./pdf-stream.cjs");

function registerAlifFileProtocol() {
  protocol.handle("alif-file", async (request) => {
    try {
      const filePath = fromAlifFileUrl(request.url);
      if (!filePath) return new Response("Bad path", { status: 400 });
      let allowed;
      try {
        allowed = pathSecurity.assertAllowed(filePath, { requirePdf: true });
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
      const st = await fs.promises.stat(allowed);
      if (!st.isFile()) return new Response("Not a file", { status: 404 });

      const total = st.size;
      const headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        // Only this app's page can reach the scheme; the header lets the page's own origin read the bytes.
        "Access-Control-Allow-Origin": "*",
      };
      const rangeHeader = request.headers.get("Range");
      if (rangeHeader) {
        const range = parseByteRange(rangeHeader, total);
        if (!range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${total}`;
        headers["Content-Length"] = String(range.end - range.start + 1);
        const body = require("stream").Readable.toWeb(fs.createReadStream(allowed, { start: range.start, end: range.end }));
        return new Response(body, { status: 206, headers });
      }
      headers["Content-Length"] = String(total);
      return new Response(require("stream").Readable.toWeb(fs.createReadStream(allowed)), { status: 200, headers });
    } catch (err) {
      writeLog("ERROR", "alif-file protocol", err?.stack || err);
      return new Response("Error", { status: 500 });
    }
  });
}

/* ---------- Library index: every PDF in the library, kept current from file events ---------- */

// The index lives here, so the interface never rescans the library after a change. It receives small deltas.
let libraryIndex = null;
let libraryIndexReady = null; // resolves once the first full scan is done

function sendLibraryDelta(delta) {
  broadcast("alif:library-delta", delta, { onlyReady: true });
}

function startLibraryIndex(dir) {
  stopWatch();
  const root = path.resolve(dir);
  const index = new LibraryIndex(root, {
    onDelta: sendLibraryDelta,
    onError: (error) => writeLog("WARN", "library index", error?.message || String(error)),
  });
  libraryIndex = index;
  libraryIndexReady = index.build().then((snapshot) => {
    if (libraryIndex === index) index.startWatching();
    return snapshot;
  });
  return libraryIndexReady;
}

function stopWatch() {
  if (libraryIndex) libraryIndex.close();
  libraryIndex = null;
  libraryIndexReady = null;
}

/* ---------- App Initialization ---------- */

app.whenReady().then(async () => {
  if (singleLock) {
    configureSessionSecurity();
    registerAlifFileProtocol();
    await applyLibraryArgument();
    // Files passed on the first launch: the first fills the first window, every other file gets its own.
    // The window opens immediately; files are read in the background so a large PDF never delays the start.
    const [firstPath, ...otherPaths] = initialPaths;
    createWindow(firstPath ? readPdfObjectAsync(firstPath).then((item) => (item ? [item] : [])) : [], { restoreSession: !firstPath });
    for (const p of otherPaths) createWindow(readPdfObjectAsync(p).then((item) => (item ? [item] : [])));
    initUpdater(() => activeWindow());
    const saved = loadLibrary();
    if (saved?.path) {
      pathSecurity.addAllowedRoot(saved.path);
      void startLibraryIndex(saved.path).catch(() => {});
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && singleLock) createWindow();
});

/* ---------- Library & Dialog IPC ---------- */

ipcMain.handle("alif:pick-folder", async (e) => {
  assertSender(e);
  const r = await dialog.showOpenDialog(senderWindow(e), {
    title: "اختيار مجلد مكتبة PDF",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const p = r.filePaths[0];
  pathSecurity.addAllowedRoot(p);
  await saveLibrary({ path: p });
  startWatch(p);
  return { canceled: false, path: p, name: path.basename(p) || p };
});

ipcMain.handle("alif:pick-files", async (e) => {
  assertSender(e);
  const r = await dialog.showOpenDialog(senderWindow(e), {
    title: "استيراد ملفات PDF من أي مكان",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) {
    try {
      pathSecurity.addAllowedFile(p);
      const st = await fsp.stat(p);
      out.push({ name: path.basename(p), path: p, size: st.size, lastModified: Math.floor(st.mtimeMs) });
    } catch {
      /* skip */
    }
  }
  return out;
});

// Shows a file in Explorer, selected. The path must be one the app is allowed to use.
ipcMain.handle("alif:show-in-folder", async (e, p) => {
  assertSender(e);
  try {
    shell.showItemInFolder(pathSecurity.assertAllowed(p, { requirePdf: true }));
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle("alif:copy-path", async (e, p) => {
  assertSender(e);
  try {
    clipboard.writeText(pathSecurity.assertAllowed(p, { requirePdf: true }));
    return true;
  } catch {
    return false;
  }
});

// Renames a PDF in its own folder. The new name is checked here; the page never chooses a path.
ipcMain.handle("alif:rename-file", async (e, p, newName) => {
  assertSender(e);
  let allowed;
  try {
    allowed = pathSecurity.assertAllowed(p, { requirePdf: true });
  } catch (error) {
    return { ok: false, error: error?.message || "الوصول للملف غير مصرح به" };
  }
  const plan = planRename(allowed, newName);
  if (!plan.ok) return plan;
  if (plan.unchanged) return { ok: true, path: allowed, name: path.basename(allowed), unchanged: true };
  try {
    const st = await fsp.stat(allowed);
    if (!st.isFile()) return { ok: false, error: "هذا ليس ملفاً" };
    // Keep the event loop free: do not use existsSync for a user action.
    if (!plan.caseOnly) {
      try {
        await fsp.access(plan.newPath, fs.constants.F_OK);
        return { ok: false, error: "يوجد ملف بهذا الاسم في المجلد نفسه" };
      } catch (accessError) {
        if (accessError?.code !== "ENOENT") throw accessError;
      }
    }
    if (plan.caseOnly) {
      // NTFS can reject a direct case-only rename; a same-folder temporary hop is reliable.
      const temporary = `${allowed}.alif-case-${process.pid}-${Date.now()}.tmp`;
      await fsp.rename(allowed, temporary);
      try {
        await fsp.rename(temporary, plan.newPath);
      } catch (error) {
        await fsp.rename(temporary, allowed).catch(() => {});
        throw error;
      }
    } else {
      await fsp.rename(allowed, plan.newPath);
    }
  } catch (error) {
    const code = error?.code;
    writeLog("WARN", "rename failed", `${code || ""} ${error?.message || ""}`);
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      return { ok: false, error: "تعذّرت إعادة التسمية: الملف مفتوح في برنامج آخر أو لا تملك صلاحية تغييره" };
    }
    if (code === "ENOENT") return { ok: false, error: "لم يعد الملف موجوداً في مكانه" };
    return { ok: false, error: "تعذّرت إعادة تسمية الملف" };
  }
  pathSecurity.addAllowedFile(plan.newPath);
  for (const w of windows) {
    const st = stateOf(w);
    if (st.openedPath && st.openedPath.toLowerCase() === allowed.toLowerCase()) st.openedPath = plan.newPath;
  }
  return { ok: true, path: plan.newPath, name: plan.fileName };
});

ipcMain.handle("alif:read-file", async (e, p) => {
  assertSender(e);
  const allowed = pathSecurity.assertAllowed(p, { requirePdf: true, checkSize: true });
  const buf = await fsp.readFile(allowed);
  return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), size: buf.length };
});

ipcMain.handle("alif:disk", async (e, targetPath) => {
  assertSender(e);
  return diskInfo(typeof targetPath === "string" && targetPath.length < 4096 ? targetPath : undefined);
});

ipcMain.handle("alif:open-logs", async (e) => {
  assertSender(e);
  const dir = path.dirname(logPath());
  fs.mkdirSync(dir, { recursive: true });
  const error = await shell.openPath(dir);
  return { path: dir, error: error || null };
});

ipcMain.handle("alif:open-third-party-notices", async (e) => {
  assertSender(e);
  // Resolve from appPath so this works both in development and inside app.asar.
  const file = path.join(app.getAppPath(), "THIRD-PARTY-NOTICES.md");
  if (!fs.existsSync(file)) return { path: file, error: "ملف إشعار التراخيص غير موجود في هذه الحزمة" };
  const error = await shell.openPath(file);
  return { path: file, error: error || null };
});

ipcMain.handle("alif:get-library", async (e) => {
  assertSender(e);
  return loadLibrary();
});

ipcMain.handle("alif:save-library", async (e, p) => {
  assertSender(e);
  if (p) {
    pathSecurity.assertAllowed(p);
    pathSecurity.addAllowedRoot(p);
  }
  await saveLibrary(p ? { path: p } : {});
  if (p) startWatch(p);
  else stopWatch();
  return true;
});

ipcMain.handle("alif:watch", async (e, dir) => {
  assertSender(e);
  const target = dir || (loadLibrary() || {}).path;
  if (target) {
    pathSecurity.assertAllowed(target);
    void startLibraryIndex(target).catch(() => {});
  }
  return true;
});

// Full picture of the library: used for the first load and for a manual sync.
ipcMain.handle("alif:library-refresh", async (e, dir) => {
  assertSender(e);
  const target = dir || (loadLibrary() || {}).path;
  if (!target) return null;
  const allowed = path.resolve(pathSecurity.assertAllowed(target));
  if (!libraryIndex || libraryIndex.root !== allowed) startLibraryIndex(allowed);
  await libraryIndexReady;
  await libraryIndex.verify({ restat: true });
  return libraryIndex.snapshot();
});

// Address of one library PDF for streaming. The file must be inside the allowed library or a file the user opened.
ipcMain.handle("alif:file-url", async (e, p) => {
  assertSender(e);
  const allowed = pathSecurity.assertAllowed(p, { requirePdf: true });
  if (typeof pathSecurity.addAllowedFile === "function") pathSecurity.addAllowedFile(allowed);
  return { url: toAlifFileUrl(allowed), path: allowed };
});

ipcMain.handle("alif:unwatch", async (e) => {
  assertSender(e);
  stopWatch();
  return true;
});

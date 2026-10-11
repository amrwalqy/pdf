/* Alif — preload bridge. Exposes a minimal, safe API to the renderer. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,
  pickFolder: () => ipcRenderer.invoke("alif:pick-folder"),
  pickFiles: () => ipcRenderer.invoke("alif:pick-files"),
  listTree: (dir) => ipcRenderer.invoke("alif:list-tree", dir),
  readFile: (p) => ipcRenderer.invoke("alif:read-file", p),
  saveFile: (opts) => ipcRenderer.invoke("alif:save-file", opts),
  diskInfo: (targetPath) => ipcRenderer.invoke("alif:disk", targetPath),
  openLogs: () => ipcRenderer.invoke("alif:open-logs"),
  openThirdPartyNotices: () => ipcRenderer.invoke("alif:open-third-party-notices"),
  getLibrary: () => ipcRenderer.invoke("alif:get-library"),
  saveLibrary: (p) => ipcRenderer.invoke("alif:save-library", p),
  watch: (dir) => ipcRenderer.invoke("alif:watch", dir),
  unwatch: () => ipcRenderer.invoke("alif:unwatch"),
  setPin: (flag) => ipcRenderer.invoke("alif:set-pin", flag),
  getPin: () => ipcRenderer.invoke("alif:get-pin"),
  setFullscreen: (flag) => ipcRenderer.invoke("alif:set-fullscreen", flag),
  minimizeWindow: () => ipcRenderer.invoke("alif:window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("alif:window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("alif:window-close"),
  getWindowState: () => ipcRenderer.invoke("alif:window-state"),
  onWindowState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on("alif:window-state", fn);
    return () => ipcRenderer.removeListener("alif:window-state", fn);
  },
  onPinState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on("alif:pin-state", fn);
    return () => ipcRenderer.removeListener("alif:pin-state", fn);
  },
  onLibraryEvent: (cb) => {
    const fn = () => cb();
    ipcRenderer.on("alif:library-event", fn);
    return () => ipcRenderer.removeListener("alif:library-event", fn);
  },
  onLibraryDelta: (cb) => {
    const fn = (_event, delta) => cb(delta);
    ipcRenderer.on("alif:library-delta", fn);
    return () => ipcRenderer.removeListener("alif:library-delta", fn);
  },
  libraryRefresh: (dir) => ipcRenderer.invoke("alif:library-refresh", dir),
  fileUrl: (p) => ipcRenderer.invoke("alif:file-url", p),
  showInFolder: (p) => ipcRenderer.invoke("alif:show-in-folder", p),
  copyPath: (p) => ipcRenderer.invoke("alif:copy-path", p),
  renameFile: (p, newName) => ipcRenderer.invoke("alif:rename-file", p, newName),
  vaultExportBackup: () => ipcRenderer.invoke("vault:export-backup"),
  vaultImportBackup: (pwd, overwrite) => ipcRenderer.invoke("vault:import-backup", pwd, overwrite),
  updateStatus: () => ipcRenderer.invoke("alif:update-status"),
  updateCheck: () => ipcRenderer.invoke("alif:update-check"),
  updateDownload: () => ipcRenderer.invoke("alif:update-download"),
  updateInstall: () => ipcRenderer.invoke("alif:update-install"),

  // Windows PDF file association and default-app settings
  associatePdf: () => ipcRenderer.invoke("alif:associate-pdf"),
  unregisterPdf: () => ipcRenderer.invoke("alif:unregister-pdf"),
  pdfAssociationStatus: () => ipcRenderer.invoke("alif:pdf-association-status"),
  makePdfDefault: () => ipcRenderer.invoke("alif:make-pdf-default"),
  openDefaultAppsSettings: () => ipcRenderer.invoke("alif:open-default-apps"),
  takePendingFiles: () => ipcRenderer.invoke("alif:take-pending-files"),
  onOpenFile: (cb) => {
    const fn = (_e, file) => cb(file);
    ipcRenderer.on("alif:open-file", fn);
    return () => ipcRenderer.removeListener("alif:open-file", fn);
  },

  // Secure Vault
  vaultStatus: () => ipcRenderer.invoke("vault:status"),
  vaultCreate: (pwd) => ipcRenderer.invoke("vault:create", pwd),
  vaultUnlock: (pwd) => ipcRenderer.invoke("vault:unlock", pwd),
  vaultLock: () => ipcRenderer.invoke("vault:lock"),
  vaultList: () => ipcRenderer.invoke("vault:list"),
  vaultAdd: (p) => ipcRenderer.invoke("vault:add", p),
  vaultRead: (id) => ipcRenderer.invoke("vault:read", id),
  vaultRemove: (id) => ipcRenderer.invoke("vault:remove", id),
  vaultChangePassword: (currentPassword, newPassword) => ipcRenderer.invoke("vault:change-password", currentPassword, newPassword),
  onVaultAutoLocked: (cb) => {
    const fn = () => cb();
    ipcRenderer.on("vault:autolocked", fn);
    return () => ipcRenderer.removeListener("vault:autolocked", fn);
  },
});

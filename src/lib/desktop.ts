/* Desktop abstraction: real disk + real folders.
   - Inside Electron (.exe): uses window.electronAPI (real disk size, native dialogs, fs watcher).
   - In the browser: uses File System Access API + OPFS handles + storage estimate. */

import { idbDel, idbGet, idbSet } from "./idb";

/* ---------- types ---------- */

export type DiskInfo = {
  used: number;
  total: number;
  free: number;
  /** human context, e.g. "C:" or "مساحة المتصفح" */
  label: string;
  source: "electron" | "browser" | "unknown";
};

export type LibraryRef = { name: string; path: string };

export type ScannedPdf = {
  name: string;
  /** display path: real fs path in Electron, relative path in browser */
  path: string;
  size: number;
  lastModified: number;
  file?: File;
};

export type ExternalPdfFile = {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  data: ArrayBuffer;
};

export type PdfAssociation = {
  registered: boolean;
  isDefault: boolean;
  progId: string;
  command?: string;
};

type ElectronAPI = {
  isDesktop: boolean;
  takePendingFiles: () => Promise<ExternalPdfFile[]>;
  openDefaultAppsSettings: () => Promise<void>;
  associatePdf?: () => Promise<PdfAssociation>;
  pdfAssociationStatus?: () => Promise<PdfAssociation>;
  makePdfDefault?: () => Promise<PdfAssociation>;
  onOpenFile?: (cb: (file: ExternalPdfFile) => void) => () => void;
  minimizeWindow: () => Promise<boolean>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<boolean>;
  getWindowState: () => Promise<{ maximized: boolean }>;
  onWindowState: (cb: (s: { maximized: boolean }) => void) => () => void;
  pickFolder: () => Promise<{ canceled: boolean; path?: string; name?: string }>;
  pickFiles: () => Promise<Array<{ name: string; path: string; size: number; lastModified: number; data: ArrayBuffer }>>;
  listTree: (dir: string) => Promise<{
    files: Array<{ name: string; path: string; size: number; lastModified: number }>;
    dirs: string[];
    truncated: boolean;
  } | null>;
  openLogs: () => Promise<{ path: string; error: string | null }>;
  openThirdPartyNotices?: () => Promise<{ path: string; error: string | null }>;
  libraryRefresh: (dir: string) => Promise<{
    files: Array<{ name: string; path: string; size: number; lastModified: number }>;
    dirs: string[];
    truncated: boolean;
  } | null>;
  onLibraryDelta: (cb: (delta: LibraryDelta) => void) => () => void;
  fileUrl: (filePath: string) => Promise<{ url: string; path: string }>;
  renameFile?: (filePath: string, newName: string) => Promise<RenameResult>;
  showInFolder?: (filePath: string) => Promise<boolean>;
  copyPath?: (filePath: string) => Promise<boolean>;
  updateStatus: () => Promise<UpdateStatus>;
  updateCheck: () => Promise<UpdateStatus>;
  updateDownload: () => Promise<UpdateStatus>;
  updateInstall: () => Promise<UpdateStatus>;
  readFile: (path: string) => Promise<{ data: ArrayBuffer; size: number }>;
  saveFile?: (request: { defaultName: string; data: Uint8Array }) => Promise<{ canceled: boolean; path?: string }>;
  diskInfo: (targetPath?: string) => Promise<{ used: number; total: number; free: number; label: string }>;
  getLibrary: () => Promise<{ path: string } | null>;
  saveLibrary: (path: string | null) => Promise<void>;
  watch: (dir: string) => Promise<void>;
  unwatch: () => Promise<void>;
  onLibraryEvent: (cb: () => void) => () => void;
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker?: (opts?: any) => Promise<FileSystemFileHandle[]>;
  }
}

type FsDirHandle = {
  name: string;
  queryPermission?: (o?: { mode: string }) => Promise<string>;
  requestPermission?: (o?: { mode: string }) => Promise<string>;
  values: () => AsyncIterableIterator<any>;
};

const LS_LIB = "alif:library";
const LS_AUTO = "alif:autoSync";

/** Upper bound for files indexed from one library folder. Mirrors MAX_SCAN_FILES in electron/main.cjs. */
export const LIBRARY_SCAN_LIMIT = 200000;

/** State of the optional update channel, as reported by the main process. */
export type UpdateStatus = {
  supported: boolean;
  configured: boolean;
  note: string | null;
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number;
  version: string | null;
  releaseNotes: string | null;
  error: string | null;
};

/** Live change set from the main-process index: only what changed since the last delta. */
export type LibraryDelta = {
  addedFiles: ScannedPdf[];
  updatedFiles: ScannedPdf[];
  removedFiles: string[];
  addedDirs: string[];
  removedDirs: string[];
};

export function onLibraryDelta(cb: (delta: LibraryDelta) => void): () => void {
  if (!isDesktop() || !window.electronAPI?.onLibraryDelta) return () => {};
  return window.electronAPI.onLibraryDelta(cb);
}

export const isDesktop = () =>
  typeof window !== "undefined" && !!window.electronAPI?.isDesktop;

export const canUseFsAccess = () =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

export const sig = (e: { path: string; size: number; lastModified: number }) =>
  `${e.path}|${e.size}|${e.lastModified}`;

export function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/* ---------- disk ---------- */

export async function getDiskInfo(hintPath?: string | null): Promise<DiskInfo> {
  if (isDesktop()) {
    try {
      const d = await window.electronAPI!.diskInfo(hintPath ?? undefined);
      return { ...d, source: "electron" };
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== "undefined" && (navigator as any).storage?.estimate) {
    try {
      const e = await (navigator as any).storage.estimate();
      const total = e.quota || 10 * 1024 ** 3;
      const used = e.usage || 0;
      return { used, total, free: Math.max(total - used, 0), label: "مساحة المتصفح", source: "browser" };
    } catch {
      /* fall through */
    }
  }
  return { used: 1.2 * 1024 ** 3, total: 10 * 1024 ** 3, free: 8.8 * 1024 ** 3, label: "تقديري", source: "unknown" };
}

/* ---------- library folder ---------- */

export async function loadSavedLibrary(): Promise<LibraryRef | null> {
  if (isDesktop()) {
    try {
      const saved = await window.electronAPI!.getLibrary();
      if (saved?.path) {
        const name = saved.path.split(/[\\/]/).filter(Boolean).pop() || saved.path;
        return { name, path: saved.path };
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const raw = localStorage.getItem(LS_LIB);
    if (raw) return JSON.parse(raw) as LibraryRef;
  } catch {
    /* ignore */
  }
  return null;
}

async function saveLibraryRef(ref: LibraryRef | null) {
  try {
    if (ref) localStorage.setItem(LS_LIB, JSON.stringify(ref));
    else localStorage.removeItem(LS_LIB);
  } catch {
    /* ignore */
  }
  if (isDesktop()) {
    try {
      await window.electronAPI!.saveLibrary(ref?.path ?? null);
    } catch {
      /* ignore */
    }
  }
}

export async function chooseLibraryFolder(): Promise<LibraryRef | null> {
  if (isDesktop()) {
    const r = await window.electronAPI!.pickFolder();
    if (r.canceled || !r.path) return null;
    const ref = { name: r.name || r.path, path: r.path };
    await saveLibraryRef(ref);
    try {
      await window.electronAPI!.watch(r.path);
    } catch {
      /* ignore */
    }
    return ref;
  }
  if (!canUseFsAccess()) return null;
  const handle = (await window.showDirectoryPicker!({ mode: "read" })) as unknown as FsDirHandle;
  const ref = { name: handle.name, path: handle.name };
  await idbSet("handles", "library", handle);
  await saveLibraryRef(ref);
  return ref;
}

export async function clearLibraryFolder() {
  await saveLibraryRef(null);
  try {
    await idbDel("handles", "library");
  } catch {
    /* ignore */
  }
  if (isDesktop()) {
    try {
      await window.electronAPI!.unwatch();
    } catch {
      /* ignore */
    }
  }
}

async function ensureRead(handle: FsDirHandle): Promise<boolean> {
  try {
    if (handle.queryPermission && (await handle.queryPermission({ mode: "read" })) === "granted") return true;
    if (handle.requestPermission) return (await handle.requestPermission({ mode: "read" })) === "granted";
    return true;
  } catch {
    return false;
  }
}

async function scanHandle(
  handle: FsDirHandle,
  prefix: string,
  out: ScannedPdf[],
  depth: number,
  dirs: string[],
): Promise<void> {
  if (depth > 8 || out.length >= LIBRARY_SCAN_LIMIT) return;
  for await (const entry of handle.values()) {
    if (out.length >= LIBRARY_SCAN_LIMIT) return;
    try {
      if (entry.kind === "file" && /\.pdf$/i.test(entry.name)) {
        const file = (await entry.getFile()) as File;
        out.push({
          name: entry.name,
          path: prefix ? `${prefix}/${entry.name}` : entry.name,
          size: file.size,
          lastModified: file.lastModified,
          file,
        });
      } else if (entry.kind === "directory" && !entry.name.startsWith(".")) {
        const sub = prefix ? `${prefix}/${entry.name}` : entry.name;
        dirs.push(sub);
        await scanHandle(entry, sub, out, depth + 1, dirs);
      }
    } catch {
      /* skip unreadable entries */
    }
  }
}

/** Sub-folders found by the last successful scan (shelves, even empty ones). */
let lastScannedDirs: string[] = [];
let lastScanTruncated = false;
/** True when the last library scan stopped at a limit, so some files were not listed. */
export const wasLastScanTruncated = () => lastScanTruncated;
export const getScannedDirs = () => lastScannedDirs;

/** Metadata scan of the saved library folder (no file bytes loaded yet).
 *  Returns null when the folder is unreachable (permission / deleted) so the
 *  caller aborts instead of wiping the synced list. */
export async function scanLibrary(): Promise<ScannedPdf[] | null> {
  const ref = await loadSavedLibrary();
  if (!ref) {
    lastScannedDirs = [];
    lastScanTruncated = false;
    return [];
  }
  if (isDesktop()) {
    try {
      const tree = await window.electronAPI!.libraryRefresh(ref.path);
      if (!tree) return null;
      lastScannedDirs = tree.dirs;
      lastScanTruncated = tree.truncated;
      return tree.files;
    } catch {
      return null;
    }
  }
  try {
    const handle = (await idbGet<any>("handles", "library")) as FsDirHandle | undefined;
    if (!handle) return null;
    if (!(await ensureRead(handle))) return null;
    const out: ScannedPdf[] = [];
    const dirs: string[] = [];
    await scanHandle(handle, "", out, 0, dirs);
    lastScannedDirs = dirs;
    lastScanTruncated = out.length >= LIBRARY_SCAN_LIMIT;
    return out.sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return null;
  }
}

/** Loads bytes for one scanned entry (only called for new/changed files). */
export async function loadScannedData(entry: ScannedPdf): Promise<ArrayBuffer | null> {
  try {
    if (entry.file) return await entry.file.arrayBuffer();
    if (isDesktop()) {
      const r = await window.electronAPI!.readFile(entry.path);
      return r.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Address of a library PDF for streaming (desktop only). pdf.js then reads the file in byte ranges,
 * so a large PDF is never loaded into memory in one piece.
 */
export async function libraryPdfUrl(filePath: string): Promise<string | null> {
  if (!isDesktop() || !window.electronAPI?.fileUrl) return null;
  try {
    const r = await window.electronAPI.fileUrl(filePath);
    return r?.url ?? null;
  } catch {
    return null;
  }
}

export async function showFileInFolder(filePath: string): Promise<boolean> {
  try { return (await window.electronAPI?.showInFolder?.(filePath)) === true; } catch { return false; }
}

export async function copyFilePath(filePath: string): Promise<boolean> {
  try { return (await window.electronAPI?.copyPath?.(filePath)) === true; } catch { return false; }
}

export type RenameResult = { ok: true; path: string; name: string; unchanged?: boolean } | { ok: false; error: string };

/** Renames a PDF on disk, in its own folder. The main process checks the name and the path. */
export async function renameLibraryFile(filePath: string, newName: string): Promise<RenameResult> {
  if (!isDesktop() || !window.electronAPI?.renameFile) return { ok: false, error: "إعادة التسمية متاحة في تطبيق سطح المكتب فقط" };
  try {
    return await window.electronAPI.renameFile(filePath, newName);
  } catch {
    return { ok: false, error: "تعذّرت إعادة تسمية الملف" };
  }
}

/** Read one indexed PDF when the user actually opens it. */

export async function readLibraryPdf(filePath: string): Promise<ArrayBuffer | null> {
  if (isDesktop()) return readNativeData(filePath);
  try {
    const handle = await idbGet<FileSystemDirectoryHandle>("handles", "library");
    if (!handle || !/\.pdf$/i.test(filePath)) return null;
    const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    let folder = handle;
    for (const part of parts.slice(0, -1)) {
      folder = await folder.getDirectoryHandle(part);
    }
    const file = await (await folder.getFileHandle(parts[parts.length - 1])).getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/* ---------- import from anywhere ---------- */

/** Electron native multi-file picker. Returns null in browser (caller uses <input>). */
export async function pickFilesNative(): Promise<ScannedPdf[] | null> {
  if (!isDesktop()) return null;
  const files = await window.electronAPI!.pickFiles();
  return files.map((f) => ({ name: f.name, path: f.path, size: f.size, lastModified: f.lastModified }));
}

export async function readNativeData(path: string): Promise<ArrayBuffer | null> {
  try {
    const r = await window.electronAPI!.readFile(path);
    return r.data;
  } catch {
    return null;
  }
}

/** Live watcher (Electron). Browser uses polling in App. Returns unsubscribe. */
export function onLibraryEvent(cb: () => void): () => void {
  if (isDesktop()) {
    try {
      return window.electronAPI!.onLibraryEvent(cb);
    } catch {
      /* ignore */
    }
  }
  return () => {};
}

export async function watchSavedLibrary() {
  if (!isDesktop()) return;
  const ref = await loadSavedLibrary();
  if (ref) {
    try {
      await window.electronAPI!.watch(ref.path);
    } catch {
      /* ignore */
    }
  }
}

/* ---------- prefs ---------- */

export function loadAutoSync(): boolean {
  try {
    const v = localStorage.getItem(LS_AUTO);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function saveAutoSync(v: boolean) {
  try {
    localStorage.setItem(LS_AUTO, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/* ---------- PDF association & external files ---------- */

export async function getPdfAssociation(): Promise<PdfAssociation> {
  if (isDesktop() && window.electronAPI?.pdfAssociationStatus) {
    try {
      return await window.electronAPI.pdfAssociationStatus();
    } catch {
      /* ignore */
    }
  }
  return { registered: false, isDefault: false, progId: "Alif.PDF" };
}

export async function makePdfDefault(): Promise<PdfAssociation> {
  if (isDesktop() && window.electronAPI?.makePdfDefault) {
    try {
      return await window.electronAPI.makePdfDefault();
    } catch {
      /* ignore */
    }
  }
  return { registered: false, isDefault: false, progId: "Alif.PDF" };
}

export async function openDefaultAppsSettings(): Promise<void> {
  if (isDesktop() && window.electronAPI?.openDefaultAppsSettings) {
    try {
      await window.electronAPI.openDefaultAppsSettings();
    } catch {
      /* ignore */
    }
  }
}

export async function takePendingFiles(): Promise<ExternalPdfFile[]> {
  if (isDesktop() && window.electronAPI?.takePendingFiles) {
    try {
      return await window.electronAPI.takePendingFiles();
    } catch {
      return [];
    }
  }
  return [];
}

export function onExternalPdf(cb: (file: ExternalPdfFile) => void): () => void {
  if (isDesktop() && window.electronAPI?.onOpenFile) {
    try {
      return window.electronAPI.onOpenFile(cb);
    } catch {
      /* ignore */
    }
  }
  return () => {};
}

import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar, TitleBar } from "./components/Chrome";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Sidebar } from "./components/Sidebar";
import { ThemePanel } from "./components/ThemePanel";
import { AboutDialog } from "./components/AboutDialog";
import { RenameDialog } from "./components/RenameDialog";
import { VaultModal } from "./components/VaultModal";
import { folders, type Doc, type FolderId } from "./data";
import { seedDocs } from "./data/seed";
import { openPdf, prewarmPdf } from "./lib/pdf";
import { applyTheme, DEFAULT_THEME, getThemeVars, loadTheme, presetById, saveTheme, type ThemeId } from "./lib/theme";
import { idbAll, idbSet, type PersistedFile } from "./lib/idb";
import { buildShelfTree, relDir } from "./lib/shelves";
import { canTruePin, getPinState, loadPinPref, onPinState, setFullscreen as setFs, setPinned as setPin } from "./lib/pin";
import { arabicIncludes } from "./lib/arabicSearch";
import { searchPdfNames } from "./lib/fileSearch";
import { canUseFsAccess,
  chooseLibraryFolder,
  formatBytes,
  getDiskInfo,
  isDesktop,
  loadAutoSync,
  loadSavedLibrary,
  onLibraryDelta,
  type LibraryDelta,
  pickFilesNative,
  readNativeData,
  renameLibraryFile,
  saveAutoSync,
  scanLibrary,
  wasLastScanTruncated,
  LIBRARY_SCAN_LIMIT,
  getScannedDirs,
  onExternalPdf,
  takePendingFiles,
  watchSavedLibrary,
  type DiskInfo,
  type ExternalPdfFile,
  type LibraryRef,
} from "./lib/desktop";

const PdfToolsModal = lazy(() => import("./components/PdfToolsModal").then((module) => ({ default: module.PdfToolsModal })));

const MAX_AUTO_IMPORT = LIBRARY_SCAN_LIMIT;

function showExamples() {
  try { return localStorage.getItem("alif:hide-examples") !== "1"; }
  catch { return true; }
}

function toDoc(
  id: string,
  e: { name: string; path: string; size: number; lastModified: number },
  data: ArrayBuffer | undefined,
  pages: number,
  proxy: any,
  origin: "watched" | "imported" | "vault",
  shelf = "",
): Doc {
  const shelfParts = shelf ? shelf.split("/") : [];
  const shelfLeaf = shelfParts[shelfParts.length - 1];
  return {
    id,
    file: e.name,
    title: e.name.replace(/\.pdf$/i, ""),
    kindLabel: origin === "watched" ? shelfLeaf || "المكتبة" : origin === "vault" ? "خزنة مشفّرة" : "مستورد يدوياً",
    badge: origin === "watched" ? shelfParts[0] || "المكتبة" : origin === "vault" ? "خزنة" : "مستورد",
    desc:
      origin === "watched"
        ? shelf
          ? `من رفّ «${shelfParts.join(" › ")}» في مكتبتك`
          : "من المجلد الرئيسي لمكتبتك"
        : origin === "vault"
          ? "مستند مشفّر داخل الخزنة الآمنة."
          : "أُضيف يدوياً من هذا الجهاز وقُرئ عبر محرك Alif PDF دون رفعه لأي خادم.",
    pages,
    at: 1,
    size: formatBytes(e.size),
    meta: origin === "watched" ? "جديد من المجلد" : "الآن",
    folder: "reading",
    ocr: false,
    isScanned: undefined,
    pageCountPending: origin === "watched" && !data,
    thumbHead: e.name.replace(/\.pdf$/i, "").slice(0, 22),
    thumbSub: origin === "watched" ? shelfLeaf || "المكتبة" : "من جهازك",
    origin,
    path: e.path,
    lastModified: e.lastModified,
    toc: [],
    notes: [],
    bookmarks: [],
    body: [],
    pdf: { data, proxy },
  };
}

export default function App() {
  const [list, setList] = useState<Doc[]>(() => showExamples() ? seedDocs : []);
  const [tabs, setTabs] = useState<string[]>(() => showExamples() ? ["khaldun", "codex", "aristotle"] : []);
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("alif:recent-opened") || "[]");
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  });
  const [readerId, setReaderId] = useState<string | null>(null);
  const [lastTab, setLastTab] = useState<string | null>("khaldun");
  const [folder, setFolder] = useState<FolderId>("all");
  const [query, setQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "all">("name");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  // Vault modal state
  const [vaultOpen, setVaultOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // PDF tools modal state
  const [activePdfToolModal, setActivePdfToolModal] = useState<"merge" | "split" | "sign" | null>(null);

  const [library, setLibrary] = useState<LibraryRef | null>(null);
  const [shelfDirs, setShelfDirs] = useState<string[]>([]);
  const [shelf, setShelf] = useState<string | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState<boolean>(() => loadAutoSync());
  const [isDesk] = useState<boolean>(() => isDesktop());

  const [pinned, setPinnedState] = useState(false);
  const [fullscreen, setFullscreenState] = useState(false);

  useEffect(() => {
    getPinState().then((s) => {
      setPinnedState(s.pinned);
      setFullscreenState(s.fullscreen);
    });
    if (canTruePin() && loadPinPref()) setPin(true).then((s) => setPinnedState(s.pinned));
    return onPinState((s) => {
      if (canTruePin()) setPinnedState(s.pinned);
      else setPinnedState((p) => p && s.fullscreen);
      setFullscreenState(s.fullscreen);
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(prewarmPdf, 400);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const block = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    window.addEventListener("wheel", block, { passive: false });
    return () => window.removeEventListener("wheel", block);
  }, []);

  const [theme, setTheme] = useState(() => loadTheme());
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const v = applyTheme(theme);
    saveTheme(theme);
    try {
      localStorage.setItem(
        "alif:theme-paint",
        JSON.stringify({ paper: v["--color-paper"], ink: v["--color-ink"], scheme: v["--theme-scheme"] }),
      );
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setPreset = useCallback((preset: ThemeId) => {
    setTheme((t) => ({ ...t, preset }));
  }, []);
  const setDepth = useCallback((depth: number) => {
    setTheme((t) => ({ ...t, depth }));
  }, []);
  const resetTheme = useCallback(() => setTheme(DEFAULT_THEME), []);

  const themeVars = useMemo(() => getThemeVars(theme.preset, theme.depth), [theme]);
  const themeName = presetById(theme.preset).name;

  const fileRef = useRef<HTMLInputElement | null>(null);
  const nameSearchRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<number | null>(null);
  const syncingRef = useRef(false);
  // True while the library holds more files than the index can list, so the footer can say so.
  const [scanLimitReached, setScanLimitReached] = useState(false);
  // A change that arrived during a scan: one more pass runs when the current one finishes.
  const pendingSyncRef = useRef<{ silent: boolean } | null>(null);
  const listRef = useRef<Doc[]>(list);
  listRef.current = list;
  const libraryRef = useRef<LibraryRef | null>(null);
  libraryRef.current = library;

  const changeSearchMode = useCallback((value: "name" | "all") => {
    setSearchMode(value);
    if (value === "name") {
      setNameQuery(query || nameQuery);
      setQuery("");
    } else {
      setQuery(nameQuery || query);
      setNameQuery("");
    }
  }, [nameQuery, query]);

  const notify = useCallback((msg: string) => {
    setNotice(msg);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 4200);
  }, []);

  // Renaming a file on disk. The open tab, the list and the recent files keep pointing at the same document.
  const [renaming, setRenaming] = useState<Doc | null>(null);
  const renameDoc = useCallback(async (doc: Doc, newName: string): Promise<string | null> => {
    if (!doc.path) return "لا يمكن تغيير اسم هذا الملف";
    const result = await renameLibraryFile(doc.path, newName);
    if (!result.ok) return result.error;
    if (!result.unchanged) {
      setList((previous) => previous.map((d) => (d.id === doc.id
        ? { ...d, file: result.name, title: result.name.replace(/\.pdf$/i, ""), path: result.path }
        : d)));
    }
    setRenaming(null);
    notify(`تم تغيير الاسم إلى «${result.name}»`);
    return null;
  }, [notify]);

  // Session: the first window of a normal start reopens the documents that were open when Alif was last closed.
  const sessionWindow = useMemo(() => { try { return new URLSearchParams(window.location.search).get("session") === "1"; } catch { return false; } }, []);
  const sessionPending = useRef<{ paths: string[]; active: string | null } | null>(null);
  const sessionDeadline = useRef(0);
  if (sessionWindow && sessionPending.current === null && sessionDeadline.current === 0) {
    sessionDeadline.current = Date.now() + 15000;
    try {
      const raw = JSON.parse(localStorage.getItem("alif:session") || "null");
      if (raw && Array.isArray(raw.paths)) {
        sessionPending.current = { paths: raw.paths.filter((x: unknown): x is string => typeof x === "string").slice(0, 12), active: typeof raw.active === "string" ? raw.active : null };
      }
    } catch { /* ignore */ }
  }

  const openDoc = useCallback((id: string) => {
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setLastTab(id);
    setReaderId(id);
    setDrawer(false);
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      try { localStorage.setItem("alif:recent-opened", JSON.stringify(next)); } catch { /* optional */ }
      return next;
    });
  }, []);

  const handleProgress = useCallback((id: string, page: number) => {
    setList((prev) => {
      const idx = prev.findIndex((d) => d.id === id);
      if (idx < 0 || prev[idx].at === page) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], at: page };
      return next;
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((t) => {
      const next = t.filter((x) => x !== id);
      setLastTab((cur) => (cur === id ? next[next.length - 1] ?? null : cur));
      return next;
    });
    setReaderId((r) => (r === id ? null : r));
  }, []);

  const hideExamples = useCallback(() => {
    setList((previous) => previous.filter((doc) => doc.origin !== "seed"));
    setTabs((previous) => previous.filter((id) => !seedDocs.some((doc) => doc.id === id)));
    setReaderId((id) => seedDocs.some((doc) => doc.id === id) ? null : id);
    try { localStorage.setItem("alif:hide-examples", "1"); } catch { /* Optional preference. */ }
  }, []);

  const restoreExamples = useCallback(() => {
    setList((previous) => [...seedDocs.filter((seed) => !previous.some((doc) => doc.id === seed.id)), ...previous]);
    try { localStorage.removeItem("alif:hide-examples"); } catch { /* Optional preference. */ }
  }, []);

  /* ---------- disk ---------- */

  const refreshDisk = useCallback(async () => {
    const d = await getDiskInfo(libraryRef.current?.path);
    setDisk(d);
  }, []);

  useEffect(() => {
    refreshDisk();
    const t = window.setInterval(refreshDisk, 30000);
    const onFocus = () => refreshDisk();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshDisk]);

  /* ---------- sync engine ---------- */

  // Every change to watched files goes through this one merge: deltas from the library index and full scans alike.
  // It works by path, against the list as it is when React applies the change, so a delta and a scan that overlap
  // can never add the same file twice. Unchanged files are skipped.
  const watchedSeqRef = useRef(0);
  const mergeWatchedNow = useCallback(
    (upserts: Array<{ name: string; path: string; size: number; lastModified: number }>, removedPaths: string[], root: string) => {
      const removed = new Set(removedPaths);
      startTransition(() => {
        setList((previous) => {
          const byPath = new Map<string, Doc>();
          for (const d of previous) if (d.origin === "watched" && d.path) byPath.set(d.path, d);
          const replacement = new Map<string, Doc>();
          for (const e of upserts) {
            if (!e.path || removed.has(e.path)) continue;
            const existing = byPath.get(e.path);
            if (existing && existing.lastModified === e.lastModified) continue;
            watchedSeqRef.current += 1;
            const id = existing?.id ?? `w${Date.now().toString(36)}-${watchedSeqRef.current.toString(36)}`;
            replacement.set(e.path, toDoc(id, e, undefined, 1, null, "watched", relDir(e.path, root)));
          }
          let removesSomething = false;
          for (const p of removed) {
            if (byPath.has(p)) {
              removesSomething = true;
              break;
            }
          }
          if (replacement.size === 0 && !removesSomething) return previous;
          const fresh: Doc[] = [];
          for (const [p, doc] of replacement) if (!byPath.has(p)) fresh.push(doc);
          const next: Doc[] = [];
          for (const d of previous) {
            if (d.origin === "watched" && d.path) {
              if (removed.has(d.path)) continue;
              next.push(replacement.get(d.path) ?? d);
            } else {
              next.push(d);
            }
          }
          return fresh.length > 0 ? [...fresh, ...next] : next;
        });
      });
    },
    [],
  );

  // A big library (thousands of files) is merged in slices, so the window keeps responding while it fills.
  const mergeWatched = useCallback(
    (upserts: Array<{ name: string; path: string; size: number; lastModified: number }>, removedPaths: string[], root: string) => {
      const SLICE = 400;
      if (upserts.length <= SLICE) {
        mergeWatchedNow(upserts, removedPaths, root);
        return;
      }
      mergeWatchedNow([], removedPaths, root);
      let offset = 0;
      const next = () => {
        mergeWatchedNow(upserts.slice(offset, offset + SLICE), [], root);
        offset += SLICE;
        if (offset < upserts.length) window.setTimeout(next, 16);
      };
      next();
    },
    [mergeWatchedNow],
  );

  // Live deltas from the library index: only what changed is merged. Folder changes update the folder list.
  const applyLibraryDelta = useCallback(
    (delta: LibraryDelta) => {
      const root = libraryRef.current?.path;
      if (!root) return;
      mergeWatched([...delta.addedFiles, ...delta.updatedFiles], delta.removedFiles, root);
      if (delta.addedDirs.length || delta.removedDirs.length) {
        const dropped = new Set(delta.removedDirs);
        setShelfDirs((prev) => {
          const kept = prev.filter((d) => !dropped.has(d));
          const known = new Set(kept);
          const fresh = delta.addedDirs.filter((d) => !known.has(d));
          return fresh.length === 0 && kept.length === prev.length ? prev : [...kept, ...fresh];
        });
      }
    },
    [mergeWatched],
  );

  // Documents that leave the library close their tabs. Checked whenever the list changes.
  const knownWatchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set<string>();
    for (const d of list) if (d.origin === "watched") now.add(d.id);
    const gone = new Set<string>();
    for (const id of knownWatchedRef.current) if (!now.has(id)) gone.add(id);
    knownWatchedRef.current = now;
    if (gone.size === 0) return;
    setTabs((t) => t.filter((id) => !gone.has(id)));
    setReaderId((r) => (r && gone.has(r) ? null : r));
  }, [list]);

  // Save which documents are open, so the next start can bring them back.
  useEffect(() => {
    if (!sessionWindow) return;
    if (sessionPending.current && sessionPending.current.paths.length) return; // still restoring: keep the saved session
    const byId = new Map(listRef.current.map((d) => [d.id, d] as const));
    const real = (d?: Doc) => !!d && !!d.path && (d.origin === "watched" || d.origin === "imported");
    const paths = tabs.map((id) => byId.get(id)).filter((d): d is Doc => real(d)).map((d) => d.path as string);
    const activeDoc = readerId ? byId.get(readerId) : undefined;
    try { localStorage.setItem("alif:session", JSON.stringify({ paths, active: real(activeDoc) ? activeDoc!.path : null })); } catch { /* ignore */ }
  }, [tabs, readerId, sessionWindow]);

  // Bring the saved documents back as the library and imports load. Gives up after 15 seconds.
  useEffect(() => {
    const pending = sessionPending.current;
    if (!sessionWindow || !pending) return;
    if (Date.now() > sessionDeadline.current) { sessionPending.current = null; return; }
    const byPath = new Map<string, Doc>();
    for (const d of list) if (d.path && (d.origin === "watched" || d.origin === "imported")) byPath.set(d.path.toLowerCase(), d);
    const remaining: string[] = [];
    let activeId: string | null = null;
    const found: string[] = [];
    for (const p of pending.paths) {
      const d = byPath.get(p.toLowerCase());
      if (!d) { remaining.push(p); continue; }
      found.push(d.id);
      if (pending.active && pending.active.toLowerCase() === p.toLowerCase()) activeId = d.id;
    }
    if (found.length) setTabs((t) => [...t, ...found.filter((id) => !t.includes(id))]);
    if (activeId) openDoc(activeId);
    pending.paths = remaining;
    if (remaining.length === 0) sessionPending.current = null;
  }, [list, sessionWindow, openDoc]);

  useEffect(() => {
    if (!sessionWindow) return;
    const timer = window.setTimeout(() => { sessionPending.current = null; }, 15000);
    return () => window.clearTimeout(timer);
  }, [sessionWindow]);

  // A full scan (first load, manual sync, or browser polling) is merged the same way as a delta.
  const syncNow = useCallback(
    async function syncLibrary(opts?: { silent?: boolean }): Promise<void> {
      const silent = !!opts?.silent;
      if (syncingRef.current) {
        pendingSyncRef.current = { silent: silent && (pendingSyncRef.current?.silent ?? true) };
        return;
      }
      if (!libraryRef.current) {
        if (!silent) notify("اختر مجلد المكتبة أولاً لبدء المزامنة");
        return;
      }
      syncingRef.current = true;
      setSyncing(true);
      try {
        const scanned = await scanLibrary();
        if (scanned === null) {
          if (!silent) notify("تعذّر الوصول إلى مجلد المكتبة — أعد اختياره لمنح الصلاحية");
          return;
        }
        setScanLimitReached(wasLastScanTruncated());
        const dirs = getScannedDirs();
        setShelfDirs((prev) => (prev.length === dirs.length && prev.every((d, i) => d === dirs[i]) ? prev : [...dirs]));
        const root = libraryRef.current.path;
        // Only the first MAX_AUTO_IMPORT entries are taken in; the rest are reported, never silently dropped.
        const entries = scanned.length > MAX_AUTO_IMPORT ? scanned.slice(0, MAX_AUTO_IMPORT) : scanned;
        const skipped = scanned.length - entries.length;
        const known = new Set<string>();
        for (const d of listRef.current) if (d.origin === "watched" && d.path) known.add(d.path);
        const present = new Set(entries.map((e) => e.path));
        const removedPaths: string[] = [];
        for (const p of known) if (!present.has(p)) removedPaths.push(p);
        let added = 0;
        for (const e of entries) if (!known.has(e.path)) added++;
        mergeWatched(entries, removedPaths, root);
        if (!silent) {
          if (added > 0)
            notify(
              `تمت المزامنة — أُضيف ${added} ملفاً جديداً من مجلد المكتبة${skipped > 0 ? ` (تُجوهل ${skipped} لحدّ الاستيراد)` : ""}`,
            );
          else if (removedPaths.length > 0) notify(`تمت المزامنة — أُزيل ${removedPaths.length} ملفاً لم يعد في المجلد`);
          else notify(`المكتبة محدّثة — ${entries.length} ملفاً في «${libraryRef.current?.name}»`);
          refreshDisk();
        } else if (added > 0) {
          notify(`وصل ${added} ملف PDF جديد من مجلد المكتبة`);
        }
      } catch {
        if (!silent) notify("تعذّر فحص المجلد. حاول مجدداً أو اختر مجلداً آخر.");
      } finally {
        syncingRef.current = false;
        const next = pendingSyncRef.current;
        pendingSyncRef.current = null;
        if (next) {
          window.setTimeout(() => void syncLibrary(next), 0);
        } else {
          setSyncing(false);
        }
      }
    },
    [notify, refreshDisk, mergeWatched],
  );

  /* ---------- boot: restore library, files, watcher ---------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await loadSavedLibrary();
      if (!alive) return;
      if (saved) {
        setLibrary(saved);
        hideExamples();
        await watchSavedLibrary();
      }
      try {
        // Imported files are loaded after the first screen is drawn, so the window never waits for them.
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        if (!alive) return;
        const persisted = await idbAll<PersistedFile>("files");
        if (alive && persisted.length > 0) {
          const docs: Doc[] = persisted.map((p) =>
            toDoc(
              p.id,
              { name: p.name, path: p.path ?? p.name, size: p.size, lastModified: p.lastModified },
              p.data,
              p.pages ?? 1,
              null,
              "imported",
            ),
          );
          setList((l) => [...docs, ...l]);
        }
      } catch {
        /* ignore */
      }
      refreshDisk();
    })();
    return () => {
      alive = false;
    };
  }, [refreshDisk, hideExamples]);

  useEffect(() => {
    if (library) syncNow({ silent: true });
  }, [library?.path]);

  useEffect(() => onLibraryDelta(applyLibraryDelta), [applyLibraryDelta]);

  useEffect(() => {
    // On the desktop, changes arrive as deltas from the library index. Only the browser polls.
    if (!library || !autoSync || isDesktop()) return;
    const t = window.setInterval(() => {
      if (!document.hidden) syncNow({ silent: true });
    }, 10_000);
    return () => window.clearInterval(t);
  }, [library, autoSync, syncNow]);

  /* ---------- actions ---------- */

  const handleChooseLibrary = useCallback(async () => {
    if (!isDesk && !canUseFsAccess()) {
      notify("متصفحك لا يدعم اختيار المجلدات — استخدم Chrome أو Edge، أو نسخة الـ .exe للويندوز");
      return;
    }
    try {
      const ref = await chooseLibraryFolder();
      if (!ref) return;
      setLibrary(ref);
      hideExamples();
      setShelfDirs([]);
      setShelf("");
      setQuery("");
      setNameQuery("");
      setReaderId(null);
      notify(`تم ربط مجلد «${ref.name}» — جارٍ فحص ملفات PDF…`);
      refreshDisk();
    } catch {
      notify("أُلغي اختيار المجلد");
    }
  }, [isDesk, notify, refreshDisk, hideExamples]);

  const addImported = useCallback(
    async (items: Array<{ name: string; path: string; size: number; lastModified: number; data: ArrayBuffer }>) => {
      if (items.length === 0) return;
      notify(items.length === 1 ? `جارٍ فتح ${items[0].name} …` : `جارٍ استيراد ${items.length} ملفات …`);
      const added: Doc[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let res: Awaited<ReturnType<typeof openPdf>> = null;
        try {
          res = await openPdf(it.data);
          if (!res) {
            notify(`تعذّر قراءة ${it.name} — تأكّد أنه ملف PDF صالح`);
            continue;
          }
        } catch (error) {
          // Let the reader ask for the password instead of discarding the file.
          if ((error as Error)?.name !== "PasswordException") {
            notify(`تعذّر قراءة ${it.name}`);
            continue;
          }
        }
        const id = `u${Date.now()}-${i}`;
        added.push(toDoc(id, it, it.data, res?.pages ?? 1, res?.proxy ?? null, "imported"));
        try {
          await idbSet("files", id, {
            id,
            name: it.name,
            size: it.size,
            lastModified: it.lastModified,
            // Desktop imports stay on disk and are read from `path` when opened, so they are not copied into IndexedDB.
            data: isDesktop() ? undefined : it.data,
            origin: "imported",
            path: it.path,
            pages: res?.pages ?? 1,
          });
        } catch {
          /* storage full */
        }
      }
      if (added.length === 0) return;
      setList((l) => [...added, ...l]);
      const first = added[0];
      setTabs((t) => [first.id, ...t.filter((x) => !added.some((a) => a.id === x))]);
      setLastTab(first.id);
      setReaderId(first.id);
      notify(added.length === 1 ? `تم فتح ${first.file}` : `تم استيراد ${added.length} ملفات بنجاح`);
    },
    [notify],
  );

  const importFromAnywhere = useCallback(async () => {
    if (isDesk) {
      const picked = await pickFilesNative();
      if (!picked || picked.length === 0) return;
      const items: Array<{ name: string; path: string; size: number; lastModified: number; data: ArrayBuffer }> = [];
      for (const p of picked) {
        const data = await readNativeData(p.path);
        if (data) items.push({ ...p, data });
      }
      await addImported(items);
      return;
    }
    fileRef.current?.click();
  }, [isDesk, addImported]);

  const openExternalPdfs = useCallback(
    async (files: ExternalPdfFile[]) => {
      if (!files.length) return;
      const fresh: Array<{ name: string; path: string; size: number; lastModified: number; data: ArrayBuffer }> = [];
      let reopened: string | null = null;
      for (const f of files) {
        const key = f.path.toLowerCase();
        const existing = listRef.current.find((d) => d.path && d.path.toLowerCase() === key && d.pdf);
        if (existing) {
          reopened = existing.id;
          continue;
        }
        fresh.push(f);
      }
      if (fresh.length > 0) {
        await addImported(fresh);
      } else if (reopened) {
        openDoc(reopened);
        notify("الملف مفتوح مسبقاً — تم الانتقال إليه");
      }
    },
    [addImported, openDoc, notify],
  );

  useEffect(() => {
    const off = onExternalPdf((file) => {
      void openExternalPdfs([file]);
    });
    takePendingFiles().then((files) => {
      if (files.length) void openExternalPdfs(files);
    });
    return off;
  }, [openExternalPdfs]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const items: Array<{ name: string; path: string; size: number; lastModified: number; data: ArrayBuffer }> = [];
    for (const f of Array.from(files)) {
      if (!/\.pdf$/i.test(f.name)) continue;
      items.push({ name: f.name, path: f.name, size: f.size, lastModified: f.lastModified, data: await f.arrayBuffer() });
    }
    e.target.value = "";
    await addImported(items);
  };

  const handleDropFiles = useCallback(async (files: File[]) => {
    const pdfs = files.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      notify("اسحب ملفات PDF فقط.");
      return;
    }
    const items = await Promise.all(pdfs.map(async (file) => ({
      name: file.name,
      path: file.name,
      size: file.size,
      lastModified: file.lastModified,
      data: await file.arrayBuffer(),
    })));
    void addImported(items);
  }, [addImported, notify]);

  const toggleAuto = useCallback(() => {
    setAutoSync((v) => {
      const next = !v;
      saveAutoSync(next);
      if (next && libraryRef.current) window.setTimeout(() => syncNow({ silent: true }), 50);
      return next;
    });
  }, [syncNow]);

  /* ---------- derived & Arabic search ---------- */

  const q = query.trim();
  const filenameQuery = nameQuery.trim();
  const nameResults = useMemo(() => searchPdfNames(list, filenameQuery), [list, filenameQuery]);

  const rows = useMemo(() => {
    if (filenameQuery) return nameResults;
    if (q) {
      return list.filter(
        (d) =>
          arabicIncludes(d.file, q) ||
          arabicIncludes(d.title, q) ||
          arabicIncludes(d.desc, q) ||
          arabicIncludes(d.kindLabel, q) ||
          d.body.some((p) => arabicIncludes(p, q)) ||
          d.notes.some((n) => arabicIncludes(n.text, q)),
      );
    }
    return list.filter((d) => d.folder === folder);
  }, [q, folder, list, filenameQuery, nameResults]);

  const mode: "recent" | "folder" | "search" | "shelf" | "name-search" = filenameQuery
    ? "name-search"
    : q
    ? "search"
    : shelf !== null && library
      ? "shelf"
      : folder === "all"
        ? "recent"
        : "folder";

  const libraryDocs = useMemo(() => list.filter((d) => d.origin === "watched"), [list]);
  const shelfTree = useMemo(() => {
    if (!library) return null;
    return buildShelfTree(libraryDocs, library.path, library.name || "المكتبة", shelfDirs);
  }, [library, libraryDocs, shelfDirs]);

  const openShelf = useCallback((p: string | null) => {
    setShelf(p);
    setQuery("");
    setNameQuery("");
    setReaderId(null);
    setDrawer(false);
  }, []);
  const folderName = folders.find((f) => f.id === folder)?.name ?? "كل المستندات";

  const recent = useMemo(() => {
    const byId = new Map(list.map((d) => [d.id, d]));
    const ordered = recentIds.map((id) => byId.get(id)).filter((d): d is Doc => !!d);
    if (ordered.length) return ordered.slice(0, 4);
    const nonSeed = list.filter((d) => d.origin !== "seed");
    return (nonSeed.length ? nonSeed : list).slice(0, 3);
  }, [list, recentIds]);

  const readerDoc = useMemo(() => list.find((d) => d.id === readerId) ?? null, [list, readerId]);

  // Keep the OS window/taskbar title in sync so the open file is visible outside the app.
  useEffect(() => {
    document.title = readerDoc ? `${readerDoc.file} — Alif PDF Reader` : "Alif PDF Reader — أليف";
  }, [readerDoc]);
  const openTabs = useMemo(() => tabs.map((id) => list.find((d) => d.id === id)).filter(Boolean) as Doc[], [tabs, list]);
  const watchedCount = useMemo(() => list.filter((d) => d.origin === "watched").length, [list]);

  const diskText = useMemo(() => {
    if (!disk || disk.total <= 0) return null;
    return disk.source === "electron" ? `${formatBytes(disk.free)} free · ${disk.label}` : `${formatBytes(disk.free)} متاح`;
  }, [disk]);

  const togglePin = useCallback(async () => {
    const s = await setPin(!pinned);
    setPinnedState(s.pinned);
    setFullscreenState(s.fullscreen);
    if (canTruePin()) {
      notify(s.pinned ? "📌 النافذة مثبّتة فوق كل النوافذ — لن يظهر شيء فوقها" : "أُلغي التثبيت");
    } else {
      notify(
        s.pinned
          ? "📌 وضع التثبيت (ملء الشاشة) — التثبيت الكامل فوق كل النوافذ متاح في نسخة الـ .exe"
          : "أُلغي التثبيت",
      );
    }
  }, [pinned, notify]);

  const toggleFullscreen = useCallback(async () => {
    const s = await setFs(!fullscreen);
    setFullscreenState(s.fullscreen);
  }, [fullscreen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        togglePin();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        importFromAnywhere();
      }
      if (mod && e.key.toLowerCase() === "f" && !readerId) {
        e.preventDefault();
        setReaderId(null);
        changeSearchMode("all");
        window.setTimeout(() => nameSearchRef.current?.focus(), 30);
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setReaderId(null);
        changeSearchMode("name");
        window.setTimeout(() => nameSearchRef.current?.focus(), 30);
      }
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [importFromAnywhere, togglePin, toggleFullscreen, readerId, changeSearchMode]);

  const count = list.length;
  const libView = { name: library?.name ?? null, path: library?.path ?? null, count: watchedCount };

  const sidebarProps = {
    active: folder,
    onFolder: (id: FolderId) => {
      setFolder(id);
      setShelf(null);
      setQuery("");
      setNameQuery("");
      setReaderId(null);
      setDrawer(false);
    },
    shelfTree: shelfTree?.tree ?? null,
    libraryDocs,
    shelf,
    onShelf: (p: string) => openShelf(p),
    activeTool,
    onTool: (id: string) => {
      setActiveTool(id);
      if (id === "merge" || id === "split" || id === "sign") {
        setActivePdfToolModal(id);
      }
    },
    onNotice: notify,
    onOpen: importFromAnywhere,
    onOpenDoc: openDoc,
    onOpenVault: () => setVaultOpen(true),
    vaultOpen,
    disk,
    library: libView,
    syncing,
    autoSync,
    isDesktop: isDesk,
    onChooseLibrary: handleChooseLibrary,
    onSyncNow: () => syncNow(),
    onToggleAuto: toggleAuto,
    onOpenSettings: () => setSettingsOpen(true),
    onAbout: () => setAboutOpen(true),
    themeName,
    themeDot: themeVars["--color-amber"],
  };

  return (
    <div className="alif-app relative flex h-full flex-col overflow-hidden bg-panel text-ink">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <TitleBar
          tabs={openTabs}
          activeId={readerId ?? lastTab}
          isReading={!!readerId}
          nameQuery={nameQuery}
          nameSearchRef={nameSearchRef}
          onNameQuery={(value) => {
            setNameQuery(value);
            if (value) setQuery("");
          }}
          onTab={openDoc}
          onCloseTab={closeTab}
          onHome={() => {
            setReaderId(null);
            setFolder("all");
            setShelf(null);
            setQuery("");
            setNameQuery("");
          }}
          onSearch={() => {
            setReaderId(null);
            changeSearchMode("name");
            window.setTimeout(() => nameSearchRef.current?.focus(), 30);
          }}
          onMenu={() => setDrawer(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          pinned={pinned}
          fullscreen={fullscreen}
          onTogglePin={togglePin}
          onToggleFullscreen={toggleFullscreen}
        />

        <div className="flex min-h-0 flex-1" dir="ltr">
          {!readerDoc && <Sidebar className="hidden md:flex" {...sidebarProps} />}

          <main dir="rtl" className="flex min-w-0 flex-1 flex-col">
            {readerDoc ? (
              <Reader key={readerDoc.id} doc={readerDoc} onClose={() => setReaderId(null)} onNotice={notify} onProgress={handleProgress} />
            ) : (
              <div className="scroll-cab min-h-0 flex-1 overflow-y-auto">
                <Library
                  recent={recent}
                  rows={rows}
                  mode={mode}
                  folderName={folderName}
                  query={q}
                  nameQuery={nameQuery}
                  onNameQuery={(value) => {
                    setNameQuery(value);
                    if (value) setQuery("");
                  }}
                  onQuery={(value) => {
                    setQuery(value);
                    if (value) setNameQuery("");
                  }}
                  searchMode={searchMode}
                  onSearchMode={(value) => {
                    changeSearchMode(value);
                    nameSearchRef.current?.focus();
                  }}
                  nameSearchRef={nameSearchRef}
                  allDocs={list}
                  onOpen={openDoc}
                  onOpenFile={importFromAnywhere}
                  onDropFiles={handleDropFiles}
                  onHideExamples={hideExamples}
                  onShowExamples={restoreExamples}
                  hasExamples={list.some((doc) => doc.origin === "seed")}
                  activeTool={activeTool}
                  onTool={(id) => {
                    setActiveTool((cur) => (cur === id ? null : id));
                    if (id === "merge" || id === "split" || id === "sign") {
                      setActivePdfToolModal(id);
                    }
                  }}
                  onClear={() => {
                    setQuery("");
                    setNameQuery("");
                    setFolder("all");
                    setShelf(null);
                  }}
                  library={libView}
                  syncing={syncing}
                  onChooseLibrary={handleChooseLibrary}
                  onSyncNow={() => syncNow()}
                  shelfTree={shelfTree?.tree ?? null}
                  shelfMap={shelfTree?.map ?? null}
                  shelf={shelf}
                  onShelf={openShelf}
                  scanLimitReached={scanLimitReached}
                  libraryDocs={libraryDocs}
                  onRename={isDesk ? setRenaming : undefined}
                  onFileAction={isDesk ? notify : undefined}
                />
              </div>
            )}
          </main>
        </div>

        <StatusBar
          count={count}
          notice={notice}
          libraryName={library?.name}
          diskText={diskText}
          themeLabel={`${pinned ? "مثبّت · " : ""}${themeName}`}
        />
      </div>

      {pinned && (
        <div
          className="pointer-events-none fixed inset-0 z-[60] border border-ink-3"
          aria-hidden="true"
        />
      )}

      <ThemePanel
        open={settingsOpen}
        preset={theme.preset}
        depth={theme.depth}
        onPreset={setPreset}
        onDepth={setDepth}
        onReset={resetTheme}
        onClose={() => setSettingsOpen(false)}
      />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {renaming && <RenameDialog currentName={renaming.file} onSubmit={(name) => renameDoc(renaming, name)} onCancel={() => setRenaming(null)} />}

      <VaultModal
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        onNotice={notify}
        onOpenDecryptedDoc={(doc) => {
          setList((prev) => [doc, ...prev]);
          openDoc(doc.id);
        }}
      />

      {activePdfToolModal && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-black/10" role="status">جارٍ تجهيز أدوات PDF…</div>}>
          <PdfToolsModal
            tool={activePdfToolModal}
            availableDocs={list.filter((d) => !!d.pdf && d.origin !== "seed")}
            onClose={() => setActivePdfToolModal(null)}
            onNotice={notify}
            onOpenNewDoc={(file) => {
              void addImported([
                {
                  name: file.name,
                  path: file.name,
                  size: file.data.byteLength,
                  lastModified: Date.now(),
                  data: file.data,
                },
              ]);
            }}
          />
        </Suspense>
      )}

      {drawer && (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/20" onClick={() => setDrawer(false)} aria-label="إغلاق قائمة المكتبة" />
          <Sidebar
            className="absolute inset-y-0 left-0 flex"
            {...sidebarProps}
            onNotice={(m) => {
              notify(m);
            }}
          />
        </div>
      )}

      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={handleFile} />
    </div>
  );
}

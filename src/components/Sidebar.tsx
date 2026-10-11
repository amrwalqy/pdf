import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, FileText, Folder, FolderOpen, HardDrive, Lock as LockIcon, Plus, RefreshCw, Settings } from "lucide-react";
import { batchActions, folders, type Doc, type FolderId } from "../data";
import { formatBytes, getPdfAssociation, makePdfDefault, type PdfAssociation } from "../lib/desktop";
import type { ShelfNode } from "../lib/shelves";
import { cn } from "../utils/cn";
import { AlifMark } from "./Chrome";

export type DiskView = { used: number; total: number; label: string; source: "electron" | "browser" | "unknown" } | null;
export type LibraryView = { name: string | null; path: string | null; count: number };

type Props = {
  active: FolderId;
  onFolder: (id: FolderId) => void;
  activeTool: string | null;
  onTool: (id: string) => void;
  onNotice: (msg: string) => void;
  onOpen: () => void;
  onOpenDoc: (id: string) => void;
  onOpenVault?: () => void;
  vaultOpen?: boolean;
  className?: string;
  disk: DiskView;
  library: LibraryView;
  syncing: boolean;
  autoSync: boolean;
  isDesktop: boolean;
  onChooseLibrary: () => void;
  onSyncNow: () => void;
  onToggleAuto: () => void;
  onOpenSettings: () => void;
  onAbout: () => void;
  themeName: string;
  themeDot: string;
  shelfTree: ShelfNode | null;
  libraryDocs: Doc[];
  shelf: string | null;
  onShelf: (path: string) => void;
};

function parentDirOf(filePath: string, rootPath: string | null): string {
  const full = (filePath || "").replace(/\\/g, "/");
  const root = (rootPath || "").replace(/\\/g, "/").replace(/\/$/, "");
  const relative = root && full.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? full.slice(root.length + 1) : full;
  const divider = relative.lastIndexOf("/");
  return divider < 0 ? "" : relative.slice(0, divider);
}

const FILES_PER_FOLDER = 60;
const CHILDREN_PER_FOLDER = 300;
const SEARCH_OPEN_LIMIT = 400;
const NO_DOCS: Doc[] = [];

function TreeBranch({ node, active, expanded, toggle, onShelf, onOpenDoc, docsByDir, depth = 0 }: {
  node: ShelfNode;
  active: string | null;
  expanded: Set<string>;
  toggle: (path: string) => void;
  onShelf: (path: string) => void;
  onOpenDoc: (id: string) => void;
  docsByDir: Map<string, Doc[]>;
  depth?: number;
}) {
  const root = node.path === "";
  const open = root || expanded.has(node.path);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [childLimit, setChildLimit] = useState(CHILDREN_PER_FOLDER);
  const directDocs = docsByDir.get(node.path) ?? NO_DOCS;
  const shownFiles = showAllFiles ? directDocs : directDocs.slice(0, FILES_PER_FOLDER);
  return <li>
    <div className={cn("shelf-row", active === node.path && "is-active")} style={{ paddingInlineStart: depth * 8 }}>
      <button onClick={() => !root && toggle(node.path)} disabled={root || !node.children.length} className={cn("shelf-expand", (root || !node.children.length) && "invisible")} aria-label={open ? "طيّ المجلد" : "توسيع المجلد"}>
        <ChevronDown className={cn("h-[12px] w-[12px] transition-transform", !open && "-rotate-90")} strokeWidth={1.7} />
      </button>
      <button onClick={() => onShelf(node.path)} className="flex min-w-0 flex-1 items-center gap-2 py-[5px] pe-2 text-start" title={node.path || node.name}>
        {open ? <FolderOpen className="h-[16px] w-[16px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.7} /> : <Folder className="h-[16px] w-[16px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.7} />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{node.name}</span>
        <span className="tnum text-[10px] text-ink-3">{node.total}</span>
      </button>
    </div>
    {open && <>
      {node.children.length > 0 && <ul className="shelf-children">
        {node.children.slice(0, childLimit).map((child) => <TreeBranch key={child.path} node={child} active={active} expanded={expanded} toggle={toggle} onShelf={onShelf} onOpenDoc={onOpenDoc} docsByDir={docsByDir} depth={depth + 1} />)}
        {node.children.length > childLimit && <li><button onClick={() => setChildLimit((n) => n + CHILDREN_PER_FOLDER)} className="library-tree-file" style={{ paddingInlineStart: Math.min((depth + 1) * 10 + 18, 88) }}>عرض المزيد ({node.children.length - childLimit} مجلداً)</button></li>}
      </ul>}
      {shownFiles.map((doc) => <button key={doc.id} onClick={() => onOpenDoc(doc.id)} className="library-tree-file" style={{ paddingInlineStart: Math.min((depth + 1) * 10 + 18, 88) }} title={doc.file}>
        <FileText className="h-[14px] w-[14px] shrink-0 text-[var(--color-brick)]" strokeWidth={1.8} fill="currentColor" />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[10.5px] text-ink-2">{doc.file}</span>
        <span dir="ltr" className="tnum text-[9px] text-ink-3">{doc.size}</span>
      </button>)}{!showAllFiles && directDocs.length > FILES_PER_FOLDER && <button onClick={() => setShowAllFiles(true)} className="library-tree-file" style={{ paddingInlineStart: Math.min((depth + 1) * 10 + 18, 88) }}>عرض كل {directDocs.length} ملف</button>}
    </>}
  </li>;
}

function pruneTree(node: ShelfNode, query: string, docsByDir: Map<string, Doc[]>): ShelfNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return node;
  const children = node.children
    .map((child) => pruneTree(child, query, docsByDir))
    .filter((child): child is ShelfNode => child !== null);
  const nameHit = node.name.toLowerCase().includes(q);
  const fileHit = (docsByDir.get(node.path) ?? NO_DOCS).some((doc) => doc.file.toLowerCase().includes(q));
  if (nameHit || fileHit || children.length > 0) return { ...node, children };
  return null;
}

function LibraryTree({ tree, active, onShelf, onOpenDoc, rootPath, docs, query }: { tree: ShelfNode; active: string | null; onShelf: (path: string) => void; onOpenDoc: (id: string) => void; rootPath: string | null; docs: Doc[]; query: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((doc) => doc.file.toLowerCase().includes(q));
  }, [docs, query]);
  // Files grouped by folder once per change, instead of filtering the whole library for every folder.
  const docsByDir = useMemo(() => {
    const groups = new Map<string, Doc[]>();
    for (const doc of filteredDocs) {
      const key = parentDirOf(doc.path || "", rootPath);
      const bucket = groups.get(key);
      if (bucket) bucket.push(doc);
      else groups.set(key, [doc]);
    }
    return groups;
  }, [filteredDocs, rootPath]);
  const visible = useMemo(() => pruneTree(tree, query, docsByDir), [tree, query, docsByDir]);
  useEffect(() => {
    // Folders start collapsed, so a library with thousands of folders never opens them all at once.
    // While a search runs, the folders that contain matches open, up to a limit.
    if (!visible || !query.trim()) return;
    const toOpen: string[] = [];
    const walk = (node: ShelfNode) => {
      if (toOpen.length >= SEARCH_OPEN_LIMIT) return;
      if (node.path && node.children.length > 0) toOpen.push(node.path);
      node.children.forEach(walk);
    };
    walk(visible);
    setExpanded(new Set(toOpen));
  }, [visible, query]);
  const toggle = (path: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  if (!visible) return <p className="px-2 py-3 text-[10.5px] text-ink-3">لا توجد مجلدات مطابقة لهذا البحث.</p>;
  return <ul className="shelf-tree"><TreeBranch node={visible} active={active} expanded={expanded} toggle={toggle} onShelf={onShelf} onOpenDoc={onOpenDoc} docsByDir={docsByDir} /></ul>;
}

export function Sidebar({
  active, onFolder, onTool, onNotice, onOpen, onOpenDoc, onOpenVault, vaultOpen, className,
  disk, library, syncing, autoSync, isDesktop, onChooseLibrary, onSyncNow,
  onToggleAuto, onOpenSettings, onAbout, themeName, shelfTree, libraryDocs, shelf, onShelf,
}: Props) {
  const [association, setAssociation] = useState<PdfAssociation | null>(null);
  const [associating, setAssociating] = useState(false);
  const [treeQuery, setTreeQuery] = useState("");
  const [vault, setVault] = useState<{ created: boolean; unlocked: boolean; count: number }>({ created: false, unlocked: false, count: 0 });
  const used = disk && disk.total > 0 ? Math.min(100, disk.used / disk.total * 100) : 0;

  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    const update = () => void getPdfAssociation().then((value) => { if (active) setAssociation(value); });
    update();
    window.addEventListener("focus", update);
    return () => { active = false; window.removeEventListener("focus", update); };
  }, [isDesktop]);

  const refreshVault = useCallback(async () => {
    if (!isDesktop) return;
    try {
      const api = (window as any).electronAPI;
      if (!api?.vaultStatus) return;
      const status = await api.vaultStatus();
      let count = 0;
      if (status.unlocked && api.vaultList) {
        try {
          const files = await api.vaultList();
          count = Array.isArray(files) ? files.length : 0;
        } catch { /* locked or unavailable */ }
      }
      setVault({ created: !!status.created, unlocked: !!status.unlocked, count });
    } catch { /* vault unavailable */ }
  }, [isDesktop]);

  useEffect(() => { void refreshVault(); }, [refreshVault, vaultOpen]);
  useEffect(() => {
    window.addEventListener("focus", refreshVault);
    return () => window.removeEventListener("focus", refreshVault);
  }, [refreshVault]);

  const associate = async () => {
    setAssociating(true);
    try {
      const result = await makePdfDefault();
      setAssociation(result);
      onNotice(result.isDefault ? "أصبح أليف قارئ PDF الافتراضي" : "اختر أليف في إعدادات ويندوز لتعيينه افتراضياً");
    } finally { setAssociating(false); }
  };

  return <aside className={cn("simple-sidebar flex shrink-0 flex-col border-s border-line bg-paper", className)} dir="rtl">
    <div className="sidebar-top"><span className="text-[12px] font-medium text-ink-2">التنقل</span><button onClick={onOpen} className="plain-icon h-7 w-7" aria-label="إضافة PDF" title="فتح PDF"><Plus className="h-4 w-4" /></button></div>
    <div className="scroll-cab min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <nav aria-label="أقسام المكتبة">
        {[folders[0], folders[1], folders[2]].map((item, index) => <button key={item.id} onClick={() => onFolder(item.id)} className={cn("sidebar-link", active === item.id && shelf === null && "is-active")}>
          <item.icon className="h-[16px] w-[16px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.7} />
          <span>{index === 0 ? "المكتبة" : index === 1 ? "المفضلة" : "الأخيرة"}</span>
          {active === item.id && shelf === null && <ChevronLeft className="ms-auto h-[14px] w-[14px] text-ink-3" />}
        </button>)}
        <button onClick={onOpenVault} className="sidebar-link vault-link" title={isDesktop ? (vault.unlocked ? `الخزنة مفتوحة · ${vault.count} ملفات` : vault.created ? "الخزنة مقفلة — انقر لفتحها" : "إنشاء خزنة مشفرة بكلمة سر") : "الخزنة متاحة في تطبيق ويندوز"}>
          <LockIcon className="h-[16px] w-[16px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.7} />
          <span>الخزنة</span>
          <span className="ms-auto flex items-center gap-1.5 text-[10px] text-ink-3">
            {!isDesktop ? "ويندوز" : vault.unlocked ? <><span className="h-1.5 w-1.5 rounded-full bg-moss" />{vault.count}</> : vault.created ? "مقفلة" : "جديدة"}
          </span>
        </button>
      </nav>

      <section className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center gap-2 px-2">
          <FolderOpen className="h-[17px] w-[17px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.7} />
          <button onClick={() => onShelf("")} className="min-w-0 flex-1 truncate text-start text-[12px] font-medium text-ink-2" title={library.path || "مجلد المكتبة"}>مجلد المكتبة</button>
          <button onClick={onChooseLibrary} aria-label="تغيير مجلد المكتبة" title="تغيير مجلد المكتبة" className="plain-icon h-7 w-7"><Settings className="h-4 w-4" /></button>
        </div>
        <div className="px-2 text-[10.5px] text-ink-3"><span dir="auto" className="block truncate">{library.path || "لم يتم اختيار مجلد"}</span></div>
        <div className="mt-2 flex items-center justify-between px-2 text-[10px] text-ink-3"><span>{library.count} ملفات PDF</span><button onClick={onSyncNow} disabled={!library.path || syncing} className="inline-flex items-center gap-1 disabled:opacity-40"><RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />{syncing ? "يفحص" : "تحديث"}</button></div>
        <label className="tree-filter">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={treeQuery} onChange={(e) => setTreeQuery(e.target.value)} placeholder="ابحث في المجلد..." aria-label="بحث في مجلدات المكتبة" />
          {treeQuery && <button onClick={() => setTreeQuery("")} aria-label="مسح بحث المجلد">×</button>}
        </label>
        {shelfTree && <div className="mt-2 border-t border-line/70 pt-2"><LibraryTree tree={shelfTree} active={shelf} onShelf={onShelf} onOpenDoc={onOpenDoc} rootPath={library.path} docs={libraryDocs} query={treeQuery} /></div>}
        <label className="mx-2 mt-2 flex items-center gap-2 text-[10.5px] text-ink-3"><input type="checkbox" checked={autoSync} onChange={onToggleAuto} className="h-3 w-3 accent-[var(--color-amber)]" />مزامنة تلقائية</label>
      </section>

      <section className="mt-4 border-t border-line pt-3">
        <div className="sidebar-section-title">أدوات</div>
        {batchActions.map((action) => <button key={action.id} onClick={() => onTool(action.id)} className="sidebar-link"><action.icon className="h-[15px] w-[15px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.6} />{action.name}</button>)}
      </section>
    </div>

    <div className="sidebar-bottom border-t border-line px-4 py-3">
      {disk && disk.total > 0 && <div className="mb-3 text-[10px] text-ink-3">
        <div className="mb-1 flex items-center justify-between"><span className="flex items-center gap-1.5"><HardDrive className="h-3 w-3" />المساحة المستخدمة</span><span className="tnum" dir="ltr">{formatBytes(disk.used)} / {formatBytes(disk.total)}</span></div>
        <div className="h-[3px] bg-line"><div className="h-full bg-[var(--color-amber)]" style={{ width: `${used}%` }} /></div>
      </div>}
      <div className="flex items-center justify-between text-[11px] text-ink-3"><button onClick={onAbout} className="flex items-center gap-1.5 hover:text-ink" title="حول Alif PDF"><AlifMark className="h-4 w-4 rounded-[3px]" /><span>Alif PDF</span></button><button onClick={onOpenSettings} className="hover:text-ink">{themeName}</button></div>
      {isDesktop && !association?.isDefault && <button onClick={associate} disabled={associating} className="mt-2 w-full text-start text-[10px] text-ink-3 hover:text-ink disabled:opacity-50">{associating ? "فتح إعدادات ويندوز..." : "تعيين أليف قارئ PDF الافتراضي"}</button>}
    </div>
  </aside>;
}

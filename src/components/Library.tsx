import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ChevronLeft, FileText, Folder, Copy, FolderOpen, MoreHorizontal, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { tools, type Doc } from "../data";
import { crumbs, relDir, type ShelfNode } from "../lib/shelves";
import { cn } from "../utils/cn";
import { copyFilePath, showFileInFolder } from "../lib/desktop";
import type { LibraryView } from "./Sidebar";

type Props = {
  recent: Doc[];
  rows: Doc[];
  mode: "recent" | "folder" | "search" | "shelf" | "name-search";
  folderName: string;
  query: string;
  nameQuery: string;
  onNameQuery: (value: string) => void;
  onQuery: (value: string) => void;
  searchMode: "name" | "all";
  onSearchMode: (mode: "name" | "all") => void;
  nameSearchRef: React.RefObject<HTMLInputElement | null>;
  onOpen: (id: string) => void;
  onOpenFile: () => void;
  onDropFiles: (files: File[]) => void;
  onShowExamples: () => void;
  onHideExamples: () => void;
  hasExamples: boolean;
  allDocs: Doc[];
  activeTool: string | null;
  onTool: (id: string) => void;
  onClear: () => void;
  library: LibraryView;
  syncing: boolean;
  onChooseLibrary: () => void;
  onSyncNow: () => void;
  shelfTree: ShelfNode | null;
  shelfMap: Map<string, ShelfNode> | null;
  shelf: string | null;
  onShelf: (path: string | null) => void;
  scanLimitReached: boolean;
  libraryDocs: Doc[];
  /** Rename a PDF on disk. Only given on the desktop, for files that really exist on disk. */
  onRename?: (doc: Doc) => void;
  /** Shows a short message after a file action (desktop only). */
  onFileAction?: (message: string) => void;
};

const ROW_OVERSCAN = 8;
const DEFAULT_ROW_HEIGHT = 56;

/** The nearest ancestor that scrolls, or null when the page itself scrolls. */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/** Index range of the rows on screen. Only those rows are rendered, so huge libraries stay fast. */
function useVisibleRange(listRef: RefObject<HTMLDivElement | null>, count: number, rowHeight: number) {
  const [range, setRange] = useState({ start: 0, end: 40 });
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const scroller = findScrollParent(list);
    const update = () => {
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY;
      const viewportTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const viewportHeight = scroller ? scroller.clientHeight : window.innerHeight;
      const listTop = list.getBoundingClientRect().top - viewportTop + scrollTop;
      const scrolledPast = Math.max(0, scrollTop - listTop);
      const start = Math.max(0, Math.floor(scrolledPast / rowHeight) - ROW_OVERSCAN);
      const end = Math.min(count, start + Math.ceil(viewportHeight / rowHeight) + ROW_OVERSCAN * 2);
      setRange((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
    };
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
      }
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [listRef, count, rowHeight]);
  return range;
}

/** Only real files on disk can be renamed: not the demo books, not the encrypted vault. */
function canRename(doc: Doc, onRename?: (doc: Doc) => void): boolean {
  return !!onRename && !!doc.path && /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(doc.path) && (doc.origin === "watched" || doc.origin === "imported");
}

function FileList({ folders, rows, onOpen, onShelf, onRename, onFileAction }: { folders: ShelfNode[]; rows: Doc[]; onOpen: (id: string) => void; onShelf: (path: string) => void; onRename?: (doc: Doc) => void; onFileAction?: (message: string) => void }) {
  const [menu, setMenu] = useState<{ doc: Doc; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const count = folders.length + rows.length;
  const range = useVisibleRange(listRef, count, rowHeight);

  // The row height comes from the stylesheet, which changes on narrow screens.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(".file-row");
    if (!row) return;
    const minHeight = parseFloat(getComputedStyle(row).minHeight);
    if (minHeight > 0 && Math.abs(minHeight - rowHeight) > 0.5) setRowHeight(minHeight);
  }, [count, range.start, rowHeight]);

  if (!count) return <div className="library-empty"><FileText className="mb-3 h-6 w-6 text-ink-3" strokeWidth={1.4} /><p className="text-[13px] font-medium">لا توجد ملفات مطابقة</p><p className="mt-1 text-[11px] text-ink-3">جرّب عبارة أخرى أو اختر مجلداً مختلفاً.</p></div>;
  // Folders come first, then files. Both are windowed by the same range, so thousands of folders scroll smoothly.
  const folderRows = folders.slice(range.start, Math.min(range.end, folders.length));
  const docStart = Math.max(0, range.start - folders.length);
  const visible = rows.slice(docStart, Math.max(0, range.end - folders.length));
  const firstDocIndex = folders.length + docStart;
  return <div ref={listRef} className="file-list" role="list" aria-label="ملفات PDF" style={{ position: "relative", height: count * rowHeight }}>
    {folderRows.map((node, offset) => <button key={`folder-${node.path}`} role="listitem" onClick={() => onShelf(node.path)} className="file-row folder-row" style={{ position: "absolute", top: (range.start + offset) * rowHeight, left: 0, right: 0, height: rowHeight }}>
      <span className="file-main"><Folder className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} /><span className="truncate text-[12px] text-ink">{node.name}</span></span>
      <span className="file-section text-[11px] text-ink-3">مجلد</span><span className="file-pages tnum text-[11px] text-ink-3">{node.total} ملف</span><span className="file-size" /><ChevronLeft className="h-3.5 w-3.5 justify-self-end text-ink-3" />
    </button>)}
    {visible.map((doc, offset) => <button key={doc.id} role="listitem" onClick={() => onOpen(doc.id)} onContextMenu={canRename(doc, onRename) ? (event) => { event.preventDefault(); setMenu({ doc, x: event.clientX, y: event.clientY }); } : undefined} onKeyDown={canRename(doc, onRename) ? (event) => { if (event.key === "F2") { event.preventDefault(); onRename?.(doc); } } : undefined} className="file-row" title={canRename(doc, onRename) ? `${doc.file} — انقر بزر الفأرة الأيمن للمزيد أو اضغط F2 لتغيير الاسم` : doc.file} style={{ position: "absolute", top: (firstDocIndex + offset) * rowHeight, left: 0, right: 0, height: rowHeight }}>
      <span className="file-main"><FileText className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.45} /><span className="min-w-0"><span dir="auto" className="block truncate text-[12.5px] font-medium text-ink">{doc.file}</span><span className="file-mobile-meta mt-0.5 hidden text-[10px] text-ink-3">{doc.kindLabel} · {doc.size}</span></span>{canRename(doc, onRename) && <span role="button" tabIndex={0} aria-label={`تغيير اسم ${doc.file}`} title="تغيير الاسم" className="file-rename" onClick={(event) => { event.stopPropagation(); onRename?.(doc); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onRename?.(doc); } }}><Pencil className="h-3.5 w-3.5" strokeWidth={1.6} /></span>}</span>
      <span className="file-section truncate text-[11px] text-ink-3">{doc.origin === "seed" ? "مثال" : doc.origin === "vault" ? "الخزنة" : doc.kindLabel}</span>
      <span className="file-pages tnum text-[11px] text-ink-3">{doc.pageCountPending ? "—" : doc.pages}</span>
      <span className="file-size tnum text-[11px] text-ink-3" dir="ltr">{doc.size}</span>
      <ArrowLeft className="file-open-label h-3.5 w-3.5 justify-self-end text-ink-3" />
    </button>)}
    {menu && <FileMenu doc={menu.doc} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onOpen={onOpen} onRename={onRename} onFileAction={onFileAction} />}
  </div>;
}

/** Right-click menu for a file: open, rename, show in Explorer, copy the path. */
function FileMenu({ doc, x, y, onClose, onOpen, onRename, onFileAction }: { doc: Doc; x: number; y: number; onClose: () => void; onOpen: (id: string) => void; onRename?: (doc: Doc) => void; onFileAction?: (message: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Keep the menu fully on screen.
    const left = Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.querySelector<HTMLElement>("button")?.focus();
    const close = (event: Event) => { if (!el.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("keydown", key, true);
    };
  }, [x, y, onClose]);
  const run = (action: () => void | Promise<void>) => () => { onClose(); void action(); };
  return <div ref={ref} className="file-menu" role="menu" dir="rtl" style={{ position: "fixed", left: x, top: y }}>
    <button role="menuitem" onClick={run(() => onOpen(doc.id))}><FileText className="h-3.5 w-3.5" />فتح</button>
    <button role="menuitem" onClick={run(() => onRename?.(doc))}><Pencil className="h-3.5 w-3.5" />تغيير الاسم<kbd>F2</kbd></button>
    <button role="menuitem" onClick={run(async () => { if (doc.path && !(await showFileInFolder(doc.path))) onFileAction?.("تعذّر إظهار الملف في المجلد"); })}><FolderOpen className="h-3.5 w-3.5" />إظهار في المجلد</button>
    <button role="menuitem" onClick={run(async () => { if (doc.path) onFileAction?.((await copyFilePath(doc.path)) ? "نُسخ مسار الملف" : "تعذّر نسخ المسار"); })}><Copy className="h-3.5 w-3.5" />نسخ المسار</button>
  </div>;
}

function Welcome({ onChooseLibrary, onOpenFile, onDropFiles, hasExamples, onShowExamples, onHideExamples, recent, onOpen }: {
  onChooseLibrary: () => void;
  onOpenFile: () => void;
  onDropFiles: (files: File[]) => void;
  hasExamples: boolean;
  onShowExamples: () => void;
  onHideExamples: () => void;
  recent: Doc[];
  onOpen: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inProgress = recent.filter((doc) => !doc.pageCountPending && doc.pages > 0).slice(0, 4);
  return <section className={cn("welcome-page", dragging && "is-dragging")} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.target === event.currentTarget) setDragging(false); }} onDrop={(event) => {
    event.preventDefault(); setDragging(false);
    onDropFiles(Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf")));
  }}>
    <div className="welcome-content">
      <img src="alif-logo.png" alt="Alif PDF" className="welcome-mark" draggable={false} />
      <h1 className="mt-9 text-center text-[25px] font-semibold tracking-tight text-ink">مرحباً بك في قارئ PDF</h1>
      <p className="mt-2 max-w-[39ch] text-center text-[12.5px] leading-relaxed text-ink-2">افتح ملف PDF من خلال قائمة المجلدات</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onChooseLibrary} className="plain-button plain-button-primary min-h-[40px] px-6"><FolderOpen className="h-4 w-4" />اختيار مجلد المكتبة</button>
        <button onClick={onOpenFile} className="plain-button min-h-[40px] px-5"><Plus className="h-4 w-4" />فتح PDF</button>
      </div>
      <div className="welcome-recent">
        <div className="welcome-recent-head"><span>آخر المستندات المفتوحة</span><span className="tnum">{inProgress.length ? `${inProgress.length} ملفات` : ""}</span></div>
        {inProgress.length ? inProgress.map((doc) => {
          const percent = Math.min(100, Math.max(0, Math.round((doc.at / Math.max(doc.pages, 1)) * 100)));
          const remaining = Math.max(doc.pages - doc.at, 0);
          return <button key={doc.id} onClick={() => onOpen(doc.id)} className="recent-row" title={doc.file}>
            <FileText className="h-4 w-4 shrink-0 text-[var(--color-amber)]" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-[12px] font-medium text-ink">{doc.file}</span>
              <span className="recent-bar"><span style={{ width: `${percent}%` }} /></span>
            </span>
            <span className="tnum shrink-0 text-[10px] text-ink-3">{remaining === 0 ? "مكتمل" : `متبقّي ${remaining} · ${percent}%`}</span>
          </button>;
        }) : <p className="welcome-recent-empty">لا توجد مستندات مفتوحة بعد — ستظهر هنا مع تقدّم قراءتك.</p>}
      </div>
      {hasExamples && <div className="mt-3 flex gap-4 text-[10.5px] text-ink-3"><button onClick={onShowExamples} className="hover:text-ink">عرض أمثلة القراءة</button><button onClick={onHideExamples} className="hover:text-ink">إخفاء الأمثلة</button></div>}
    </div>
  </section>;
}

export function Library({
  recent, rows, mode, folderName, query, nameQuery, onNameQuery, onQuery,
  searchMode, onSearchMode, nameSearchRef, onOpen, onOpenFile, onDropFiles,
  onShowExamples, onHideExamples, hasExamples, allDocs, activeTool, onTool, onClear, library, syncing, scanLimitReached,
  onChooseLibrary, onSyncNow, shelfTree, shelfMap, shelf, onShelf, libraryDocs, onRename, onFileAction,
}: Props) {
  const [view, setView] = useState<"all" | "recent">("all");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const isSearch = mode === "name-search" || mode === "search";
  const welcome = mode === "recent" && view === "all" && !isSearch;
  const currentShelf = mode === "shelf" ? shelfMap?.get(shelf ?? "") ?? shelfTree : null;
  const subfolders = isSearch ? [] : currentShelf?.children ?? [];
  const visibleDocs = useMemo(() => {
    if (mode === "recent") return recent;
    const results = currentShelf
      ? libraryDocs.filter((doc) => relDir(doc.path, library.path) === currentShelf.path)
      : rows;
    if (mode === "name-search") return results;
    return [...results].sort((a, b) => sort === "name" ? a.file.localeCompare(b.file, "ar") : (b.lastModified ?? 0) - (a.lastModified ?? 0));
  }, [mode, recent, currentShelf, libraryDocs, library.path, rows, sort]);
  const searchValue = searchMode === "name" ? nameQuery : query;
  const updateSearch = searchMode === "name" ? onNameQuery : onQuery;
  const title = isSearch ? "نتائج البحث" : currentShelf?.name ?? (mode === "folder" ? folderName : "المكتبة");

  return <main className="simple-library" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
    event.preventDefault();
    onDropFiles(Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf")));
  }}>
    {!welcome && <header className="library-heading">
      <div className="min-w-0">
        {currentShelf && shelfTree ? <nav className="mb-2 flex flex-wrap items-center gap-1 text-[11px]" aria-label="مسار المكتبة">
          {crumbs(currentShelf.path, shelfTree.name).map((item, index, items) => <span key={item.path} className="flex items-center gap-1">
            {index > 0 && <ChevronLeft className="h-3 w-3 text-ink-3" />}
            <button onClick={() => onShelf(item.path)} disabled={index === items.length - 1} className={cn("py-1", index === items.length - 1 ? "font-medium text-ink-2" : "text-ink-3 hover:text-ink")}>{item.name}</button>
          </span>)}
        </nav> : <div className="mb-1 text-[10px] text-ink-3">{mode === "name-search" ? "اسم الملف" : "المكتبة"}</div>}
        <h1 className="truncate text-[20px] font-medium leading-relaxed text-ink">{title}</h1>
      </div>
      <div className="library-actions flex shrink-0 items-center gap-2">
        {mode === "shelf" && currentShelf?.path && <button onClick={() => onShelf(currentShelf.path.includes("/") ? currentShelf.path.slice(0, currentShelf.path.lastIndexOf("/")) : "")} className="plain-button">رجوع</button>}
        {library.path && <button onClick={onSyncNow} disabled={syncing} className="plain-button"><RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />تحديث</button>}
        <button onClick={onOpenFile} className="plain-button plain-button-primary"><Plus className="h-4 w-4" />فتح PDF</button>
        <details className="plain-menu">
          <summary className="plain-icon" aria-label="أدوات PDF" title="أدوات PDF"><MoreHorizontal className="h-[18px] w-[18px]" /></summary>
          <div className="plain-menu-content"><p className="px-3 pb-1 pt-2 text-[11px] text-ink-3">أدوات PDF</p>
            {tools.map((tool) => <button key={tool.id} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onTool(tool.id); }} className={cn("plain-menu-item", activeTool === tool.id && "font-medium text-ink")}><tool.icon className="h-[15px] w-[15px]" strokeWidth={1.6} />{tool.title}</button>)}
            <button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onChooseLibrary(); }} className="plain-menu-item border-t border-line"><FolderOpen className="h-[15px] w-[15px]" />اختيار مجلد المكتبة</button>
          </div>
        </details>
      </div>
    </header>}

    {!welcome && <div className="library-search" role="search" aria-label="البحث في ملفات PDF">
      <Search className="h-[17px] w-[17px] shrink-0 text-ink-3" strokeWidth={1.7} />
      <input ref={nameSearchRef} type="search" autoComplete="off" dir="auto" value={searchValue} onChange={(event) => updateSearch(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") updateSearch("");
        if (event.key === "Enter" && isSearch && visibleDocs.length) onOpen(visibleDocs[0].id);
      }} placeholder={searchMode === "name" ? "ابحث باسم ملف PDF" : "ابحث في المكتبة والملاحظات"} aria-label={searchMode === "name" ? "البحث باسم ملف PDF" : "بحث عام في المكتبة"} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
      {searchValue && <button onClick={() => updateSearch("")} className="plain-icon h-7 w-7" aria-label="مسح البحث"><X className="h-3.5 w-3.5" /></button>}
      <select value={searchMode} onChange={(event) => onSearchMode(event.target.value as "name" | "all")} className="library-search-scope" aria-label="نوع البحث"><option value="name">اسم الملف</option><option value="all">بحث عام</option></select>
    </div>}

    {welcome ? <Welcome onOpenFile={onOpenFile} onChooseLibrary={onChooseLibrary} onDropFiles={onDropFiles} onShowExamples={onShowExamples} onHideExamples={onHideExamples} hasExamples={hasExamples} recent={recent} onOpen={onOpen} /> : <>
      <div className="library-list-toolbar">
        {mode === "recent" ? <nav className="flex gap-5 text-[12px]" aria-label="عرض الملفات">
          <button onClick={() => setView("all")} aria-pressed={view === "all"} className={cn("library-view-tab", view === "all" && "is-active")}>كل الملفات</button>
          <button onClick={() => setView("recent")} aria-pressed={view === "recent"} className={cn("library-view-tab", view === "recent" && "is-active")}>الأخيرة</button>
        </nav> : <span className="text-[11px] text-ink-3">{visibleDocs.length} ملف</span>}
        <div className="flex shrink-0 items-center gap-2">
          {isSearch && <button onClick={onClear} className="text-[11px] text-ink-3 hover:text-ink">مسح البحث</button>}
          <select value={sort} onChange={(event) => setSort(event.target.value as "recent" | "name")} className="bg-transparent text-[11px] text-ink-3 outline-none" aria-label="ترتيب الملفات"><option value="recent">الأحدث أولاً</option><option value="name">حسب الاسم</option></select>
        </div>
      </div>
      <div className="file-column-labels" aria-hidden="true"><span>الاسم</span><span>القسم</span><span>الصفحات</span><span>الحجم</span><span /></div>
      <FileList folders={subfolders} rows={visibleDocs} onOpen={onOpen} onShelf={onShelf} onRename={onRename} onFileAction={onFileAction} />
      {allDocs.some((doc) => doc.origin === "seed") && <button onClick={onHideExamples} className="mt-3 text-[10.5px] text-ink-3 hover:text-ink">إخفاء الأمثلة التوضيحية</button>}
    </>}

    {library.path && !welcome && <footer className="library-bottom-note"><span className="tnum">{visibleDocs.length} ملف</span>{scanLimitReached && <span className="text-[11px] text-ink-3">بلغت المكتبة حد الفهرسة؛ قسّمها إلى مجلدات أصغر لرؤية كل الملفات</span>}<span className="max-w-[70%] truncate" dir="auto" title={library.path}>{library.path}</span></footer>}
  </main>;
}
import { Expand, FileText, Menu, Palette, Pin, Search, Shrink, X } from "lucide-react";
import type { Doc } from "../data";
import { cn } from "../utils/cn";

export function AlifMark({ className = "" }: { className?: string }) {
  return <img src="alif-logo.png" alt="Alif PDF" className={className} draggable={false} />;
}

type TitleBarProps = {
  tabs: Doc[];
  activeId: string | null;
  isReading: boolean;
  nameQuery: string;
  nameSearchRef: React.RefObject<HTMLInputElement | null>;
  onNameQuery: (value: string) => void;
  onTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onHome: () => void;
  onSearch: () => void;
  onMenu: () => void;
  onOpenSettings: () => void;
  pinned: boolean;
  fullscreen: boolean;
  onTogglePin: () => void;
  onToggleFullscreen: () => void;
};

export function TitleBar({
  tabs, activeId, isReading, nameQuery, nameSearchRef, onNameQuery,
  onTab, onCloseTab, onHome, onSearch, onMenu, onOpenSettings,
  pinned, fullscreen, onTogglePin, onToggleFullscreen,
}: TitleBarProps) {
  return <header dir="ltr" className="simple-titlebar">
    <button onClick={onMenu} className="plain-icon title-menu" aria-label="قائمة المكتبة" title="قائمة المكتبة"><Menu className="h-4 w-4" strokeWidth={1.7} /></button>
    <button dir="rtl" onClick={onHome} className="title-brand" aria-label="Alif PDF — المكتبة" title="Alif PDF — المكتبة">
      <AlifMark className="title-logo" />
      <span className="title-name">Alif <em>PDF</em></span>
    </button>

    <label dir="rtl" className="global-search">
      <Search className="h-[16px] w-[16px] shrink-0 text-[var(--color-amber)]" strokeWidth={1.8} />
      <input ref={nameSearchRef} value={nameQuery} onFocus={onSearch} onChange={(e) => onNameQuery(e.target.value)} placeholder="ابحث في مكتبة المستندات..." aria-label="بحث باسم ملف PDF" />
      <kbd dir="ltr">Ctrl+K</kbd>
    </label>

    {isReading && <div className="simple-tabs scroll-cab">
      {tabs.map((doc) => <div key={doc.id} className={cn("simple-tab document-tab", activeId === doc.id && "is-active")}>
        <button dir="auto" onClick={() => onTab(doc.id)} className="flex min-w-0 flex-1 items-center gap-1.5" title={doc.file}><FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /><span className="truncate">{doc.file}</span></button>
        <button onClick={() => onCloseTab(doc.id)} className="tab-close" aria-label={`إغلاق ${doc.file}`}><X className="h-3 w-3" /></button>
      </div>)}
    </div>}

    <div className="title-actions">
      <button onClick={onSearch} className="plain-icon compact-search" title="البحث في ملفات المكتبة" aria-label="البحث في الملفات"><Search className="h-4 w-4" strokeWidth={1.8} /></button>
      <button onClick={onTogglePin} className={cn("plain-icon title-pin", pinned && "is-active")} aria-pressed={pinned} title={pinned ? "إلغاء تثبيت النافذة" : "تثبيت النافذة فوق الكل"} aria-label="تثبيت النافذة"><Pin className="h-4 w-4" strokeWidth={1.7} fill={pinned ? "currentColor" : "none"} /></button>
      <button onClick={onToggleFullscreen} className="plain-icon title-fullscreen" aria-label="ملء الشاشة" title="ملء الشاشة (F11)">{fullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</button>
      <button onClick={onOpenSettings} className="plain-icon title-settings" aria-label="المظهر" title="المظهر"><Palette className="h-4 w-4" strokeWidth={1.7} /></button>
    </div>
  </header>;
}

export function StatusBar({ count, notice, libraryName, diskText, themeLabel }: { count: number; notice: string | null; libraryName?: string | null; diskText?: string | null; themeLabel?: string | null }) {
  return <footer className="simple-statusbar" dir="rtl">
    <span className="tnum shrink-0">{count} ملف</span>
    {libraryName && <span className="status-library truncate" title={libraryName}>{libraryName}</span>}
    {notice && <span className="status-message min-w-0 flex-1 truncate" role="status">{notice}</span>}
    {diskText && <span className="status-disk tnum" dir="auto">{diskText}</span>}
    {themeLabel && <span className="status-theme">{themeLabel}</span>}
  </footer>;
}
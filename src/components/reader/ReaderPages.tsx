import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Doc } from "../../data";
import { pageAspect, prefetchPage, renderPage, renderTextLayer } from "../../lib/pdf";
import type { resolvePageStyle } from "../../lib/pageTone";
import { cn } from "../../utils/cn";
import { HIGHLIGHT_COLORS, highlightsForPage, hitTestHighlights, type Highlight } from "../../lib/highlights";

/** Draws saved text highlights on a page. Sits under the (invisible but clickable) text layer, so it stays
 *  purely decorative here — clicking a highlighted line is handled by the page container's own click
 *  handler, which hit-tests the click point against these same rectangles (see hitTestHighlights). */
export function HighlightLayer({ items }: { items: Highlight[] }) {
  if (!items.length) return null;
  return <div aria-hidden className="pointer-events-none absolute inset-0" style={{ mixBlendMode: "multiply" }}>
    {items.flatMap((item) => item.rects.map((rect, index) => <span key={`${item.id}-${index}`} className="absolute rounded-[2px]" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, backgroundColor: HIGHLIGHT_COLORS[item.tone] }} />))}
  </div>;
}

export const BASE_W = 620;
export const BASE_H = 877;
export type PageStyle = ReturnType<typeof resolvePageStyle>;

function Marked({ text, term, style }: { text: string; term: string; style: PageStyle }) {
  if (!term.trim()) return <>{text}</>;
  const at = text.toLowerCase().indexOf(term.trim().toLowerCase());
  if (at < 0) return <>{text}</>;
  return <>
    {text.slice(0, at)}
    <mark style={{ backgroundColor: style.markBg, color: style.text }}>{text.slice(at, at + term.trim().length)}</mark>
    {text.slice(at + term.trim().length)}
  </>;
}

export function SamplePage({ doc, page, term, style }: { doc: Doc; page: number; term: string; style: PageStyle }) {
  const paras = doc.body.length ? doc.body : ["لا يوجد نص متاح لهذه الصفحة."];
  const start = ((page - 1) * 3) % paras.length;
  const chapter = [...doc.toc].reverse().find((item) => item.page <= page)?.title ?? doc.title;

  return <div dir="rtl" className="reader-sample-page relative h-full w-full overflow-hidden" style={{ backgroundColor: style.bg, color: style.text }}>
    <div className="absolute inset-x-[52px] top-[47px] flex items-center justify-between gap-4 border-b pb-2 text-[9px]" style={{ borderColor: style.border, color: style.subText }}>
      <span className="truncate">{doc.title}</span>
      <span className="shrink-0">مثال توضيحي</span>
    </div>
    <h2 className="absolute inset-x-[52px] top-[78px] text-center font-display text-[17px] font-bold leading-relaxed">{chapter}</h2>
    <div className="absolute inset-x-[56px] bottom-[65px] top-[145px] overflow-hidden text-justify font-display text-[18px] leading-[2.45]">
      {[0, 1, 2].map((offset) => <p key={offset} className={offset ? "mt-4 indent-5" : ""}>
        <Marked text={paras[(start + offset) % paras.length]} term={term} style={style} />
      </p>)}
    </div>
    <div className="absolute inset-x-[52px] bottom-[34px] flex items-center gap-3 font-display text-[13px]" style={{ color: style.subText }}>
      <span className="h-px flex-1" style={{ backgroundColor: style.border }} />
      <span className="tnum">{page}</span>
      <span className="h-px flex-1" style={{ backgroundColor: style.border }} />
    </div>
  </div>;
}

/** The long-scroll view only renders PDFs near the reading viewport. */
export function ContinuousPage({
  proxy, doc, number, width, zoom, renderZoom, term, style, viewport, active, highlights, onHighlightClick,
}: {
  highlights: Highlight[];
  onHighlightClick?: (item: Highlight, event: React.MouseEvent<HTMLDivElement>) => void;
  proxy: any;
  doc: Doc;
  number: number;
  width: number;
  zoom: number;
  renderZoom: number;
  term: string;
  style: PageStyle;
  viewport: RefObject<HTMLDivElement | null>;
  active: boolean;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(BASE_H / BASE_W);
  const [near, setNear] = useState(number <= 2);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    // Keep only pages near the viewport mounted. This releases their canvases
    // when scrolling through a large document instead of accumulating one
    // full-resolution bitmap per page.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setNear(entry.isIntersecting);
    }, { root: viewport.current, rootMargin: "850px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, viewport]);

  useEffect(() => {
    if (!near || !proxy) return;
    let alive = true;
    void pageAspect(proxy, number).then((value) => { if (alive) setAspect(value); });
    prefetchPage(proxy, number + 1);
    return () => { alive = false; };
  }, [near, proxy, number]);

  useEffect(() => {
    if (!near || !proxy || !canvas.current) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive || !canvas.current) return;
      void renderPage(proxy, number, canvas.current, Math.round(BASE_W * renderZoom))
        .then((ok) => { if (ok && alive && layer.current) void renderTextLayer(proxy, number, layer.current, Math.round(BASE_W * renderZoom)); });
    }, 20);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [near, proxy, number, renderZoom]);

  return <div
    ref={holder}
    data-page={number}
    data-sheet-page={number}
    dir="rtl"
    className={cn("reader-sheet relative shrink-0", active && "reader-sheet-active")}
    style={{ width, height: proxy ? width * aspect : BASE_H * zoom, backgroundColor: style.bg, borderColor: style.border }}
    onClick={(event) => {
      if (!onHighlightClick) return;
      const hit = hitTestHighlights({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), highlightsForPage(highlights, number));
      if (hit) onHighlightClick(hit, event);
    }}
  >
    {near ? proxy ? <>
      <canvas ref={canvas} className="block h-full w-full" style={{ filter: style.filter }} />
      <HighlightLayer items={highlightsForPage(highlights, number)} />
      <div ref={layer} className="textLayer absolute inset-0 select-text" />
    </> : doc.pdf ? (
      <div className="grid h-full place-items-center text-[12px]" style={{ color: style.subText }}>جارٍ فتح الصفحة...</div>
    ) : <div style={{ width: BASE_W, height: BASE_H, zoom } as React.CSSProperties}>
      <SamplePage doc={doc} page={number} term={term} style={style} />
    </div> : <div className="grid h-full place-items-center font-display text-[14px]" style={{ color: style.subText }}>صفحة {number}</div>}
    <span className="reader-sheet-number pointer-events-none absolute -bottom-[25px] inset-x-0 text-center text-[11px] tnum text-ink-3">{number}</span>
  </div>;
}
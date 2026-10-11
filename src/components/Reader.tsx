import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hand,
  LayoutPanelLeft,
  LoaderCircle,
  Maximize2,
  Palette,
  Plus,
  Printer,
  ScanSearch,
  ScrollText,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Doc, Note } from "../data";
import { arabicIncludes } from "../lib/arabicSearch";
import { isDesktop, libraryPdfUrl, readLibraryPdf } from "../lib/desktop";
import { classifyPdfError } from "../lib/pdfErrors";
import { idbGet, idbPut, type DocMeta, type DocTextIndex } from "../lib/idb";
import { loadPageTone, resolvePageStyle, savePageTone, type PageToneState } from "../lib/pageTone";
import { detectOcrText, isProxyUsable, pageAspect, prefetchPage, registerProxyLRU, renderPage, renderTextLayer, openPdfOrThrow } from "../lib/pdf";
import { cn } from "../utils/cn";
import { PRINT_PAGE_LIMIT, printPdfDocument } from "../lib/printPdf";
import { PageTonePanel } from "./PageTonePanel";
import { PasswordDialog } from "./PasswordDialog";
import { BASE_H, BASE_W, ContinuousPage, HighlightLayer, SamplePage } from "./reader/ReaderPages";
import { HIGHLIGHT_COLORS, HIGHLIGHT_LABELS, HIGHLIGHT_SWATCH, HIGHLIGHT_TONES, addHighlight, findHighlight, highlightsForPage, hitTestHighlights, makeHighlightId, mergeLineRects, normalizeRect, removeHighlight, sanitizeHighlights, updateHighlightComment, type Highlight, type HighlightRect, type HighlightTone } from "../lib/highlights";

const PAD_X = 24;
const PAD_Y = 30;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 10;
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
type ViewMode = "book" | "scroll";
type PanelTab = "thumbs" | "outline" | "notes" | "bookmarks";

export function Reader({ doc, onClose, onNotice, onProgress }: { doc: Doc; onClose: () => void; onNotice: (msg: string) => void; onProgress?: (id: string, page: number) => void }) {
  const [page, setPage] = useState(doc.at || 1);
  const [pageCount, setPageCount] = useState(doc.pages || 1);
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);
  const [renderZoom, setRenderZoom] = useState(1);
  const [aspect, setAspect] = useState(BASE_H / BASE_W);
  const [view, setView] = useState<ViewMode>("book");
  const viewRef = useRef<ViewMode>(view);
  viewRef.current = view;
  const [pageTone, setPageTone] = useState<PageToneState>(loadPageTone);
  const pageStyle = useMemo(() => resolvePageStyle(pageTone), [pageTone]);
  const [showTonePanel, setShowTonePanel] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("thumbs");
  const [showSearch, setShowSearch] = useState(false);
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [pdfHits, setPdfHits] = useState<number[]>([]);
  const [notes, setNotes] = useState<Note[]>(() => doc.notes || []);
  const [bookmarks, setBookmarks] = useState<number[]>(() => doc.bookmarks || []);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [pendingSelection, setPendingSelection] = useState<{ page: number; rects: HighlightRect[]; text: string; x: number; y: number } | null>(null);
  const [openHighlight, setOpenHighlight] = useState<{ id: string; x: number; y: number } | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteTone, setNoteTone] = useState<Note["tone"]>("amber");
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [handMode, setHandMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryRead, setRetryRead] = useState(0);
  const [isScanned, setIsScanned] = useState(doc.isScanned ?? false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordRetry, setPasswordRetry] = useState(false);
  const [proxy, setProxy] = useState<any>(() => isProxyUsable(doc.pdf?.proxy) ? doc.pdf!.proxy : null);
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const printDoc = useCallback(async () => {
    if (printingRef.current) return;
    if (!proxy) { onNotice("افتح الملف أولاً ثم اطبعه"); return; }
    if (proxy.numPages > PRINT_PAGE_LIMIT) { onNotice(`الطباعة من داخل أليف حتى ${PRINT_PAGE_LIMIT} صفحة. هذا الملف ${proxy.numPages} صفحة.`); return; }
    printingRef.current = true;
    setPrinting(true);
    const result = await printPdfDocument(proxy, doc.file, (done, total) => { if (total > 12 && done % 10 === 0) onNotice(`تجهيز الطباعة… ${done} من ${total}`); });
    printingRef.current = false;
    setPrinting(false);
    if (result === "failed") onNotice("تعذّر تجهيز الملف للطباعة");
  }, [proxy, doc.file, onNotice]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const zoomAnchor = useRef<{ cx: number; cy: number; px: number; py: number; ratio: number; rightEdge: boolean } | null>(null);
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);
  const autoFit = useRef(true);
  const jumping = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  const isFile = !!doc.pdf;
  const metaKey = doc.path || `${doc.file}_${doc.pages}`;
  const progress = pageCount > 0 ? Math.round((page / pageCount) * 100) : 0;
  const isBookmarked = bookmarks.includes(page);

  // Persist the reading position and annotations separately from the PDF itself.
  // Runs once per opened document; later App list updates must not yank the page back.
  const restoredOnce = useRef(false);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    let active = true;
    void idbGet<DocMeta>("meta", metaKey)
      .then((saved) => {
        if (!active || !saved) return;
        if (saved.lastPage && saved.lastPage >= 1 && (doc.pageCountPending || saved.lastPage <= doc.pages)) setPage(saved.lastPage);
        if (saved.zoom) {
          const storedZoom = clampZoom(saved.zoom);
          zoomRef.current = storedZoom;
          autoFit.current = false;
          setZoomState(storedZoom);
        }
        if (saved.viewMode) setView(saved.viewMode);
        if (saved.notes) { setNotes(saved.notes); doc.notes = saved.notes; }
        if (saved.bookmarks) { setBookmarks(saved.bookmarks); doc.bookmarks = saved.bookmarks; }
        if (saved.highlights) setHighlights(sanitizeHighlights(saved.highlights));
      })
      .catch(() => {})
      .finally(() => { if (active) setMetadataLoaded(true); });
    return () => { active = false; };
  }, [doc, metaKey]);

  useEffect(() => {
    if (!metadataLoaded) return;
    const timer = window.setTimeout(() => {
      void idbPut("meta", { key: metaKey, lastPage: page, zoom, viewMode: view, notes, bookmarks, highlights } satisfies DocMeta).catch(() => {});
      progressRef.current?.(doc.id, page);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [metadataLoaded, metaKey, page, zoom, view, notes, bookmarks, highlights, doc.id]);

  useEffect(() => {
    if (!isFile) return;
    if (proxy) { registerProxyLRU(metaKey, proxy); return; }
    let active = true;
    setLoadError(null);
    const passwordPrompt = (reason: "need_password" | "incorrect_password") => new Promise<string | null>((resolve) => {
      if (!active) return resolve(null);
      setPasswordRetry(reason === "incorrect_password");
      passwordResolver.current = resolve;
      setPasswordOpen(true);
    });
    void (async () => {
      // On the desktop, a library PDF streams from disk in byte ranges (alif-file://), so large files stay out of memory.
      let streamUrl = doc.pdf?.url;
      if (!streamUrl && doc.path && (doc.origin === "watched" || (doc.origin === "imported" && isDesktop()))) {
        streamUrl = (await libraryPdfUrl(doc.path)) ?? undefined;
        if (streamUrl && doc.pdf) doc.pdf.url = streamUrl;
      }
      if (streamUrl) return openPdfOrThrow({ url: streamUrl }, passwordPrompt);
      let bytes = doc.pdf?.data;
      if (!bytes && doc.path && (doc.origin === "watched" || (doc.origin === "imported" && isDesktop()))) {
        bytes = (await readLibraryPdf(doc.path)) ?? undefined;
        if (bytes) doc.pdf!.data = bytes;
      }
      if (!bytes) return null;
      return openPdfOrThrow(bytes, passwordPrompt);
    })().then((result) => {
      if (!active) { if (result) void result.proxy.loadingTask.destroy().catch(() => undefined); return; }
      if (!result) { setLoadError("تعذّر فتح هذا الملف. تأكد من وجوده وصحته."); return; }
      doc.pdf!.proxy = result.proxy;
      doc.pages = result.pages;
      doc.pageCountPending = false;
      setPageCount(result.pages);
      setPage((current) => Math.max(1, Math.min(current, result.pages)));
      setProxy(result.proxy);
      registerProxyLRU(metaKey, result.proxy);
      void detectOcrText(result.proxy).then((analysis) => {
        if (!active) return;
        setIsScanned(analysis.isScanned);
        doc.isScanned = analysis.isScanned;
        void idbPut("textindex", {
          path: doc.path || doc.file,
          size: doc.pdf?.data?.byteLength || 0,
          lastModified: doc.lastModified || 0,
          charCount: analysis.sampleText.length,
          isScanned: analysis.isScanned,
          sampleText: analysis.sampleText,
          pageTexts: [],
        } satisfies DocTextIndex).catch(() => {});
      });
    }).catch((err) => { if (active) setLoadError(classifyPdfError(err)); });
    return () => { active = false; };
  }, [doc, isFile, proxy, metaKey, retryRead]);

  useEffect(() => {
    if (!proxy) return;
    let active = true;
    void pageAspect(proxy, page).then((value) => { if (active) setAspect(value); });
    prefetchPage(proxy, page + 1);
    prefetchPage(proxy, page - 1);
    return () => { active = false; };
  }, [proxy, page]);

  useEffect(() => {
    if (!proxy || view !== "book" || !canvasRef.current) return;
    let active = true;
    void renderPage(proxy, page, canvasRef.current, Math.round(BASE_W * renderZoom)).then((ok) => {
      if (active && ok && textLayerRef.current) void renderTextLayer(proxy, page, textLayerRef.current, Math.round(BASE_W * renderZoom));
    });
    return () => { active = false; };
  }, [proxy, page, renderZoom, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderZoom(zoom), 160);
    return () => window.clearTimeout(timer);
  }, [zoom]);

  const zoomAt = useCallback((next: number, x?: number, y?: number) => {
    const el = scrollRef.current;
    const previous = zoomRef.current;
    const value = clampZoom(next);
    if (Math.abs(value - previous) < .0005) return;
    if (el) {
      const rect = el.getBoundingClientRect();
      const cx = (x ?? rect.left + rect.width / 2) - rect.left;
      const cy = (y ?? rect.top + rect.height / 2) - rect.top;
      zoomAnchor.current = {
        cx, cy, px: el.scrollLeft + cx, py: el.scrollTop + cy,
        ratio: value / previous, rightEdge: x === undefined && y === undefined && value > previous,
      };
    }
    zoomRef.current = value;
    autoFit.current = false;
    setZoomState(value);
  }, []);

  const fitWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth < 1) return;
    zoomAt((el.clientWidth - 2 * PAD_X - 8) / BASE_W);
    autoFit.current = true;
  }, [zoomAt]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => { if (autoFit.current) fitWidth(); });
    observer.observe(el);
    fitWidth();
    return () => observer.disconnect();
  }, [fitWidth]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    zoomAnchor.current = null;
    el.scrollLeft = anchor.rightEdge && viewRef.current === "book"
      ? Math.max(0, el.scrollWidth - el.clientWidth)
      : (anchor.px - PAD_X) * anchor.ratio + PAD_X - anchor.cx;
    el.scrollTop = (anchor.py - PAD_Y) * anchor.ratio + PAD_Y - anchor.cy;
  }, [zoom]);

  const scrollToPage = useCallback((target: number) => {
    const el = scrollRef.current;
    const node = el?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (!el || !node) return;
    jumping.current = true;
    el.scrollTo({ top: Math.max(node.offsetTop - PAD_Y, 0), behavior: "smooth" });
    window.setTimeout(() => { jumping.current = false; }, 650);
  }, []);

  const jumpTo = useCallback((target: number) => {
    const next = Math.max(1, Math.min(target, pageCount));
    setPage(next);
    if (viewRef.current === "scroll") requestAnimationFrame(() => scrollToPage(next));
  }, [pageCount, scrollToPage]);

  const turn = useCallback((step: 1 | -1) => {
    const next = Math.max(1, Math.min(pageRef.current + step, pageCount));
    if (next === pageRef.current) return;
    setPage(next);
    if (viewRef.current === "scroll") scrollToPage(next);
  }, [pageCount, scrollToPage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || view !== "scroll") return;
    let frame = 0;
    const track = () => {
      if (jumping.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marker = el.scrollTop + el.clientHeight * .38;
        let visible = 1;
        for (const node of el.querySelectorAll<HTMLElement>("[data-page]")) {
          if (node.offsetTop <= marker) visible = Number(node.dataset.page);
          else break;
        }
        if (visible !== pageRef.current) setPage(visible);
      });
    };
    el.addEventListener("scroll", track, { passive: true });
    return () => { cancelAnimationFrame(frame); el.removeEventListener("scroll", track); };
  }, [view]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let swipe = 0;
    let edge = 0;
    let lastTurn = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomAt(zoomRef.current * Math.exp(-Math.max(-60, Math.min(60, event.deltaY)) * .012), event.clientX, event.clientY);
        return;
      }
      if (viewRef.current !== "book") return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.3;
      if (horizontal) {
        if (el.scrollWidth > el.clientWidth + 2) { swipe = 0; return; }
        event.preventDefault();
        if (performance.now() - lastTurn < 550) return;
        swipe += event.deltaX;
        if (Math.abs(swipe) > 110) { turn(swipe < 0 ? 1 : -1); swipe = 0; lastTurn = performance.now(); }
        return;
      }
      swipe = 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      const atTop = el.scrollTop <= 1;
      if ((event.deltaY > 0 && atBottom) || (event.deltaY < 0 && atTop)) {
        edge += event.deltaY;
        if (Math.abs(edge) > 260 && performance.now() - lastTurn > 650) {
          const direction = edge > 0 ? 1 : -1;
          turn(direction);
          requestAnimationFrame(() => { el.scrollTop = direction > 0 ? 0 : el.scrollHeight; });
          lastTurn = performance.now();
          edge = 0;
        }
      } else edge = 0;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt, turn]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { distance: number; zoom: number } | null = null;
    let swipe: { x: number; y: number; time: number } | null = null;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) { pinch = { distance: distance(e.touches), zoom: zoomRef.current }; swipe = null; }
      else if (e.touches.length === 1) swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: performance.now() };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      zoomAt(pinch.zoom * distance(e.touches) / pinch.distance,
        (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (swipe && e.changedTouches.length === 1 && viewRef.current === "book" && el.scrollWidth <= el.clientWidth + 2) {
        const dx = e.changedTouches[0].clientX - swipe.x;
        const dy = e.changedTouches[0].clientY - swipe.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - swipe.time < 600) turn(dx > 0 ? 1 : -1);
      }
      swipe = null;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
    };
  }, [turn, zoomAt]);

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || event.pointerType === "touch" || !(handMode || event.altKey || event.button === 1)) return;
    event.preventDefault();
    panStart.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const start = panStart.current;
    if (!el || !start) return;
    el.scrollLeft = start.left - (event.clientX - start.x);
    el.scrollTop = start.top - (event.clientY - start.y);
  };
  const endPan = () => { panStart.current = null; setDragging(false); };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTerm(term.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    let stopped = false;
    setPdfHits([]);
    if (!proxy || !debouncedTerm) return;
    void (async () => {
      const matches: number[] = [];
      for (let index = 1; index <= pageCount && !stopped; index++) {
        try {
          const pdfPage = await proxy.getPage(index);
          const content = await pdfPage.getTextContent();
          const text = content.items.map((item: { str?: string }) => item.str || "").join(" ");
          if (arabicIncludes(text, debouncedTerm)) matches.push(index);
        } catch { /* Textless or unavailable page. */ }
        if (index % 8 === 0) {
          if (!stopped) setPdfHits([...matches]);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
      if (!stopped) setPdfHits([...matches]);
    })();
    return () => { stopped = true; };
  }, [proxy, pageCount, debouncedTerm]);

  const sampleHits = useMemo(() => {
    if (isFile || !debouncedTerm) return [] as number[];
    const results: number[] = [];
    for (let index = 1; index <= pageCount; index++) {
      const start = ((index - 1) * 3) % Math.max(1, doc.body.length);
      if ([0, 1, 2].some((offset) => arabicIncludes(doc.body[(start + offset) % doc.body.length] || "", debouncedTerm))) results.push(index);
      if (results.length >= 60) break;
    }
    return results;
  }, [isFile, debouncedTerm, doc, pageCount]);

  const hits = isFile ? pdfHits : sampleHits;
  const hitIndex = hits.indexOf(page);
  const nextHit = (direction: -1 | 1) => {
    if (!hits.length) return;
    const start = hitIndex < 0 ? (direction === 1 ? -1 : 0) : hitIndex;
    jumpTo(hits[(start + direction + hits.length) % hits.length]);
  };

  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) { setPendingSelection(null); return; }
    const range = selection.getRangeAt(0);
    const start = range.commonAncestorContainer;
    const element = start.nodeType === Node.ELEMENT_NODE ? (start as HTMLElement) : start.parentElement;
    const sheet = element?.closest<HTMLElement>("[data-sheet-page]");
    const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 500);
    if (!sheet || !text) { setPendingSelection(null); return; }
    const box = sheet.getBoundingClientRect();
    const pageBox = { left: box.left, top: box.top, width: box.width, height: box.height };
    const rects = mergeLineRects(
      Array.from(range.getClientRects()).map((rect) => normalizeRect(rect, pageBox)).filter((rect): rect is HighlightRect => rect !== null),
    );
    if (!rects.length) { setPendingSelection(null); return; }
    const end = range.getBoundingClientRect();
    setPendingSelection({ page: Number(sheet.dataset.sheetPage), rects, text, x: (end.left + end.right) / 2, y: end.top });
  };
  const highlightSelection = (tone: HighlightTone) => {
    if (!pendingSelection) return;
    const item: Highlight = { id: makeHighlightId(), page: pendingSelection.page, tone, rects: pendingSelection.rects, text: pendingSelection.text, createdAt: Date.now() };
    setHighlights((current) => addHighlight(current, item));
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  const deleteHighlight = (id: string) => {
    setHighlights((current) => removeHighlight(current, id));
    setOpenHighlight((current) => (current?.id === id ? null : current));
  };
  const openHighlightAt = (item: Highlight, event: React.MouseEvent) => {
    setPendingSelection(null);
    setCommentDraft(item.comment || "");
    setOpenHighlight({ id: item.id, x: event.clientX, y: event.clientY });
  };
  const handleSheetClick = (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    const hit = hitTestHighlights({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), highlightsForPage(highlights, pageNumber));
    if (hit) openHighlightAt(hit, event);
  };
  const saveHighlightComment = () => {
    if (!openHighlight) return;
    setHighlights((current) => updateHighlightComment(current, openHighlight.id, commentDraft));
    setOpenHighlight(null);
  };
  const activeOpenHighlight = openHighlight ? findHighlight(highlights, openHighlight.id) : undefined;
  // The reader-sheet scroller re-renders pages as you turn; close any open highlight popover so it
  // never points at a rectangle that scrolled away.
  useEffect(() => { setOpenHighlight(null); }, [page, view]);

  const addNote = () => {
    if (!noteText.trim()) return;
    const updated = [...notes, { page, text: noteText.trim(), author: "أنا", tone: noteTone, createdAt: Date.now() } satisfies Note];
    setNotes(updated);
    doc.notes = updated;
    setNoteText("");
    onNotice("تم حفظ الملاحظة");
  };
  const deleteNote = (at: number) => {
    const updated = notes.filter((_, index) => index !== at);
    setNotes(updated);
    doc.notes = updated;
  };
  const toggleBookmark = () => {
    const updated = bookmarks.includes(page) ? bookmarks.filter((value) => value !== page) : [...bookmarks, page].sort((a, b) => a - b);
    setBookmarks(updated);
    doc.bookmarks = updated;
  };

  const switchView = (target: ViewMode) => {
    if (view === target) return;
    setView(target);
    if (target === "scroll") window.setTimeout(() => scrollToPage(pageRef.current), 50);
  };

  const pageWindowStart = Math.max(1, Math.min(pageCount - 59, page - 30));
  const pageWindow = Array.from({ length: Math.min(pageCount, 60) }, (_, index) => pageWindowStart + index);
  const chapter = [...doc.toc].reverse().find((item) => item.page <= page)?.title;

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void printDoc();
        return;
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowSearch(true);
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (event.key === "Escape") {
        if (passwordOpen) return;
        if (showTonePanel) setShowTonePanel(false);
        else if (showSearch) setShowSearch(false);
        else if (panelOpen) setPanelOpen(false);
        else onClose();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft" || event.key === "PageDown") { event.preventDefault(); turn(1); }
      if (event.key === "ArrowRight" || event.key === "PageUp") { event.preventDefault(); turn(-1); }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(zoomRef.current * 1.25); }
      if (event.key === "-") { event.preventDefault(); zoomAt(zoomRef.current / 1.25); }
      if (mod && event.key === "0") { event.preventDefault(); zoomAt(1); }
      if (!mod && event.key.toLowerCase() === "w") fitWidth();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [turn, zoomAt, fitWidth, onClose, showTonePanel, showSearch, panelOpen, passwordOpen, printDoc]);

  return <div className="alif-reader relative flex min-h-0 flex-1 flex-col bg-paper-2">
    <header className="reader-masthead flex min-h-[42px] shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1">
      <button onClick={onClose} title="العودة إلى المكتبة" aria-label="العودة إلى المكتبة" className="reader-icon reader-back-btn shrink-0">
        <ArrowRight className="h-[17px] w-[17px]" strokeWidth={1.8} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 dir="auto" className="truncate text-[12.5px] font-medium text-ink" title={doc.file}>{doc.file}</h1>
        {isFile && proxy && isScanned && <span className="reader-file-subtitle text-[10px] text-ink-3">بلا نص قابل للنسخ</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-s border-line ps-2">
        <button onClick={() => setShowTonePanel(true)} title="لون الصفحات" aria-label="لون الصفحات" className="reader-icon">
          <Palette className="h-[16px] w-[16px]" strokeWidth={1.7} />
        </button>
        <button onClick={() => setShowSearch((current) => !current)} title="بحث داخل المستند (Ctrl+F)" aria-label="بحث داخل المستند" aria-pressed={showSearch} className={cn("reader-icon", showSearch && "reader-icon-active")}>
          <Search className="h-[16px] w-[16px]" strokeWidth={1.8} />
        </button>
        <button onClick={() => void printDoc()} disabled={printing || !proxy} title="طباعة (Ctrl+P)" aria-label="طباعة المستند" className="reader-icon">
          {printing ? <LoaderCircle className="h-[16px] w-[16px] animate-spin" /> : <Printer className="h-[16px] w-[16px]" strokeWidth={1.7} />}
        </button>
        <button onClick={toggleBookmark} title={isBookmarked ? "إزالة العلامة المرجعية" : "إضافة علامة مرجعية"} aria-label={isBookmarked ? "إزالة العلامة المرجعية" : "إضافة علامة مرجعية"} aria-pressed={isBookmarked} className={cn("reader-icon", isBookmarked && "reader-icon-active")}>
          {isBookmarked ? <BookmarkCheck className="h-[17px] w-[17px]" /> : <Bookmark className="h-[17px] w-[17px]" strokeWidth={1.7} />}
        </button>
        <button onClick={() => setPanelOpen((current) => !current)} title="الصفحات والفهرس والملاحظات" aria-label="لوحة الصفحات والفهرس والملاحظات" aria-expanded={panelOpen} className={cn("reader-icon", panelOpen && "reader-icon-active")}>
          <LayoutPanelLeft className="h-[17px] w-[17px]" strokeWidth={1.7} />
        </button>
      </div>
    </header>

    {/* One compact instrument strip: page, magnification, reading mode, paper. */}
    <div className="reader-controlbar scroll-cab flex min-h-[38px] shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3">
      <div className="flex shrink-0 items-center gap-0.5" aria-label="التنقل بين الصفحات">
        <button onClick={() => turn(-1)} disabled={page <= 1} title="الصفحة السابقة" aria-label="الصفحة السابقة" className="reader-tool-icon"><ChevronRight className="h-4 w-4" /></button>
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={page} onChange={(e) => jumpTo(Number(e.target.value.replace(/\D/g, "")) || 1)} aria-label="رقم الصفحة" className="tnum w-9 border-b border-line bg-transparent px-0 text-center text-[12px] font-semibold text-brown outline-none focus:border-amber" />
        <span className="tnum px-0.5 text-[11px] text-ink-3">/ {pageCount}</span>
        <button onClick={() => turn(1)} disabled={page >= pageCount} title="الصفحة التالية" aria-label="الصفحة التالية" className="reader-tool-icon"><ChevronLeft className="h-4 w-4" /></button>
      </div>
      <span className="h-5 w-px shrink-0 bg-line" />
      <div className="flex shrink-0 items-center gap-0.5" aria-label="التكبير والتصغير">
        <button onClick={() => zoomAt(zoomRef.current / 1.25)} disabled={zoom <= MIN_ZOOM + .001} title="تصغير" aria-label="تصغير" className="reader-tool-icon"><ZoomOut className="h-4 w-4" /></button>
        <select value="" onChange={(e) => { if (e.target.value === "fit") fitWidth(); else zoomAt(Number(e.target.value)); }} aria-label="مستوى التكبير" className="tnum w-[56px] cursor-pointer appearance-none bg-transparent text-center text-[11.5px] font-semibold text-brown outline-none">
          <option value="" hidden>{Math.round(zoom * 100)}%</option>
          <option value="fit">ملء العرض</option>
          {[.5, .75, 1, 1.5, 2, 3, 4, 6, 8, 10].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
        </select>
        <button onClick={() => zoomAt(zoomRef.current * 1.25)} disabled={zoom >= MAX_ZOOM - .001} title="تكبير" aria-label="تكبير" className="reader-tool-icon"><ZoomIn className="h-4 w-4" /></button>
        <button onClick={fitWidth} title="ملء عرض النافذة (W)" aria-label="ملء عرض النافذة" className="reader-tool-icon"><Maximize2 className="h-[14px] w-[14px]" /></button>
        <button onClick={() => zoomAt(6)} title="تدقيق الصفحة 600%" aria-label="تكبير حتى 600%" className="reader-tool-icon reader-focus-zoom"><ScanSearch className="h-4 w-4" /></button>
      </div>
      <span className="h-5 w-px shrink-0 bg-line" />
      <div className="flex shrink-0 items-center gap-0.5" aria-label="طريقة العرض">
        <button onClick={() => switchView("book")} aria-label="عرض صفحة واحدة" title="وضع الكتاب" aria-pressed={view === "book"} className={cn("reader-tool-icon", view === "book" && "reader-mode-active")}><BookOpen className="h-4 w-4" strokeWidth={1.7} /></button>
        <button onClick={() => switchView("scroll")} aria-label="عرض متواصل" title="تمرير متواصل" aria-pressed={view === "scroll"} className={cn("reader-tool-icon", view === "scroll" && "reader-mode-active")}><ScrollText className="h-4 w-4" strokeWidth={1.7} /></button>
      </div>
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <button onClick={() => setHandMode((current) => !current)} aria-label="أداة اليد لتحريك الصفحة" title="أداة اليد لتحريك الصفحة" aria-pressed={handMode} className={cn("reader-tool-icon reader-hand-tool", handMode && "reader-mode-active")}><Hand className="h-4 w-4" strokeWidth={1.7} /></button>
      </div>
    </div>

    {showSearch && <div className="reader-findbar flex shrink-0 items-center gap-2 border-b border-line bg-panel px-4 py-2">
      <Search className="h-4 w-4 shrink-0 text-amber" strokeWidth={1.7} />
      <input ref={searchRef} type="search" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") nextHit(e.shiftKey ? -1 : 1); }} placeholder="ابحث في نص المستند..." aria-label="بحث داخل المستند" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3" />
      {term && <span className="tnum shrink-0 text-[11px] text-ink-3">{hitIndex < 0 ? 0 : hitIndex + 1} / {hits.length}</span>}
      <button onClick={() => nextHit(-1)} disabled={!hits.length} title="المطابقة السابقة" aria-label="المطابقة السابقة" className="reader-tool-icon"><ChevronRight className="h-4 w-4" /></button>
      <button onClick={() => nextHit(1)} disabled={!hits.length} title="المطابقة التالية" aria-label="المطابقة التالية" className="reader-tool-icon"><ChevronLeft className="h-4 w-4" /></button>
      <button onClick={() => { setShowSearch(false); setTerm(""); }} title="إغلاق البحث" aria-label="إغلاق البحث" className="reader-tool-icon"><X className="h-4 w-4" /></button>
    </div>}

    {pendingSelection && <div role="toolbar" aria-label="تظليل النص المحدد" onMouseDown={(e) => e.preventDefault()} className="fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-[6px] border border-line bg-panel px-2 py-1.5 shadow-md" style={{ left: pendingSelection.x, top: Math.max(8, pendingSelection.y - 46) }}>
      <span className="ps-1 text-[10.5px] text-ink-3">تظليل</span>
      {HIGHLIGHT_TONES.map((tone) => <button key={tone} onClick={() => highlightSelection(tone)} aria-label={`تظليل ${HIGHLIGHT_LABELS[tone]}`} title={`تظليل ${HIGHLIGHT_LABELS[tone]}`} className="h-[17px] w-[17px] rounded-full border border-line" style={{ backgroundColor: HIGHLIGHT_SWATCH[tone] }} />)}
      <button onClick={() => setPendingSelection(null)} aria-label="إلغاء التظليل" className="reader-tool-icon h-6 w-6"><X className="h-3 w-3" /></button>
    </div>}
    {openHighlight && activeOpenHighlight && <div role="dialog" aria-label="التظليل" onMouseDown={(e) => e.preventDefault()} className="fixed z-50 w-[240px] -translate-x-1/2 rounded-[6px] border border-line bg-panel p-2.5 shadow-md" style={{ left: openHighlight.x, top: Math.max(8, openHighlight.y - 10) }}>
      <p className="mb-2 line-clamp-2 border-s-2 ps-2 text-[11px] leading-[1.6] text-ink-2" style={{ borderColor: HIGHLIGHT_SWATCH[activeOpenHighlight.tone] }}>{activeOpenHighlight.text}</p>
      <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveHighlightComment(); }} placeholder="أضف تعليقاً على هذا التظليل..." aria-label="تعليق على التظليل" className="min-h-[56px] w-full resize-y rounded-[4px] border border-line bg-paper-2/50 p-2 text-[11px] leading-relaxed text-ink outline-none focus:border-amber" />
      <div className="mt-2 flex items-center justify-between">
        <button onClick={() => deleteHighlight(openHighlight.id)} aria-label="حذف التظليل" className="reader-tool-icon h-7 w-7 text-brick"><Trash2 className="h-3.5 w-3.5" /></button>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOpenHighlight(null)} className="px-2 py-1 text-[11px] text-ink-3">إغلاق</button>
          <button onClick={saveHighlightComment} className="rounded-[4px] bg-brown px-2.5 py-1 text-[11px] font-semibold text-paper">حفظ</button>
        </div>
      </div>
    </div>}
    <div className="reader-body relative flex min-h-0 flex-1">
      <div className="reader-stage relative min-w-0 flex-1">
        <div ref={scrollRef} dir="ltr" onDoubleClick={(e) => { if (zoomRef.current >= 2.5) fitWidth(); else zoomAt(5, e.clientX, e.clientY); }} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onMouseUp={captureSelection} className={cn("desk scroll-cab absolute inset-0 overflow-auto overscroll-contain", dragging ? "cursor-grabbing select-none" : handMode ? "cursor-grab select-none" : "cursor-default")} style={{ touchAction: "pan-x pan-y" }}>
          {view === "scroll" ? <div className="reader-track flex min-h-full flex-col items-center gap-11" style={{ padding: `${PAD_Y}px ${PAD_X}px`, width: `max(100%, ${BASE_W * zoom + PAD_X * 2}px)`, boxSizing: "border-box" }}>
            {Array.from({ length: pageCount }, (_, index) => <ContinuousPage key={index + 1} proxy={proxy} doc={doc} number={index + 1} width={BASE_W * zoom} zoom={zoom} renderZoom={renderZoom} term={term} style={pageStyle} viewport={scrollRef} active={page === index + 1} highlights={highlights} onHighlightClick={openHighlightAt} />)}
          </div> : <div className="reader-track flex min-h-full items-start justify-center" style={{ padding: `${PAD_Y}px ${PAD_X}px`, width: `max(100%, ${BASE_W * zoom + PAD_X * 2}px)`, boxSizing: "border-box" }}>
            <div key={page} data-sheet-page={page} dir="rtl" onClick={(e) => handleSheetClick(e, page)} className="reader-sheet reader-sheet-enter relative shrink-0" style={{ width: BASE_W * zoom, height: (proxy ? BASE_W * aspect : BASE_H) * zoom, backgroundColor: pageStyle.bg, borderColor: pageStyle.border }}>
              {isFile ? <>
                <canvas ref={canvasRef} className="block h-full w-full" style={{ filter: pageStyle.filter }} />
                <HighlightLayer items={highlightsForPage(highlights, page)} />
                <div ref={textLayerRef} className="textLayer absolute inset-0 select-text" />
                {!proxy && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center" style={{ backgroundColor: pageStyle.bg, color: pageStyle.subText }}>
                  {loadError ? <>
                    <FileText className="h-7 w-7" strokeWidth={1.4} />
                    <p className="max-w-[26ch] px-3 text-[12px]">{loadError}</p>
                    <button onClick={() => setRetryRead((current) => current + 1)} className="border-b border-amber text-[12px] font-semibold text-brown">إعادة المحاولة</button>
                  </> : <><LoaderCircle className="h-6 w-6 animate-spin" strokeWidth={1.5} /><span className="text-[12px]">جارٍ فتح المستند...</span></>}
                </div>}
              </> : <div style={{ width: BASE_W, height: BASE_H, zoom } as React.CSSProperties}><SamplePage doc={doc} page={page} term={term} style={pageStyle} /></div>}
            </div>
          </div>}
        </div>
      </div>

      {panelOpen && <>
        <button onClick={() => setPanelOpen(false)} aria-label="إغلاق لوحة القراءة" className="reader-inspector-backdrop absolute inset-0 z-10 hidden bg-ink/35" />
        <aside className="reader-inspector relative z-20 flex w-[230px] shrink-0 flex-col border-s border-line bg-panel">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
            <span className="text-[12px] font-medium text-ink">لوحة القراءة</span>
            <button onClick={() => setPanelOpen(false)} aria-label="إغلاق اللوحة" className="reader-tool-icon"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid shrink-0 grid-cols-4 border-b border-line" role="tablist" aria-label="أقسام لوحة القراءة">
            {([
              ["thumbs", "الصفحات"], ["outline", "الفهرس"],
              ["notes", "ملاحظات"], ["bookmarks", "علامات"],
            ] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={panelTab === id} onClick={() => setPanelTab(id)} className={cn("border-b px-1 py-2.5 text-[10.5px] transition-colors", panelTab === id ? "border-ink-3 text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
              {label}
            </button>)}
          </div>
          <div className="scroll-cab min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {panelTab === "thumbs" && <>
              <p className="mb-2 text-[10.5px] text-ink-3">الانتقال إلى صفحة</p>
              <div className="space-y-0.5">
                {pageWindow.map((number) => <button key={number} onClick={() => jumpTo(number)} className={cn("group flex w-full items-center gap-3 border-s-2 px-2 py-2 text-start transition-colors", page === number ? "border-amber bg-amber-soft/35 text-brown" : "border-transparent text-ink-2 hover:border-line-2 hover:bg-paper-2")}>
                  <span className="tnum w-7 shrink-0 text-[12px] font-semibold">{number}</span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px]">صفحة {number}</span>
                  {bookmarks.includes(number) && <Bookmark className="h-3 w-3 text-amber" />}
                </button>)}
              </div>
              {pageCount > 60 && <p className="mt-3 border-t border-line pt-2 text-[10px] text-ink-3">لصفحة أخرى، اكتب رقمها في شريط القارئ.</p>}
            </>}
            {panelTab === "outline" && (doc.toc.length ? <div className="space-y-0.5">
              {doc.toc.map((item, index) => <button key={`${item.page}-${index}`} onClick={() => jumpTo(item.page)} className={cn("flex w-full items-start gap-2 border-s-2 px-2 py-2 text-start text-[11px] leading-relaxed transition-colors", chapter === item.title ? "border-amber bg-amber-soft/35 text-brown" : "border-transparent text-ink-2 hover:bg-paper-2")}>
                <span className="min-w-0 flex-1">{item.title}</span><span className="tnum shrink-0 text-ink-3">{item.page}</span>
              </button>)}
            </div> : <p className="py-7 text-center text-[11.5px] leading-relaxed text-ink-3">لا يوجد فهرس متاح لهذا المستند.</p>)}
            {panelTab === "notes" && <div>
              <label htmlFor="reader-note" className="mb-2 block text-[11px] font-semibold text-brown">ملاحظة على الصفحة {page}</label>
              <textarea id="reader-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addNote(); }} placeholder="اكتب ملاحظتك هنا..." className="min-h-[86px] w-full resize-y rounded-[4px] border border-line bg-paper-2/50 p-2.5 text-[11.5px] leading-relaxed text-ink outline-none focus:border-amber" />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5" aria-label="لون الملاحظة">
                  {(["amber", "brick", "moss"] as const).map((tone) => <button key={tone} onClick={() => setNoteTone(tone)} aria-label={`لون ${tone}`} aria-pressed={noteTone === tone} className={cn("h-[15px] w-[15px] rounded-full border-2 border-panel", noteTone === tone && "outline outline-1 outline-brown")} style={{ backgroundColor: tone === "amber" ? "#e0a33c" : tone === "brick" ? "#a4402c" : "#4f7a4a" }} />)}
                </div>
                <button onClick={addNote} disabled={!noteText.trim()} className="inline-flex items-center gap-1 rounded-[4px] bg-brown px-2.5 py-1.5 text-[11px] font-semibold text-paper disabled:opacity-40"><Plus className="h-3 w-3" />حفظ</button>
              </div>
              <div className="mt-5 border-t border-line pt-3">
                <p className="mb-2 text-[10.5px] text-ink-3">ملاحظات المستند ({notes.length})</p>
                {notes.length ? notes.map((note, index) => <div key={`${note.page}-${note.createdAt ?? index}`} className="border-b border-line/70 py-2.5 last:border-0">
                  <div className="mb-1 flex items-center justify-between">
                    <button onClick={() => jumpTo(note.page)} className="tnum text-[10.5px] font-semibold text-brown hover:underline">صفحة {note.page}</button>
                    <button onClick={() => deleteNote(index)} aria-label="حذف الملاحظة" className="reader-tool-icon h-6 w-6 text-brick"><Trash2 className="h-3 w-3" /></button>
                  </div>
                  <p className="border-s-2 ps-2 text-[11px] leading-[1.7] text-ink-2" style={{ borderColor: note.tone === "brick" ? "#a4402c" : note.tone === "moss" ? "#4f7a4a" : "#e0a33c" }}>{note.text}</p>
                </div>) : <p className="py-3 text-[11px] text-ink-3">لا توجد ملاحظات بعد.</p>}
              </div>
            </div>}
            {panelTab === "notes" && <div className="mt-5 border-t border-line pt-3">
              <p className="mb-2 text-[10.5px] text-ink-3">التظليلات ({highlights.length})</p>
              {highlights.length ? highlights.map((item) => <div key={item.id} className="flex items-start gap-2 border-b border-line/70 py-2.5 last:border-0">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: HIGHLIGHT_COLORS[item.tone] }} />
                <div className="min-w-0 flex-1">
                  <button onClick={() => jumpTo(item.page)} className="tnum text-[10.5px] font-semibold text-brown hover:underline">صفحة {item.page}</button>
                  <p className="mt-0.5 line-clamp-3 text-[11px] leading-[1.7] text-ink-2">{item.text}</p>
                  {item.comment && <p className="mt-1 line-clamp-2 border-s-2 border-line ps-1.5 text-[10.5px] leading-[1.6] text-ink-3">{item.comment}</p>}
                </div>
                <button onClick={() => deleteHighlight(item.id)} aria-label="حذف التظليل" className="reader-tool-icon h-6 w-6 text-brick"><Trash2 className="h-3 w-3" /></button>
              </div>) : <p className="py-3 text-[11px] text-ink-3">حدّد نصاً في الصفحة ثم اختر لوناً للتظليل.</p>}
            </div>}
            {panelTab === "bookmarks" && <>
              <p className="mb-2 text-[10.5px] text-ink-3">الصفحات المحفوظة ({bookmarks.length})</p>
              {bookmarks.length ? bookmarks.map((number) => <div key={number} className="flex items-center gap-1 border-b border-line/70 last:border-0">
                <button onClick={() => jumpTo(number)} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-start text-[11.5px] text-brown"><BookmarkCheck className="h-3.5 w-3.5 text-amber" />صفحة {number}</button>
                <button onClick={() => { const updated = bookmarks.filter((value) => value !== number); setBookmarks(updated); doc.bookmarks = updated; }} aria-label={`إزالة علامة صفحة ${number}`} className="reader-tool-icon h-6 w-6"><X className="h-3 w-3" /></button>
              </div>) : <p className="py-7 text-center text-[11.5px] leading-relaxed text-ink-3">لم تحفظ أي صفحة بعد. اضغط أيقونة العلامة أعلى القارئ لإضافتها.</p>}
            </>}
          </div>
        </aside>
      </>}
    </div>

    <footer className="reader-footer relative flex min-h-[29px] shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-3 text-[10.5px] text-ink-3">
      <input type="range" min="1" max={Math.max(1, pageCount)} value={Math.min(page, pageCount)} onChange={(e) => jumpTo(Number(e.target.value))} aria-label="الانتقال إلى صفحة" className="reader-progress absolute inset-x-0 top-0 w-full cursor-pointer" style={{ background: "var(--color-line)" }} />
      <span className="tnum shrink-0 font-semibold text-brown">صفحة {page} من {pageCount}</span>
      <span className="reader-footer-center min-w-0 truncate text-[10.5px] text-ink-3">{chapter ?? (view === "scroll" ? "التمرير المتواصل" : "عرض الكتاب")}</span>
      <span className="tnum shrink-0 text-ink-3">{progress}%</span>
    </footer>

    {createPortal(<PageTonePanel open={showTonePanel} tone={pageTone} onChange={(tone) => { setPageTone(tone); savePageTone(tone); }} onClose={() => setShowTonePanel(false)} />, document.body)}
    {createPortal(<PasswordDialog isOpen={passwordOpen} isRetry={passwordRetry} fileName={doc.file} onSubmit={(password) => { setPasswordOpen(false); passwordResolver.current?.(password); passwordResolver.current = null; }} onCancel={() => { setPasswordOpen(false); passwordResolver.current?.(null); passwordResolver.current = null; onClose(); }} />, document.body)}
  </div>;
}
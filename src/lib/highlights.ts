// Text highlights on PDF pages. Rectangles are stored as fractions of the page box
// (0..1), so a highlight keeps its place when the zoom level or window size changes.

export type HighlightTone = "amber" | "moss" | "brick";

export type HighlightRect = { x: number; y: number; w: number; h: number };

export type Highlight = {
  id: string;
  page: number;
  tone: HighlightTone;
  rects: HighlightRect[];
  text: string;
  createdAt: number;
  /** An optional note attached to the highlighted passage, separate from the page-level notes. */
  comment?: string;
};

export const HIGHLIGHT_TONES: HighlightTone[] = ["amber", "moss", "brick"];

const MAX_RECTS_PER_HIGHLIGHT = 400;
const MAX_TEXT_LENGTH = 500;
const MAX_HIGHLIGHTS_PER_DOC = 5000;

export type Box = { left: number; top: number; width: number; height: number };

/** Converts a client-space rectangle into fractions of the page box. Returns null when it is empty or off the page. */
export function normalizeRect(rect: Box, page: Box): HighlightRect | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const left = Math.max(rect.left, page.left);
  const top = Math.max(rect.top, page.top);
  const right = Math.min(rect.left + rect.width, page.left + page.width);
  const bottom = Math.min(rect.top + rect.height, page.top + page.height);
  if (right - left < 1 || bottom - top < 1) return null;
  const x = (left - page.left) / page.width;
  const y = (top - page.top) / page.height;
  const w = (right - left) / page.width;
  const h = (bottom - top) / page.height;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Merges rectangles that sit on the same text line, so one selection does not leave dozens of slivers. */
export function mergeLineRects(rects: HighlightRect[]): HighlightRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: HighlightRect[] = [];
  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    const sameLine = last && Math.abs(last.y - rect.y) < Math.min(last.h, rect.h) * 0.5 && Math.abs(last.h - rect.h) < Math.max(last.h, rect.h) * 0.3;
    if (sameLine && rect.x <= last.x + last.w + 0.02) {
      const right = Math.max(last.x + last.w, rect.x + rect.w);
      const bottom = Math.max(last.y + last.h, rect.y + rect.h);
      last.y = Math.min(last.y, rect.y);
      last.x = Math.min(last.x, rect.x);
      last.w = right - last.x;
      last.h = bottom - last.y;
    } else {
      merged.push({ ...rect });
    }
  }
  return merged.slice(0, MAX_RECTS_PER_HIGHLIGHT);
}

export function highlightsForPage(highlights: Highlight[], page: number): Highlight[] {
  return highlights.filter((item) => item.page === page);
}

export function addHighlight(list: Highlight[], item: Highlight): Highlight[] {
  const next = [...list, item];
  return next.length > MAX_HIGHLIGHTS_PER_DOC ? next.slice(next.length - MAX_HIGHLIGHTS_PER_DOC) : next;
}

export function removeHighlight(list: Highlight[], id: string): Highlight[] {
  return list.filter((item) => item.id !== id);
}

/** Sets or clears the comment on one highlight. An empty/whitespace-only comment is stored as undefined. */
export function updateHighlightComment(list: Highlight[], id: string, comment: string): Highlight[] {
  const trimmed = comment.trim().slice(0, MAX_TEXT_LENGTH);
  return list.map((item) => (item.id === id ? { ...item, comment: trimmed || undefined } : item));
}

export function findHighlight(list: Highlight[], id: string): Highlight | undefined {
  return list.find((item) => item.id === id);
}

/** Finds the highlight (if any) under a client-space point, given the page's on-screen box.
 *  Used to let a reader click a highlighted line directly, since the rectangles that draw the highlight sit
 *  under the text layer and cannot reliably receive their own clicks. */
export function hitTestHighlights(point: { x: number; y: number }, page: Box, items: Highlight[]): Highlight | undefined {
  if (page.width <= 0 || page.height <= 0) return undefined;
  const fx = (point.x - page.left) / page.width;
  const fy = (point.y - page.top) / page.height;
  for (const item of items) {
    for (const rect of item.rects) {
      if (fx >= rect.x && fx <= rect.x + rect.w && fy >= rect.y && fy <= rect.y + rect.h) return item;
    }
  }
  return undefined;
}

export function makeHighlightId(now = Date.now(), random = Math.random): string {
  return `h${now.toString(36)}${Math.floor(random() * 1e6).toString(36)}`;
}

/** Keeps only well-formed highlights from storage. Anything malformed is dropped rather than rendered. */
export function sanitizeHighlights(raw: unknown): Highlight[] {
  if (!Array.isArray(raw)) return [];
  const out: Highlight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const page = candidate.page;
    if (typeof candidate.id !== "string" || !candidate.id) continue;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) continue;
    if (!HIGHLIGHT_TONES.includes(candidate.tone as HighlightTone)) continue;
    if (!Array.isArray(candidate.rects)) continue;
    const rects = candidate.rects.filter(isValidRect).slice(0, MAX_RECTS_PER_HIGHLIGHT);
    if (!rects.length) continue;
    out.push({
      id: candidate.id,
      page,
      tone: candidate.tone as HighlightTone,
      rects,
      text: typeof candidate.text === "string" ? candidate.text.slice(0, MAX_TEXT_LENGTH) : "",
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
      comment: typeof candidate.comment === "string" && candidate.comment.trim() ? candidate.comment.trim().slice(0, MAX_TEXT_LENGTH) : undefined,
    });
    if (out.length >= MAX_HIGHLIGHTS_PER_DOC) break;
  }
  return out;
}

function isValidRect(value: unknown): value is HighlightRect {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return ok(r.x) && ok(r.y) && ok(r.w) && ok(r.h) && r.x >= -0.01 && r.y >= -0.01 && r.x <= 1.01 && r.y <= 1.01 && r.w > 0 && r.h > 0 && r.w <= 1.01 && r.h <= 1.01;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export const HIGHLIGHT_COLORS: Record<HighlightTone, string> = {
  amber: "rgb(224 163 60 / 0.38)",
  moss: "rgb(79 122 74 / 0.30)",
  brick: "rgb(164 64 44 / 0.26)",
};

export const HIGHLIGHT_SWATCH: Record<HighlightTone, string> = {
  amber: "#e0a33c",
  moss: "#4f7a4a",
  brick: "#a4402c",
};

export const HIGHLIGHT_LABELS: Record<HighlightTone, string> = {
  amber: "كهرماني",
  moss: "أخضر",
  brick: "آجري",
};

import { describe, expect, test } from "vitest";
import {
  addHighlight,
  findHighlight,
  highlightsForPage,
  hitTestHighlights,
  mergeLineRects,
  normalizeRect,
  removeHighlight,
  sanitizeHighlights,
  updateHighlightComment,
  type Highlight,
} from "../src/lib/highlights";

const page = { left: 100, top: 200, width: 500, height: 700 };

function item(id: string, pageNumber: number): Highlight {
  return { id, page: pageNumber, tone: "amber", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.03 }], text: "نص", createdAt: 1 };
}

describe("normalizeRect", () => {
  test("converts a client rectangle into page fractions", () => {
    expect(normalizeRect({ left: 350, top: 550, width: 100, height: 70 }, page)).toEqual({ x: 0.5, y: 0.5, w: 0.2, h: 0.1 });
  });

  test("clips rectangles that extend past the page edge", () => {
    const r = normalizeRect({ left: 550, top: 200, width: 100, height: 50 }, page);
    expect(r?.x).toBe(0.9);
    expect(r?.w).toBe(0.1);
  });

  test("returns null for rectangles entirely off the page or empty", () => {
    expect(normalizeRect({ left: 0, top: 0, width: 50, height: 50 }, page)).toBeNull();
    expect(normalizeRect({ left: 200, top: 300, width: 0, height: 10 }, page)).toBeNull();
    expect(normalizeRect({ left: 200, top: 300, width: 10, height: 10 }, { ...page, width: 0 })).toBeNull();
  });
});

describe("mergeLineRects", () => {
  test("joins adjacent word boxes on the same line into one rectangle", () => {
    const merged = mergeLineRects([
      { x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
      { x: 0.21, y: 0.2, w: 0.1, h: 0.02 },
      { x: 0.32, y: 0.2, w: 0.05, h: 0.02 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBeCloseTo(0.1);
    expect(merged[0].w).toBeCloseTo(0.27);
  });

  test("keeps separate lines apart", () => {
    const merged = mergeLineRects([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.02 },
      { x: 0.1, y: 0.25, w: 0.3, h: 0.02 },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("highlight list updates", () => {
  test("filters by page, adds and removes by id", () => {
    let list: Highlight[] = [];
    list = addHighlight(list, item("a", 1));
    list = addHighlight(list, item("b", 2));
    expect(highlightsForPage(list, 1).map((h) => h.id)).toEqual(["a"]);
    expect(removeHighlight(list, "a").map((h) => h.id)).toEqual(["b"]);
    expect(list).toHaveLength(2);
  });
});

describe("highlight comments", () => {
  test("sets a comment on the matching highlight and leaves others untouched", () => {
    let list = [item("a", 1), item("b", 1)];
    list = updateHighlightComment(list, "a", "  راجع هذا لاحقاً  ");
    expect(findHighlight(list, "a")?.comment).toBe("راجع هذا لاحقاً");
    expect(findHighlight(list, "b")?.comment).toBeUndefined();
  });

  test("clears the comment when given blank text", () => {
    let list = [{ ...item("a", 1), comment: "قديم" }];
    list = updateHighlightComment(list, "a", "   ");
    expect(findHighlight(list, "a")?.comment).toBeUndefined();
  });

  test("truncates an overly long comment", () => {
    const list = updateHighlightComment([item("a", 1)], "a", "س".repeat(900));
    expect(findHighlight(list, "a")?.comment).toHaveLength(500);
  });

  test("updating a missing id leaves the list unchanged", () => {
    const list = [item("a", 1)];
    expect(updateHighlightComment(list, "missing", "x")).toEqual(list);
  });
});

describe("hitTestHighlights", () => {
  const items: Highlight[] = [
    { id: "a", page: 1, tone: "amber", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }], text: "a", createdAt: 1 },
    { id: "b", page: 1, tone: "moss", rects: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], text: "b", createdAt: 2 },
  ];

  test("finds the highlight whose rectangle contains the point", () => {
    const hit = hitTestHighlights({ x: page.left + page.width * 0.15, y: page.top + page.height * 0.12 }, page, items);
    expect(hit?.id).toBe("a");
  });

  test("returns undefined when the point lands outside every rectangle", () => {
    expect(hitTestHighlights({ x: page.left + page.width * 0.9, y: page.top + page.height * 0.9 }, page, items)).toBeUndefined();
  });

  test("returns undefined for a degenerate page box", () => {
    expect(hitTestHighlights({ x: 10, y: 10 }, { ...page, width: 0 }, items)).toBeUndefined();
  });
});

describe("sanitizeHighlights", () => {
  test("keeps valid entries and drops malformed ones", () => {
    const raw = [
      item("ok", 3),
      { id: "", page: 1, tone: "amber", rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
      { id: "badpage", page: 0, tone: "amber", rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
      { id: "badtone", page: 1, tone: "purple", rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
      { id: "nanrect", page: 1, tone: "moss", rects: [{ x: NaN, y: 0, w: 0.1, h: 0.1 }] },
      { id: "norects", page: 1, tone: "moss", rects: [] },
      null,
      "text",
    ];
    expect(sanitizeHighlights(raw).map((h) => h.id)).toEqual(["ok"]);
  });

  test("returns an empty list for non-array storage values", () => {
    expect(sanitizeHighlights(undefined)).toEqual([]);
    expect(sanitizeHighlights({ id: "x" })).toEqual([]);
  });

  test("truncates overly long text", () => {
    const [clean] = sanitizeHighlights([{ ...item("long", 1), text: "س".repeat(900) }]);
    expect(clean.text).toHaveLength(500);
  });

  test("carries a comment through, trimmed, and drops a blank one", () => {
    const [withComment, withoutComment] = sanitizeHighlights([
      { ...item("c1", 1), comment: "  مهم  " },
      { ...item("c2", 1), comment: "   " },
    ]);
    expect(withComment.comment).toBe("مهم");
    expect(withoutComment.comment).toBeUndefined();
  });
});

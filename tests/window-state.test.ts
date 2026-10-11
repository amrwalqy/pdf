import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseWindowState, isVisibleOnSomeDisplay } = require("../electron/window-state.cjs");

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondaryRight = { x: 1920, y: 0, width: 1920, height: 1040 };

describe("window state restore", () => {
  it("accepts a window that is on screen and rounds its size", () => {
    const raw = JSON.stringify({ x: 100.4, y: 80, width: 1200.6, height: 800, maximized: false });
    expect(parseWindowState(raw, [primary])).toEqual({ x: 100, y: 80, width: 1201, height: 800, maximized: false });
  });

  it("keeps the maximized flag", () => {
    const raw = JSON.stringify({ x: 0, y: 0, width: 1280, height: 720, maximized: true });
    expect(parseWindowState(raw, [primary])?.maximized).toBe(true);
  });

  it("ignores a window saved on a monitor that is no longer connected", () => {
    const raw = JSON.stringify({ x: 3000, y: 100, width: 1200, height: 800 });
    expect(parseWindowState(raw, [primary])).toBeNull();
    expect(parseWindowState(raw, [primary, secondaryRight])).not.toBeNull();
  });

  it("rejects malformed, incomplete or too small data", () => {
    expect(parseWindowState("not json", [primary])).toBeNull();
    expect(parseWindowState("null", [primary])).toBeNull();
    expect(parseWindowState(JSON.stringify({ x: 0, y: 0, width: 1200 }), [primary])).toBeNull();
    expect(parseWindowState(JSON.stringify({ x: 0, y: 0, width: 150, height: 800 }), [primary])).toBeNull();
    expect(parseWindowState(JSON.stringify({ x: "0", y: 0, width: 1200, height: 800 }), [primary])).toBeNull();
  });

  it("requires at least 120px of overlap with a display", () => {
    const sizes = { width: 1200, height: 800, y: 0 };
    expect(isVisibleOnSomeDisplay({ x: -1100, ...sizes }, [primary])).toBe(false); // 100px visible
    expect(isVisibleOnSomeDisplay({ x: -900, ...sizes }, [primary])).toBe(true); // 300px visible
    expect(isVisibleOnSomeDisplay({ x: 0, ...sizes }, [])).toBe(false);
  });
});

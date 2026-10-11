import { describe, it, expect } from "vitest";
import { LruCache } from "../src/lib/lru";

describe("LruCache", () => {
  it("evicts the least recently used entry first and reports it", () => {
    const evicted: Array<[string, number]> = [];
    const cache = new LruCache<string, number>(2, (value, key) => evicted.push([key, value]));
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "a" is now the most recent
    cache.set("c", 3); // pushes out "b"
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(evicted).toEqual([["b", 2]]);
  });

  it("replaces a value without evicting anything when the key already exists", () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, string>(2, (_value, key) => evicted.push(key));
    cache.set("a", "first");
    cache.set("b", "x");
    cache.set("a", "second");
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe("second");
    expect(evicted).toEqual([]);
  });

  it("keeps size within the limit when many pages are visited", () => {
    let released = 0;
    const cache = new LruCache<number, object>(48, () => released++);
    for (let page = 1; page <= 500; page++) cache.set(page, {});
    expect(cache.size).toBe(48);
    expect(released).toBe(452);
    expect(cache.has(500)).toBe(true);
    expect(cache.has(1)).toBe(false);
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => new LruCache<string, number>(0)).toThrow(RangeError);
    expect(() => new LruCache<string, number>(1.5)).toThrow(RangeError);
  });
});

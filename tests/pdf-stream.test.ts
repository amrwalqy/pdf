import { describe, it, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toAlifFileUrl, fromAlifFileUrl, parseByteRange } = require("../electron/pdf-stream.cjs");

describe("streaming PDF addresses", () => {
  it("round-trips a path with Arabic characters and spaces", () => {
    const file = "/home/reader/كتب/كتاب مهم 1.pdf";
    const url = toAlifFileUrl(file);
    expect(url.startsWith("alif-file://local/")).toBe(true);
    expect(fromAlifFileUrl(url)).toBe(path.resolve(file));
  });

  it("refuses other schemes and malformed addresses", () => {
    expect(fromAlifFileUrl("https://example.org/x")).toBeNull();
    expect(fromAlifFileUrl("alif-file://local/")).toBeNull();
    expect(fromAlifFileUrl("not a url")).toBeNull();
  });
});

describe("byte ranges", () => {
  const total = 26;

  it("serves an exact range", () => {
    expect(parseByteRange("bytes=0-7", total)).toEqual({ start: 0, end: 7 });
  });

  it("shortens a range that runs past the end, as HTTP requires", () => {
    expect(parseByteRange("bytes=0-65535", total)).toEqual({ start: 0, end: 25 });
  });

  it("serves an open-ended range and the suffix form", () => {
    expect(parseByteRange("bytes=10-", total)).toEqual({ start: 10, end: 25 });
    expect(parseByteRange("bytes=-5", total)).toEqual({ start: 21, end: 25 });
    expect(parseByteRange("bytes=-100", total)).toEqual({ start: 0, end: 25 });
  });

  it("refuses ranges that cannot be served", () => {
    expect(parseByteRange("bytes=30-40", total)).toBeNull();
    expect(parseByteRange("bytes=5-3", total)).toBeNull();
    expect(parseByteRange("bytes=-0", total)).toBeNull();
    expect(parseByteRange("items=0-1", total)).toBeNull();
    expect(parseByteRange("bytes=0-1", 0)).toBeNull();
  });
});

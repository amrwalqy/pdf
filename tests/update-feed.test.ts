import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveFeedUrl, readAppUpdateUrl, isPlaceholderHost } = require("../electron/update-feed.cjs");

describe("update feed rules", () => {
  it("treats an empty or missing address as not configured", () => {
    for (const value of [undefined, "", "   "]) {
      const feed = resolveFeedUrl(value as string | undefined);
      expect(feed.configured).toBe(false);
      expect(feed.reason).toContain("لم يُضبط");
    }
  });

  it("accepts a real https release location and removes the trailing slash", () => {
    expect(resolveFeedUrl("https://downloads.alifreader.app/releases/")).toEqual({
      url: "https://downloads.alifreader.app/releases",
      configured: true,
      reason: null,
    });
  });

  it("keeps placeholder addresses switched off", () => {
    expect(resolveFeedUrl("https://updates.alif.local/releases/").configured).toBe(false);
    expect(resolveFeedUrl("https://updates.example.com/releases/").configured).toBe(false);
    expect(isPlaceholderHost("updates.alif.local")).toBe(true);
  });

  it("requires https, except for a local testing server", () => {
    expect(resolveFeedUrl("http://downloads.alifreader.app/releases").configured).toBe(false);
    expect(resolveFeedUrl("http://localhost:8080/releases").configured).toBe(true);
  });

  it("reads the feed written into a packaged build", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alif-feed-"));
    try {
      fs.writeFileSync(path.join(dir, "app-update.yml"), 'provider: generic\nurl: "https://downloads.alifreader.app/releases/"\n');
      expect(readAppUpdateUrl(dir)).toBe("https://downloads.alifreader.app/releases/");
      expect(readAppUpdateUrl(path.join(dir, "missing"))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

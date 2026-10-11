// End-to-end tests: start the real Electron app and drive it through Playwright.
// Run after `npm run desktop:build`. On Linux, run under a virtual display: xvfb-run -a npm run test:e2e
// Set ALIF_E2E_EXECUTABLE to a packaged Alif executable to test the installed build instead.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { _electron as electron } from "playwright-core";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(projectRoot, "e2e", "artifacts");
const packagedExecutable = process.env.ALIF_E2E_EXECUTABLE || "";
const electronBinary = packagedExecutable || require("electron");
// Chromium needs these when the Linux runner is root or has no user namespaces. Windows does not use them.
const linuxFlags = process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : [];

const state = { userData: "", files: "", pdfA: "", pdfB: "", closed: false };
const problems = [];
let app;
let win;

function launchArgs(extra = []) {
  const appPath = packagedExecutable ? [] : [projectRoot];
  return [...appPath, `--user-data-dir=${state.userData}`, ...linuxFlags, ...extra];
}

async function writeSamplePdf(file, label, pageCount) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pageCount; page++) {
    const sheet = doc.addPage([420, 595]);
    sheet.drawText(`${label} - page ${page}`, { x: 40, y: 520, size: 26, font });
  }
  fs.writeFileSync(file, await doc.save());
}

const hasRenderedPage = () =>
  Array.from(document.querySelectorAll("canvas")).some((canvas) => canvas.width > 100 && canvas.height > 100);

before(async () => {
  if (!packagedExecutable && !fs.existsSync(path.join(projectRoot, "dist", "index.html"))) {
    throw new Error("dist/ is missing. Run `npm run desktop:build` before the end-to-end tests.");
  }
  state.userData = fs.mkdtempSync(path.join(os.tmpdir(), "alif-e2e-data-"));
  state.files = fs.mkdtempSync(path.join(os.tmpdir(), "alif-e2e-files-"));
  state.pdfA = path.join(state.files, "Manuscript-A.pdf");
  state.pdfB = path.join(state.files, "Manuscript-B.pdf");
  await writeSamplePdf(state.pdfA, "Manuscript A", 3);
  await writeSamplePdf(state.pdfB, "Manuscript B", 2);
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The first PDF is passed on the command line, the same way Windows passes a double-clicked file.
  app = await electron.launch({ executablePath: electronBinary, args: launchArgs([state.pdfA]), timeout: 120_000 });
  win = await app.firstWindow({ timeout: 120_000 });
  win.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  win.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await win.waitForLoadState("domcontentloaded");
});

after(async () => {
  if (app && !state.closed) await app.close().catch(() => {});
  for (const dir of [state.userData, state.files]) fs.rmSync(dir, { recursive: true, force: true });
});

test("starts as an Arabic, right-to-left desktop window", async () => {
  assert.equal(await win.evaluate(() => document.documentElement.lang), "ar");
  assert.equal(await win.evaluate(() => document.documentElement.dir), "rtl");
  assert.equal(await win.evaluate(() => window.electronAPI?.isDesktop === true), true);
});

test("the built page allows its one boot script by hash, not all inline scripts", () => {
  const html = fs.readFileSync(path.join(projectRoot, "dist", "index.html"), "utf8");
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
  const scriptSrc = /script-src([^;]+)/.exec(csp)?.[1] ?? "";
  assert.doesNotMatch(scriptSrc, /unsafe-inline/);
  const bootScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(bootScript, "boot script not found in dist/index.html");
  const digest = createHash("sha256").update(bootScript, "utf8").digest("base64");
  assert.ok(scriptSrc.includes(`'sha256-${digest}'`), "CSP hash does not match the boot script");
});

test("opens the PDF that was handed over at launch and renders its pages", async () => {
  await win.getByText("Manuscript-A", { exact: false }).first().waitFor({ timeout: 60_000 });
  const rendered = await win
    .waitForFunction(hasRenderedPage, null, { timeout: 10_000 })
    .then(() => true, () => false);
  if (!rendered) {
    await win.getByText("Manuscript-A", { exact: false }).first().click();
    await win.waitForFunction(hasRenderedPage, null, { timeout: 60_000 });
  }
  await win.screenshot({ path: path.join(artifactsDir, "reader.png") });
});

test("the text of an open PDF reaches the text layer, so it can be selected and searched", async () => {
  await win.waitForFunction(
    () => Array.from(document.querySelectorAll(".textLayer")).some((layer) => (layer.textContent || "").includes("Manuscript")),
    null,
    { timeout: 60_000 },
  );
});

test("selecting text on a page can be highlighted, and the highlight is saved with the document", async () => {
  // Select the first words of the rendered page, the way a reader drags across a line.
  await win.waitForFunction(
    () => Array.from(document.querySelectorAll(".textLayer span")).some((span) => (span.textContent || "").trim().length > 3),
    null,
    { timeout: 60_000 },
  );
  await win.evaluate(async () => {
    // The text layer can be mid-redraw right after the readiness check above; retry briefly rather than
    // risk selecting a stale/removed span.
    let span = null;
    for (let attempt = 0; attempt < 20 && !span; attempt++) {
      span = Array.from(document.querySelectorAll(".textLayer span")).find((item) => (item.textContent || "").trim().length > 3) || null;
      if (!span) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!span) throw new Error("no text layer span with selectable text was found");
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector(".reader-stage .desk")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await win.getByRole("toolbar", { name: "تظليل النص المحدد" }).waitFor({ timeout: 10_000 });
  await win.getByRole("button", { name: "تظليل كهرماني" }).click();

  const highlightCount = () => win.evaluate(() => document.querySelectorAll("[data-sheet-page] .rounded-\\[2px\\]").length);
  assert.ok((await highlightCount()) > 0, "no highlight was drawn on the page");

  // The highlight is written to the document's metadata store, which is what the next open reads back.
  await win.waitForTimeout(1200);
  const saved = await win.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("alif-db");
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const tx = request.result.transaction("meta", "readonly");
      const all = tx.objectStore("meta").getAll();
      all.onsuccess = () => {
        const count = all.result.reduce((sum, record) => sum + (Array.isArray(record.highlights) ? record.highlights.length : 0), 0);
        request.result.close();
        resolve(count);
      };
      all.onerror = () => resolve(0);
    };
  }));
  assert.ok(saved > 0, "the highlight was not saved with the document");
});

test("clicking a saved highlight opens a popover to add a comment or delete it", async () => {
  // The highlight rectangle sits under the text layer and cannot receive its own clicks (by design, so text
  // stays selectable), so click at its coordinates directly rather than through the element itself.
  const clickHighlight = async () => {
    // Scroll it fully into view first: a page taller than the window can leave the highlight's true
    // position outside the visible, clipped area of the scroll container, even though it exists in the DOM.
    const center = await win.evaluate(() => {
      const span = document.querySelector("[data-sheet-page] .rounded-\\[2px\\]");
      span.scrollIntoView({ block: "center", inline: "center" });
      const box = span.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await win.mouse.click(center.x, center.y);
  };
  await clickHighlight();
  await win.getByRole("dialog", { name: "التظليل" }).waitFor({ timeout: 10_000 });

  const comment = "تحتاج مراجعة لاحقاً";
  await win.getByLabel("تعليق على التظليل").fill(comment);
  await win.getByRole("button", { name: "حفظ" }).click();
  await win.getByRole("dialog", { name: "التظليل" }).waitFor({ state: "hidden", timeout: 10_000 });

  // The comment is merged into the same highlight record, not a new one.
  await win.waitForTimeout(1200);
  const afterSave = await win.evaluate((text) => new Promise((resolve) => {
    const request = indexedDB.open("alif-db");
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const all = request.result.transaction("meta", "readonly").objectStore("meta").getAll();
      all.onsuccess = () => {
        const highlights = all.result.flatMap((record) => (Array.isArray(record.highlights) ? record.highlights : []));
        request.result.close();
        resolve({ count: highlights.length, hasComment: highlights.some((item) => item.comment === text) });
      };
      all.onerror = () => resolve(null);
    };
  }), comment);
  assert.equal(afterSave?.count, 1, "the comment should attach to the existing highlight, not add a new one");
  assert.ok(afterSave?.hasComment, "the saved comment text does not match what was typed");

  // Re-open it and delete it from the popover.
  await clickHighlight();
  await win.getByRole("dialog", { name: "التظليل" }).waitFor({ timeout: 10_000 });
  await win.getByLabel("حذف التظليل").click();
  await win.waitForTimeout(1200);
  const afterDelete = await win.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("alif-db");
    request.onerror = () => resolve(-1);
    request.onsuccess = () => {
      const all = request.result.transaction("meta", "readonly").objectStore("meta").getAll();
      all.onsuccess = () => {
        const count = all.result.reduce((sum, record) => sum + (Array.isArray(record.highlights) ? record.highlights.length : 0), 0);
        request.result.close();
        resolve(count);
      };
      all.onerror = () => resolve(-1);
    };
  }));
  assert.equal(afterDelete, 0, "the highlight was not removed from storage after deleting it");
});

test("refuses camera, microphone, location and notification permissions", async () => {
  const states = await win.evaluate(async () => {
    const names = ["camera", "microphone", "geolocation", "notifications"];
    const result = {};
    for (const name of names) {
      try {
        result[name] = (await navigator.permissions.query({ name })).state;
      } catch (error) {
        result[name] = error.name;
      }
    }
    return result;
  });
  for (const [name, value] of Object.entries(states)) {
    assert.equal(value, "denied", `${name} should be denied, got ${value}`);
  }
});

test("secure vault works end to end: create, lock, refuse a wrong password, unlock, store a PDF", async () => {
  assert.deepEqual(await win.evaluate(() => window.electronAPI.vaultStatus()), { created: false, unlocked: false });
  assert.deepEqual(
    await win.evaluate(() => window.electronAPI.vaultCreate("Strong-Pass-2026")),
    { created: true, unlocked: true },
  );
  await win.evaluate(() => window.electronAPI.vaultLock());
  await assert.rejects(
    win.evaluate(() => window.electronAPI.vaultUnlock("wrong-pass-123")),
    /كلمة المرور غير صحيحة/,
  );
  await win.evaluate(() => window.electronAPI.vaultUnlock("Strong-Pass-2026"));
  const stored = await win.evaluate((file) => window.electronAPI.vaultAdd(file), state.pdfA);
  assert.equal(stored.name, "Manuscript-A.pdf");
  const listed = await win.evaluate(() => window.electronAPI.vaultList());
  assert.ok(listed.some((item) => item.name === "Manuscript-A.pdf"));
  await win.evaluate(() => window.electronAPI.vaultLock());
});

test("the vault password can be changed, and the old one stops working", async () => {
  await win.evaluate(() => window.electronAPI.vaultUnlock("Strong-Pass-2026"));
  await win.evaluate(() => window.electronAPI.vaultChangePassword("Strong-Pass-2026", "Fresh-Pass-2027"));
  await win.evaluate(() => window.electronAPI.vaultLock());
  await assert.rejects(win.evaluate(() => window.electronAPI.vaultUnlock("Strong-Pass-2026")), /كلمة المرور غير صحيحة/);
  await win.evaluate(() => window.electronAPI.vaultUnlock("Fresh-Pass-2027"));
  const listed = await win.evaluate(() => window.electronAPI.vaultList());
  assert.ok(listed.some((item) => item.name === "Manuscript-A.pdf"));
  await win.evaluate(() => window.electronAPI.vaultLock());
});

test("a second launch hands its PDF to the running window and exits", async () => {
  const child = spawn(electronBinary, launchArgs([state.pdfB]), { stdio: "ignore" });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the second instance did not exit"));
    }, 90_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0);
  // Each PDF from a second launch opens in its own window; the first window keeps its document.
  const deadline = Date.now() + 60_000;
  let opened = null;
  while (!opened && Date.now() < deadline) {
    for (const candidate of app.windows()) {
      if (candidate === win || candidate.isClosed()) continue;
      const found = await candidate.getByText("Manuscript-B", { exact: false }).first().count().catch(() => 0);
      if (found > 0) { opened = candidate; break; }
    }
    if (!opened) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(opened, "the second launch did not open Manuscript-B in a window");
  await opened.close().catch(() => {});
});

test("the diagnostics log folder can be requested from the renderer", async () => {
  const result = await win.evaluate(() => window.electronAPI.openLogs());
  assert.match(result.path, /logs$/);
});

test("the window reported no runtime errors", () => {
  assert.deepEqual(problems, []);
});

test("the update channel stays off without a configured feed", async () => {
  const status = await win.evaluate(() => window.electronAPI.updateStatus());
  assert.equal(status.configured, false);
  if (!packagedExecutable) assert.equal(status.supported, false);
  const checked = await win.evaluate(() => window.electronAPI.updateCheck());
  assert.equal(checked.checking, false);
  assert.equal(checked.available, false);
});

test("closing the app remembers the window size for the next start", async () => {
  state.closed = true;
  await app.close();
  const saved = JSON.parse(fs.readFileSync(path.join(state.userData, "window-state.json"), "utf8"));
  assert.ok(saved.width >= 200 && saved.height >= 140, `unexpected saved size: ${JSON.stringify(saved)}`);
});

describe("library sync with a large folder", () => {
  const library = { userData: "", folder: "", app: null, win: null, launchedAt: 0 };
  const footerOf = () => library.win.locator("footer.library-bottom-note");

  before(async () => {
    library.userData = fs.mkdtempSync(path.join(os.tmpdir(), "alif-e2e-library-data-"));
    library.folder = fs.mkdtempSync(path.join(os.tmpdir(), "alif-e2e-library-"));
    // shelf-00 holds 1,200 PDFs and 39 more shelves hold 100 each: 5,100 files in all. Plus one PDF nine folders deep.
    const shelves = [{ name: "shelf-00", count: 1200 }];
    for (let shelf = 1; shelf <= 39; shelf++) shelves.push({ name: `shelf-${String(shelf).padStart(2, "0")}`, count: 100 });
    for (const shelf of shelves) {
      const dir = path.join(library.folder, shelf.name);
      fs.mkdirSync(dir);
      for (let book = 0; book < shelf.count; book++) {
        fs.writeFileSync(path.join(dir, `book-${book}.pdf`), "%PDF-1.4 library sync test");
      }
    }
    const deepDir = path.join(library.folder, "archive", "2026", "scans", "box-7", "vol-3", "section-a", "chapter-1", "appendix", "deep-level");
    fs.mkdirSync(deepDir, { recursive: true });
    await writeSamplePdf(path.join(deepDir, "needle-deep.pdf"), "Deep archive", 2);
    library.launchedAt = Date.now();
    library.app = await electron.launch({
      executablePath: electronBinary,
      args: [...(packagedExecutable ? [] : [projectRoot]), `--user-data-dir=${library.userData}`, `--library=${library.folder}`, ...linuxFlags],
      timeout: 120_000,
    });
    library.win = await library.app.firstWindow({ timeout: 120_000 });
    await library.win.waitForLoadState("domcontentloaded");
  });

  after(async () => {
    await library.app?.close().catch(() => {});
    for (const dir of [library.userData, library.folder]) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("indexes the whole folder quickly, and counts every file, with no indexing limit", async () => {
    // "مجلد المكتبة" opens the library root; "المكتبة" on its own opens the home view.
    await library.win.locator("button", { hasText: /^مجلد المكتبة$/ }).first().click();
    await library.win.getByText("5101 ملفات PDF", { exact: false }).first().waitFor({ timeout: 60_000 });
    const seconds = (Date.now() - library.launchedAt) / 1000;
    assert.ok(seconds < 45, `library sync took ${seconds.toFixed(1)}s`);
    assert.equal(await footerOf().getByText("بلغت المكتبة حد الفهرسة", { exact: false }).count(), 0);
  });

  test("renders only the rows on screen, even in a folder with many files", async () => {
    await library.win.locator(".folder-row", { hasText: "shelf-00" }).first().click();
    const countText = await footerOf().locator(".tnum").innerText({ timeout: 10_000 });
    const files = Number.parseInt(countText, 10);
    assert.ok(files >= 300, `expected a folder with at least 300 files, footer shows "${countText}"`);
    const rendered = await library.win.locator(".file-row").count();
    assert.ok(rendered > 0 && rendered < 200, `expected a small window of rows, found ${rendered} of ${files}`);
  });

  test("finds a PDF nine folders deep, and opens it from disk", async () => {
    await library.win.getByPlaceholder("ابحث في مكتبة المستندات...").fill("needle-deep");
    await library.win.locator(".file-row", { hasText: "needle-deep.pdf" }).first().click({ timeout: 60_000 });
    await library.win.waitForFunction(hasRenderedPage, null, { timeout: 60_000 });
  });

  test("streams a library PDF in byte ranges, and refuses a file outside the library", async () => {
    const deep = path.join(library.folder, "archive", "2026", "scans", "box-7", "vol-3", "section-a", "chapter-1", "appendix", "deep-level", "needle-deep.pdf");
    const part = await library.win.evaluate(async (file) => {
      const { url } = await window.electronAPI.fileUrl(file);
      const response = await fetch(url, { headers: { Range: "bytes=0-7" } });
      return { status: response.status, range: response.headers.get("Content-Range"), head: await response.text() };
    }, deep);
    assert.equal(part.status, 206);
    assert.match(part.range, /^bytes 0-7\/\d+$/);
    assert.ok(part.head.startsWith("%PDF-"), `unexpected bytes: ${part.head}`);
    const outcome = await library.win.evaluate(async () => {
      try {
        await window.electronAPI.fileUrl("/etc/hosts");
        return "allowed";
      } catch {
        return "refused";
      }
    });
    assert.equal(outcome, "refused");
  });

  test("says clearly when a PDF is damaged, instead of a generic failure", async () => {
    // The preceding virtualization test opens shelf-00; reset the browsing scope before searching globally.
    const rootButton = library.win.locator("button", { hasText: /^مجلد المكتبة$/ }).first();
    if (await rootButton.count()) await rootButton.click();
    await library.win.getByPlaceholder("ابحث في مكتبة المستندات...").fill("book-1");
    const damagedRow = library.win.locator(".file-row", { hasText: "book-1.pdf" }).first();
    await damagedRow.waitFor({ state: "attached", timeout: 60_000 });
    await damagedRow.scrollIntoViewIfNeeded();
    await damagedRow.click({ timeout: 60_000 });
    await library.win.getByText("الملف تالف أو ليس بصيغة PDF صالحة.", { exact: false }).first().waitFor({ timeout: 60_000 });
  });

  test("picks up files removed from the folder without a restart", async () => {
    // The library sidebar is hidden while a document is open, so return to the library first.
    const back = library.win.getByRole("button", { name: "العودة إلى المكتبة" });
    if (await back.count()) await back.first().click();
    // 200 removed files bring the library to 4,901, and the total must follow.
    for (let book = 0; book < 200; book++) {
      fs.rmSync(path.join(library.folder, "shelf-00", `book-${book}.pdf`), { force: true });
    }
    await library.win.getByText("4901 ملفات PDF", { exact: false }).first().waitFor({ timeout: 60_000 });
  });
});

describe("PDF tools run off the interface thread", () => {
  const tools = { userData: "", folder: "", app: null, win: null };

  before(async () => {
    tools.userData = fs.mkdtempSync(path.join(os.tmpdir(), "alif-e2e-tools-data-"));
    tools.folder = fs.mkdtempSync(path.join(os.tmpdir(), "alif-e2e-tools-"));
    // Both documents sit in one library folder, so the merge tool sees them in the same window.
    await writeSamplePdf(path.join(tools.folder, "Big-A.pdf"), "Big A", 400);
    await writeSamplePdf(path.join(tools.folder, "Big-B.pdf"), "Big B", 400);
    tools.app = await electron.launch({
      executablePath: electronBinary,
      args: [...(packagedExecutable ? [] : [projectRoot]), `--user-data-dir=${tools.userData}`, `--library=${tools.folder}`, ...linuxFlags],
      timeout: 120_000,
    });
    tools.win = await tools.app.firstWindow({ timeout: 120_000 });
    await tools.win.waitForLoadState("domcontentloaded");
    // Capture the merged file instead of opening the native save dialog.
    await tools.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("alif:save-file");
      ipcMain.handle("alif:save-file", (_event, payload) => {
        globalThis.__alifSavedPdf = Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength).toString("base64");
        return { canceled: true };
      });
    });
  });

  after(async () => {
    await tools.app?.close().catch(() => {});
    for (const dir of [tools.userData, tools.folder]) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("merging two 400-page documents keeps the window responsive and produces the merged file", async () => {
    const win = tools.win;
    // Record the longest gap between painted frames: a frozen interface shows up as a long gap.
    await win.evaluate(() => {
      window.__worstFrameGapMs = 0;
      let last = performance.now();
      const tick = (now) => {
        window.__worstFrameGapMs = Math.max(window.__worstFrameGapMs, now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await win.locator("button.sidebar-link", { hasText: "دمج عدة ملفات" }).click();
    // Wait until both documents are in the merge list (they open after the window appears).
    await win.waitForFunction(() => document.querySelectorAll('[aria-label="نقل للأسفل"], [aria-label="نقل للأعلى"]').length >= 2, null, { timeout: 60_000 });
    await win.getByRole("button", { name: "تنفيذ وحفظ" }).click();

    const deadline = Date.now() + 120_000;
    let saved = null;
    while (!saved && Date.now() < deadline) {
      saved = await tools.app.evaluate(() => globalThis.__alifSavedPdf || null);
      if (!saved) await win.waitForTimeout(200);
    }
    assert.ok(saved, "the merge did not finish in time");

    const merged = await PDFDocument.load(Buffer.from(saved, "base64"));
    assert.equal(merged.getPageCount(), 800);
    const worstGap = await win.evaluate(() => window.__worstFrameGapMs);
    assert.ok(worstGap < 500, `the interface stopped repainting for ${Math.round(worstGap)} ms during the merge`);
    console.log(`    worst frame gap during merge: ${Math.round(worstGap)} ms`);
  });
});

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const builderConfig = read("electron-builder.yml");

describe("project layout and packaging configuration", () => {
  it("has no leftover duplicate snapshot folder", () => {
    expect(fs.existsSync(path.join(root, "merged"))).toBe(false);
  });

  it("uses one product name, so the dev run and the installed app share the same data folder", () => {
    expect(pkg.productName).toBe("Alif");
    expect(builderConfig).toMatch(/^productName: Alif$/m);
  });

  it("ships the Windows icon that electron-builder points to", () => {
    expect(builderConfig).toContain("icon: build/icon.ico");
    expect(fs.existsSync(path.join(root, "build", "icon.ico"))).toBe(true);
    expect(fs.existsSync(path.join(root, "build", "icon.png"))).toBe(true);
  });

  it("defines the scripts the launchers, the README and CI rely on", () => {
    for (const name of ["typecheck", "test", "test:e2e", "check", "desktop:build", "desktop:start", "dist:win"]) {
      expect(pkg.scripts[name], `missing script ${name}`).toBeTruthy();
    }
  });

  it("builds the desktop interface in multi-file mode, not the single-file browser build", () => {
    expect(pkg.scripts["desktop:build"]).toContain("--mode electron");
  });

  it("allows the desktop window to shrink to the ultra-micro reader layout", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("minWidth: 120");
    expect(main).toContain("minHeight: 80");
    expect(read("src/index.css")).toContain("@media (max-width: 220px)");
  });

  it("keeps PDF renaming responsive and accessible", () => {
    const main = read("electron/main.cjs");
    const dialog = read("src/components/RenameDialog.tsx");
    expect(main).toContain("await fsp.access(plan.newPath");
    expect(main).toContain("plan.caseOnly");
    expect(main).not.toContain("fs.existsSync(plan.newPath)");
    expect(dialog).toContain("aria-invalid");
    expect(dialog).toContain("لا يجوز أن ينتهي الاسم بنقطة أو مسافة");
  });

  it("keeps the release documents and CI workflow in place", () => {
    for (const file of ["README.md", "CHANGELOG.md", "SECURITY.md", ".gitignore", ".gitattributes", ".github/workflows/windows.yml"]) {
      expect(fs.existsSync(path.join(root, file)), `missing ${file}`).toBe(true);
    }
  });

  it("states the same version in package.json and the newest changelog entry", () => {
    const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read("CHANGELOG.md"));
    expect(newest?.[1]).toBe(pkg.version);
  });

  it("documents the release-critical 1.2.0 behavior", () => {
    const changelog = read("CHANGELOG.md");
    for (const phrase of ["12 حرفاً", "120×80", "إعادة تسمية آمنة", "THIRD-PARTY-NOTICES.md", "Alif PDF Reader — أليف"]) {
      expect(changelog).toContain(phrase);
    }
  });

  it("ships and exposes the third-party license notice in desktop builds", () => {
    expect(fs.existsSync(path.join(root, "THIRD-PARTY-NOTICES.md"))).toBe(true);
    expect(builderConfig).toContain("- THIRD-PARTY-NOTICES.md");
    expect(read("electron/preload.cjs")).toContain("openThirdPartyNotices");
    expect(read("electron/main.cjs")).toContain("alif:open-third-party-notices");
  });
});

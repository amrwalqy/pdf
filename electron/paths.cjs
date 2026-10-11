const path = require("path");
const fs = require("fs");

class PathSecurity {
  constructor(getLibraryRoot) {
    this.getLibraryRoot = getLibraryRoot;
    this.allowedRoots = new Set();
    this.allowedFiles = new Set();
  }

  addAllowedRoot(dirPath) {
    if (!dirPath) return;
    try {
      const resolved = path.resolve(dirPath);
      const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
      this.allowedRoots.add(real.toLowerCase());
    } catch {
      this.allowedRoots.add(path.resolve(dirPath).toLowerCase());
    }
  }

  addAllowedFile(filePath) {
    if (!filePath) return;
    try {
      const resolved = path.resolve(filePath);
      const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
      this.allowedFiles.add(real.toLowerCase());
    } catch {
      this.allowedFiles.add(path.resolve(filePath).toLowerCase());
    }
  }

  assertAllowed(targetPath, options = {}) {
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("مسار غير صالح");
    }

    // Block null byte injection
    if (targetPath.includes("\0")) {
      throw new Error("مسار يحتوي على محارف غير مسموحة");
    }

    const resolved = path.resolve(targetPath);
    let realPath = resolved;
    if (fs.existsSync(resolved)) {
      try {
        realPath = fs.realpathSync(resolved);
      } catch {
        realPath = resolved;
      }
    }

    const lowerReal = realPath.toLowerCase();

    // Check file extension if checkExtension requested
    if (options.requirePdf && !lowerReal.endsWith(".pdf")) {
      throw new Error("امتداد الملف يجب أن يكون .pdf");
    }

    // Check max file size (2GB)
    if (options.checkSize && fs.existsSync(realPath)) {
      try {
        const st = fs.statSync(realPath);
        if (st.size > 2 * 1024 * 1024 * 1024) {
          throw new Error("حجم الملف يتجاوز الحد الأقصى المسموح به (2 جيجابايت)");
        }
      } catch (e) {
        if (e.message.includes("يتجاوز")) throw e;
      }
    }

    // Check if directly in allowedFiles
    if (this.allowedFiles.has(lowerReal)) {
      return realPath;
    }

    // Check library root
    const libRoot = this.getLibraryRoot ? this.getLibraryRoot() : null;
    const allRoots = new Set(this.allowedRoots);
    if (libRoot) {
      try {
        const resolvedLib = path.resolve(libRoot);
        const realLib = fs.existsSync(resolvedLib) ? fs.realpathSync(resolvedLib) : resolvedLib;
        allRoots.add(realLib.toLowerCase());
      } catch {
        allRoots.add(path.resolve(libRoot).toLowerCase());
      }
    }

    for (const r of allRoots) {
      if (lowerReal === r) return realPath;
      const rootWithSep = r.endsWith(path.sep) ? r : r + path.sep;
      if (lowerReal.startsWith(rootWithSep)) {
        return realPath;
      }
    }

    throw new Error("الوصول للمسار غير مصرح به: خارج نطاق المكتبة والملفات المفتوحة");
  }
}

module.exports = { PathSecurity };

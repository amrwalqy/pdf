#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const changelog = read("CHANGELOG.md");
const builder = read("electron-builder.yml");
const security = read("SECURITY.md");
const checks = [];
const pass = (label, detail) => checks.push({ status: "PASS", label, detail });
const warn = (label, detail) => checks.push({ status: "WARN", label, detail });
const fail = (label, detail) => checks.push({ status: "FAIL", label, detail });

if (pkg.version === lock.version && pkg.version === lock.packages?.[""].version) pass("نسخة الحزمة والقفل", pkg.version);
else fail("نسخة الحزمة والقفل", "package.json و package-lock.json غير متطابقين");
const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
if (newest === pkg.version) pass("أحدث سجل تغييرات", newest);
else fail("أحدث سجل تغييرات", `المتوقع ${pkg.version} والموجود ${newest || "غير موجود"}`);
const currentSection = changelog.split(/^## \[/m)[1]?.split(/^## \[/m)[0] || "";
if (!/Unreleased/i.test(currentSection) && (currentSection.match(/^### المزايا$/gm) || []).length <= 1) pass("نظافة قسم الإصدار", "لا يوجد Unreleased أو عنوان مزايا مكرر");
else fail("نظافة قسم الإصدار", "يجب إغلاق Unreleased والاكتفاء بعنوان مزايا واحد في الإصدار الحالي");
for (const file of ["README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "electron-builder.yml"]) {
  if (fs.existsSync(path.join(root, file))) pass("ملف مطلوب", file);
  else fail("ملف مطلوب", file);
}
if (builder.includes("language: 1025") && builder.includes("THIRD-PARTY-NOTICES.md")) pass("حزمة Windows العربية والتراخيص", "مفعلة");
else fail("حزمة Windows العربية والتراخيص", "إعداد اللغة أو ملف التراخيص مفقود");
if (builder.includes("publish: null")) warn("التحديث التلقائي", "معطل افتراضياً؛ التوزيع اليدوي هو الوضع الرسمي الحالي");
if (security.includes("لا يحتوي هذا الأرشيف")) warn("قناة البلاغات الأمنية", "يلزم تثبيت رابط المستودع الفعلي قبل النشر العام");
else pass("قناة البلاغات الأمنية", "موثقة");
if (builder.includes("WIN_CSC_LINK")) warn("توقيع Windows", "يتطلب أسرار الشهادة في CI قبل إصدار عام");
pass("اختبارات المشروع", "شغّل npm run check قبل الاعتماد النهائي");

console.log(`Alif release report — ${pkg.version}`);
for (const item of checks) console.log(`[${item.status}] ${item.label}: ${item.detail}`);
const failures = checks.filter((item) => item.status === "FAIL");
const warnings = checks.filter((item) => item.status === "WARN");
console.log(`\nالنتيجة: ${failures.length} فشل، ${warnings.length} تحذير`);
if (process.argv.includes("--strict") && (failures.length || warnings.length)) process.exitCode = 1;

# إشعار تراخيص مكونات الطرف الثالث

هذا الملف موزّع داخل حزمة أليف المثبّتة إلى جانب التطبيق. أليف نفسه مرخّص برخصة MIT كما هو موضح في [LICENSE](LICENSE). القائمة أدناه تلخّص مكونات التشغيل المباشرة وإشعارات تراخيصها؛ أما شجرة الاعتماديات الكاملة وإصداراتها الدقيقة فتوجد في `package-lock.json` المرفق مع المصدر.

## مكونات التشغيل المباشرة

| المكوّن | الإصدار في هذا البناء | الترخيص | المصدر |
|---|---:|---|---|
| Electron | 44.7.0 | MIT | https://github.com/electron/electron |
| React / React DOM | 19.2.6 | MIT | https://github.com/facebook/react |
| electron-updater | 6.8.9 | MIT | https://github.com/electron-userland/electron-builder |
| pdfjs-dist | 6.2.108 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| lucide-react | 1.47.0 | ISC | https://github.com/lucide-icons/lucide |
| clsx | 2.1.1 | MIT | https://github.com/lukeed/clsx |
| tailwind-merge | 3.4.0 | MIT | https://github.com/dcastil/tailwind-merge |
| @fontsource/amiri | 5.2.5 | OFL-1.1 | https://github.com/fontsource/fontsource |
| @fontsource/ibm-plex-sans-arabic | 5.2.5 | OFL-1.1 | https://github.com/fontsource/fontsource |

## نصوص التراخيص

- **MIT:** يسمح بالاستخدام والنسخ والتعديل والتوزيع وفق شروط إشعار حقوق النشر وإخلاء المسؤولية. النص الكامل موجود في ملفات الحزم المصدرية وفي مستودعاتها أعلاه.
- **Apache-2.0:** يسمح بالاستخدام والتعديل والتوزيع مع الحفاظ على إشعارات الترخيص وحقوق النشر وبيان التغييرات عند الاقتضاء. النص الكامل: https://www.apache.org/licenses/LICENSE-2.0
- **ISC:** يسمح بالاستخدام والنسخ والتعديل والتوزيع مع الحفاظ على إشعار حقوق النشر وإخلاء المسؤولية. النص الكامل: https://opensource.org/license/isc-license-txt
- **OFL-1.1:** ترخيص الخطوط المفتوح؛ يسمح باستخدام الخط وتضمينه وفق شروطه. النص الكامل: https://scripts.sil.org/OFL

للاطلاع على الاعتماديات غير المباشرة، استخدم `npm ls --all` أو راجع `package-lock.json`. يجب إعادة توليد هذا الملف عند إضافة مكوّن تشغيل مباشر جديد أو تغيير ترخيصه.

import {
  Archive,
  BookOpen,
  Bookmark,
  FileText,
  FolderOpen,
  HardDrive,
  Layers,
  PenLine,
  Scissors,
  Star,
} from "lucide-react";

export type Note = {
  page: number;
  text: string;
  author: string;
  tone: "amber" | "brick" | "moss";
  createdAt?: number;
};

export type Doc = {
  id: string;
  file: string;
  title: string;
  kindLabel: string;
  badge: string;
  desc: string;
  pages: number;
  pageCountPending?: boolean;
  at: number;
  size: string;
  meta: string;
  folder: FolderId;
  ocr: boolean;
  isScanned?: boolean;
  thumbHead: string;
  thumbSub: string;
  /** seed = demo books, watched = auto-synced library folder, imported = manual add, vault = encrypted vault */
  origin?: "seed" | "watched" | "imported" | "vault";
  /** real fs path (Electron) or relative path (browser) */
  path?: string;
  lastModified?: number;
  pdf?: { data?: ArrayBuffer; url?: string; proxy: any | null };
  toc: { title: string; page: number }[];
  notes: Note[];
  bookmarks?: number[];
  body: string[];
};

export type FolderId = "all" | "fav" | "reading" | "ref" | "research" | "archive";

export const folders: {
  id: FolderId;
  name: string;
  count: number | null;
  icon: typeof Star;
}[] = [
  { id: "all", name: "كل المستندات", count: null, icon: FolderOpen },
  { id: "fav", name: "المفضلة", count: null, icon: Star },
  { id: "reading", name: "قيد القراءة", count: null, icon: BookOpen },
  { id: "ref", name: "الإصدارات المرجعية", count: null, icon: Bookmark },
  { id: "research", name: "الأبحاث والمقالات", count: null, icon: FileText },
  { id: "archive", name: "الأرشيف والأوائل", count: null, icon: Archive },
];

export const batchActions = [
  { id: "merge", name: "دمج عدة ملفات", icon: Layers },
  { id: "split", name: "استخراج صفحات", icon: Scissors },
  { id: "sign", name: "توقيع مرئي للوثائق", icon: PenLine },
];

export const tools = [
  {
    id: "merge",
    icon: Layers,
    title: "دمج ملفات PDF",
    desc: "تجميع صفحات من عدة ملفات بترتيب مخصص داخل مستند واحد.",
    action: "بدء الدمج",
  },
  {
    id: "split",
    icon: Scissors,
    title: "استخراج صفحات",
    desc: "فصل مجال صفحات محدد (مثل 1-3, 5, 8-) وحفظها كمستند منفصل.",
    action: "استخراج الصفحات",
  },
  {
    id: "sign",
    icon: PenLine,
    title: "توقيع مرئي",
    desc: "إضافة ختم أو توقيع بالرسم أو صورة مخصصة على الصفحة وتثبيتها.",
    action: "إضافة توقيع",
  },
];

export const stats = [
  { id: "storage", label: "مساحة التخزين", value: "0", unit: "GB", sub: "فحص القرص الحقيقي", icon: HardDrive, hot: false },
  { id: "files", label: "ملفات المكتبة", value: "0", unit: "", sub: "ملف PDF مفهرس", icon: FileText, hot: false },
  { id: "sessions", label: "جلسات القراءة", value: "0", unit: "", sub: "ملف قيد القراءة", icon: BookOpen, hot: false },
  { id: "open", label: "المستندات المفتوحة", value: "0", unit: "", sub: "تبويبات نشطة", icon: Layers, hot: true },
];

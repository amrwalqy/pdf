/* Tiny promise wrapper around IndexedDB — no dependencies.
   Stores:
   - kv: preferences
   - handles: directory handles (browser FileSystemAccess)
   - files: imported PDF bytes
   - textindex: extracted text for Arabic library search
   - meta: lastPage, zoom, viewMode, bookmarks, notes */

const DB_NAME = "alif-db";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
      if (!db.objectStoreNames.contains("textindex")) db.createObjectStore("textindex", { keyPath: "path" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out: T;
    try {
      const r = run(s);
      r.onsuccess = () => {
        out = r.result;
      };
      r.onerror = () => reject(r.error);
    } catch (e) {
      db.close();
      reject(e);
      return;
    }
    t.oncomplete = () => {
      db.close();
      resolve(out!);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export const idbSet = (store: string, key: string, val: any) => tx(store, "readwrite", (s) => s.put(val, key));
export const idbPut = (store: string, val: any) => tx(store, "readwrite", (s) => s.put(val));
export const idbGet = <T = any>(store: string, key: string): Promise<T | undefined> =>
  tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbAll = <T = any>(store: string): Promise<T[]> =>
  tx<T[]>(store, "readonly", (s) => s.getAll() as unknown as IDBRequest<T[]>);
export const idbDel = (store: string, key: string) => tx(store, "readwrite", (s) => s.delete(key));

export type PersistedFile = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  data: ArrayBuffer;
  origin: "imported" | "watched";
  path?: string;
  pages?: number;
};

export type DocTextIndex = {
  path: string;
  size: number;
  lastModified: number;
  charCount: number;
  isScanned: boolean;
  sampleText: string;
  pageTexts: string[];
};

export type DocMeta = {
  key: string; // file path or name+size+lastModified
  lastPage?: number;
  zoom?: number;
  viewMode?: "book" | "scroll";
  bookmarks?: number[];
  notes?: Array<{ page: number; text: string; author: string; tone: "amber" | "brick" | "moss"; createdAt?: number }>;
  highlights?: import("./highlights").Highlight[];
};

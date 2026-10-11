/* Library shelves — turns the real folder structure of the chosen library
   folder into a tree:  المكتبة / دواوين / المتنبي / ...
   Works with absolute Windows paths (Electron) and relative paths (browser). */

import type { Doc } from "../data";

export type ShelfNode = {
  /** path relative to the library root, "/"-separated; "" = the root itself */
  path: string;
  name: string;
  children: ShelfNode[];
  /** PDFs directly inside this folder */
  direct: number;
  /** PDFs in this folder and every sub-folder */
  total: number;
  /** number of sub-folders at any depth */
  folders: number;
};

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** Path of a file/folder relative to the library root ("/"-separated). */
export function relPath(full: string | undefined, root: string | null | undefined): string {
  if (!full) return "";
  const f = norm(full);
  if (root) {
    const r = norm(root);
    if (f.toLowerCase() === r.toLowerCase()) return "";
    if (f.toLowerCase().startsWith(r.toLowerCase() + "/")) return f.slice(r.length + 1);
  }
  // browser scans already give paths relative to the root
  return f.replace(/^\/+/, "");
}

/** Folder (relative to root) that contains the given file; "" = root. */
export function relDir(full: string | undefined, root: string | null | undefined): string {
  const r = relPath(full, root);
  const i = r.lastIndexOf("/");
  return i === -1 ? "" : r.slice(0, i);
}

export function shelfName(path: string, rootName: string): string {
  if (!path) return rootName;
  const parts = path.split("/");
  return parts[parts.length - 1];
}

/** Breadcrumb segments for a shelf path, starting with the root. */
export function crumbs(path: string, rootName: string): { path: string; name: string }[] {
  const out = [{ path: "", name: rootName }];
  if (!path) return out;
  const parts = path.split("/");
  parts.forEach((name, i) => out.push({ path: parts.slice(0, i + 1).join("/"), name }));
  return out;
}

export function buildShelfTree(
  docs: Doc[],
  root: string | null | undefined,
  rootName: string,
  dirs: string[],
): { tree: ShelfNode; map: Map<string, ShelfNode> } {
  const tree: ShelfNode = { path: "", name: rootName, children: [], direct: 0, total: 0, folders: 0 };
  const map = new Map<string, ShelfNode>([["", tree]]);

  const ensure = (p: string): ShelfNode => {
    const hit = map.get(p);
    if (hit) return hit;
    const parts = p.split("/");
    const parent = ensure(parts.slice(0, -1).join("/"));
    const node: ShelfNode = { path: p, name: parts[parts.length - 1], children: [], direct: 0, total: 0, folders: 0 };
    parent.children.push(node);
    map.set(p, node);
    return node;
  };

  for (const d of dirs) {
    const rel = relPath(d, root);
    if (rel) ensure(rel);
  }
  for (const doc of docs) ensure(relDir(doc.path, root)).direct++;

  const finish = (n: ShelfNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    n.total = n.direct;
    n.folders = n.children.length;
    for (const c of n.children) {
      finish(c);
      n.total += c.total;
      n.folders += c.folders;
    }
  };
  finish(tree);
  return { tree, map };
}

/** Stable tone per folder name, so each shelf keeps its colour. */
export function shelfTone(name: string): "amber" | "brown" | "moss" | "brick" {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (["amber", "brown", "moss", "brick"] as const)[h % 4];
}

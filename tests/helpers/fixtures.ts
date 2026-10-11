import fs from "node:fs";
import path from "node:path";

/**
 * Creates many files and folders quickly.
 *
 * On Windows, every create call pays a fixed antivirus-scan cost (Windows Defender).
 * Doing 20,000 of them one after another can take minutes, even though the code under test
 * is fast. Running them in parallel overlaps that waiting, so the fixture takes a fraction of the time.
 */
const CONCURRENCY = 64;

export async function runLimited<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

/** Writes a tiny PDF-looking file, creating its folder when needed. */
export async function writePdfAsync(file: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, "%PDF-1.4 test");
}

/** Creates `files` as tiny PDFs, one folder at a time first so parallel mkdir calls never collide. */
export async function writePdfsAsync(files: readonly string[]): Promise<void> {
  const dirs = [...new Set(files.map((f) => path.dirname(f)))];
  await runLimited(dirs, (dir) => fs.promises.mkdir(dir, { recursive: true }).then(() => undefined));
  await runLimited(files, (file) => fs.promises.writeFile(file, "%PDF-1.4 test"));
}

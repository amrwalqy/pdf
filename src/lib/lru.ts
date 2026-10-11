/**
 * Small least-recently-used map. When a new entry pushes the oldest one out, `onEvict` receives it,
 * so the owner can release what that entry holds (for example a PDF page's cached images).
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(
    private readonly limit: number,
    private readonly onEvict?: (value: V, key: K) => void,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("LruCache limit must be a positive integer");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Returns the stored value and marks the entry as most recently used. */
  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value as K;
      const oldestValue = this.entries.get(oldestKey) as V;
      this.entries.delete(oldestKey);
      this.onEvict?.(oldestValue, oldestKey);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

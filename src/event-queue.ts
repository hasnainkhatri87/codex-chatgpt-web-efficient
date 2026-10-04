export interface EventQueueOptions<T> {
  maxBuffered?: number;
  /** Estimated retained bytes, measured by sizeOf. */
  maxBufferedBytes?: number;
  sizeOf?: (value: T) => number;
}

/** A bounded FIFO with amortized O(1) reads and eager reference release. */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private buffered: Array<T | undefined> = [];
  private sizes: number[] = [];
  private head = 0;
  private bytes = 0;
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  private readonly maxBuffered: number;
  private readonly maxBufferedBytes: number;
  private readonly sizeOf: (value: T) => number;

  constructor(options: number | EventQueueOptions<T> = 10_000) {
    const config = typeof options === "number" ? { maxBuffered: options } : options;
    this.maxBuffered = config.maxBuffered ?? 10_000;
    this.maxBufferedBytes = config.maxBufferedBytes ?? Infinity;
    this.sizeOf = config.sizeOf ?? (() => 0);
    if (!Number.isSafeInteger(this.maxBuffered) || this.maxBuffered < 1
      || !(this.maxBufferedBytes > 0)) throw new Error("Invalid event queue limits");
  }

  get bufferedCount(): number { return this.buffered.length - this.head; }
  get bufferedBytes(): number { return this.bytes; }

  push(value: T): void {
    if (this.closed) return;
    const bytes = this.sizeOf(value);
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid event size");
    if (bytes > this.maxBufferedBytes) throw new Error("Adapter event byte budget exceeded");
    const waiter = this.waiters.shift();
    if (waiter) { waiter({ value, done: false }); return; }
    if (this.bufferedCount >= this.maxBuffered || this.bytes + bytes > this.maxBufferedBytes) {
      throw new Error("Adapter event backlog exceeded");
    }
    this.buffered.push(value);
    if (bytes !== 0 || this.sizes.length > 0) this.sizes[this.buffered.length - 1] = bytes;
    this.bytes += bytes;
  }

  /** Replace an unread backlog with a terminal error, never a truncated success. */
  fail(terminal: T): void {
    if (this.closed) return;
    this.clear();
    this.push(terminal);
    this.close();
  }

  private clear(): void {
    this.buffered = [];
    this.sizes = [];
    this.head = 0;
    this.bytes = 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!({ value: undefined, done: true });
  }

  async collect(): Promise<T[]> {
    const values: T[] = [];
    for await (const value of this) values.push(value);
    return values;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.bufferedCount > 0) {
          const value = this.buffered[this.head] as T;
          this.bytes -= this.sizes[this.head] ?? 0;
          this.buffered[this.head++] = undefined;
          if (this.head === this.buffered.length) this.clear();
          else if (this.head >= 1024 && this.head * 2 >= this.buffered.length) {
            this.buffered = this.buffered.slice(this.head);
            if (this.sizes.length > 0) this.sizes = this.sizes.slice(this.head);
            this.head = 0;
          }
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise(resolve => this.waiters.push(resolve));
      },
      return: () => {
        this.clear();
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

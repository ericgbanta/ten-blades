// A write queue for saves: runs one write at a time, in order, without making
// the caller wait. Writes pushed with the same key coalesce: if the last write
// still waiting has that key, the newer one takes its place (rapid suspend
// writes collapse into the latest). Writes with no key always run.

export type SaveOp = () => Promise<void>;

interface Entry {
  key: string | null;
  op: SaveOp;
}

export class SaveQueue {
  private queue: Entry[] = [];
  private running = false;
  private waiters: (() => void)[] = [];

  constructor(private readonly onError: (error: unknown) => void = () => {}) {}

  /** Queue a write. Returns at once; errors go to onError. */
  push(op: SaveOp, key: string | null = null): void {
    // Only the last waiting write can be replaced, so writes still land in the order they were asked for.
    const last = this.queue.length - 1;
    if (key !== null && last >= 0 && this.queue[last]!.key === key) {
      this.queue[last] = { key, op };
      return;
    }
    this.queue.push({ key, op });
    if (!this.running) void this.drain();
  }

  /** Resolves once every queued write has finished. */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async drain(): Promise<void> {
    this.running = true;
    for (let e = this.queue.shift(); e; e = this.queue.shift()) {
      try {
        await e.op();
      } catch (error) {
        this.onError(error);
      }
    }
    this.running = false;
    const done = this.waiters;
    this.waiters = [];
    for (const w of done) w();
  }
}

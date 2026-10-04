import type { Writable } from "node:stream";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface ProcessLineWriter {
  /** True means accepted for delivery, not necessarily flushed to the peer. */
  write(line: string): boolean;
  close(): void;
}

export function createProcessLineWriter(
  stream: Writable,
  onFailure: (error: Error) => void,
  { maxBufferedBytes = 8 * 1024 * 1024 }: { maxBufferedBytes?: number } = {},
): ProcessLineWriter {
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1) {
    throw new Error("Invalid process output byte budget");
  }
  let writable = true;
  let blocked = false;
  let pending: Array<{ frame: string; bytes: number } | undefined> = [];
  let head = 0;
  let pendingBytes = 0;

  const clear = (): void => {
    pending = [];
    head = 0;
    pendingBytes = 0;
    stream.removeListener("drain", drain);
    stream.removeListener("close", onClose);
  };
  const fail = (error: unknown): void => {
    if (!writable) return;
    writable = false;
    clear();
    onFailure(asError(error));
  };
  const send = (frame: string): void => {
    blocked = !stream.write(frame, error => { if (error) fail(error); });
  };
  function drain(): void {
    blocked = false;
    while (writable && !blocked && pending.length > head) {
      const entry = pending[head]!;
      pending[head++] = undefined;
      if (head === pending.length) { pending = []; head = 0; }
      else if (head >= 1024 && head * 2 >= pending.length) {
        pending = pending.slice(head); head = 0;
      }
      pendingBytes -= entry.bytes;
      try { send(entry.frame); } catch (error) { fail(error); }
    }
  }
  function onClose(): void { fail(new Error("Browser helper output closed")); }

  // Keep the error guard after close: failed Windows pipes may emit late errors.
  stream.on("error", fail);
  stream.on("drain", drain);
  stream.on("close", onClose);

  return {
    write(line: string): boolean {
      if (!writable || stream.destroyed || stream.writableEnded) return false;
      const frame = `${line}\n`;
      const bytes = Buffer.byteLength(frame);
      if (pending.length - head >= 10_000 || bytes + pendingBytes + stream.writableLength > maxBufferedBytes) {
        fail(new Error("Browser helper output backlog exceeded byte budget or frame limit"));
        return false;
      }
      try {
        if (blocked) { pending.push({ frame, bytes }); pendingBytes += bytes; }
        else send(frame);
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    close(): void { writable = false; clear(); },
  };
}

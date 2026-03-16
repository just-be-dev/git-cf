import { pktLine, flushPkt } from "@/git/core/index.ts";
import { createLogger } from "@/common/index.ts";

export class SidebandProgressMux {
  private progressMessages: string[] = [];
  private progressIdx = 0;
  private lastProgressTime = 0;
  private inProgress = false;
  private resolveFirstProgress?: () => void;
  private firstProgressPromise: Promise<void>;
  private readonly intervalMs: number;

  constructor(intervalMs = 100) {
    this.intervalMs = intervalMs;
    this.firstProgressPromise = new Promise<void>((resolve) => {
      this.resolveFirstProgress = resolve;
    });
  }

  push(msg: string): void {
    this.progressMessages.push(msg);
    if (this.resolveFirstProgress) {
      this.resolveFirstProgress();
      this.resolveFirstProgress = undefined;
    }
  }

  async waitForFirst(timeoutMs = 20): Promise<void> {
    await Promise.race([this.firstProgressPromise, new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  shouldSendProgress(): boolean {
    const now = Date.now();
    return (
      now - this.lastProgressTime >= this.intervalMs &&
      !this.inProgress &&
      this.progressIdx < this.progressMessages.length
    );
  }

  async sendPending(emitFn: (msg: string) => void): Promise<void> {
    if (this.shouldSendProgress()) {
      this.inProgress = true;
      while (this.progressIdx < this.progressMessages.length) {
        emitFn(this.progressMessages[this.progressIdx++]);
      }
      this.lastProgressTime = Date.now();
      this.inProgress = false;
    }
  }

  sendRemaining(emitFn: (msg: string) => void): void {
    while (this.progressIdx < this.progressMessages.length) {
      emitFn(this.progressMessages[this.progressIdx++]);
    }
  }
}

export function createSidebandTransform(options?: {
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
}): TransformStream<Uint8Array, Uint8Array> {
  const maxChunk = 65515;

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      if (options?.signal?.aborted) {
        controller.terminate();
        return;
      }

      for (let off = 0; off < chunk.byteLength; off += maxChunk) {
        const slice = chunk.subarray(off, Math.min(off + maxChunk, chunk.byteLength));
        const banded = new Uint8Array(1 + slice.byteLength);
        banded[0] = 0x01;
        banded.set(slice, 1);
        controller.enqueue(pktLine(banded));
      }
    },

    flush(controller) {},
  });
}

export function emitProgress(
  controller: ReadableStreamDefaultController<Uint8Array>,
  message: string
) {
  const msg = new TextEncoder().encode(message);
  const banded = new Uint8Array(1 + msg.byteLength);
  banded[0] = 0x02;
  banded.set(msg, 1);
  controller.enqueue(pktLine(banded));
}

export function emitFatal(
  controller: ReadableStreamDefaultController<Uint8Array>,
  message: string
) {
  const msg = new TextEncoder().encode(`fatal: ${message}\n`);
  const banded = new Uint8Array(1 + msg.byteLength);
  banded[0] = 0x03;
  banded.set(msg, 1);
  controller.enqueue(pktLine(banded));
}

export async function pipePackWithSideband(
  packStream: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: {
    signal?: AbortSignal;
    progressMux: SidebandProgressMux;
    log: ReturnType<typeof createLogger>;
  }
): Promise<void> {
  const { signal, progressMux, log } = options;

  try {
    const sidebandTransform = createSidebandTransform({ signal });
    const reader = packStream.pipeThrough(sidebandTransform).getReader();

    await progressMux.waitForFirst();
    progressMux.sendRemaining((msg) => emitProgress(controller, msg));

    while (true) {
      if (signal?.aborted) {
        log.debug("pipe:aborted");
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      await progressMux.sendPending((msg) => emitProgress(controller, msg));
      controller.enqueue(value);
    }

    progressMux.sendRemaining((msg) => emitProgress(controller, msg));
    controller.enqueue(flushPkt());
  } catch (error) {
    log.error("pipe:error", { error: String(error) });
    try {
      emitFatal(controller, String(error));
    } catch {}
    throw error;
  }
}

import type { HydrationCtx, StageHandlerResult } from "./types.ts";
import type { HydrationWork } from "../repoState.ts";

import { getDb, clearHydrCover, clearHydrPending } from "../db/index.ts";
import { nowMs } from "./helpers.ts";

export async function handleStageDone(
  ctx: HydrationCtx,
  work: HydrationWork
): Promise<StageHandlerResult> {
  const { state, store, log } = ctx;
  const queue = (await store.get("hydrationQueue")) || [];
  const newQ = Array.isArray(queue) ? queue.slice(1) : [];
  await store.put("hydrationQueue", newQ);
  await store.delete("hydrationWork");
  try {
    const db = getDb(state.storage);
    await clearHydrCover(db, work.workId);
    await clearHydrPending(db, work.workId);
  } catch {}
  log.info("done", { remaining: newQ.length });
  return { continue: newQ.length > 0, persist: false };
}

export async function handleStageError(
  ctx: HydrationCtx,
  work: HydrationWork
): Promise<StageHandlerResult> {
  const { log } = ctx;
  log.error("error:terminal", { message: work.error?.message, fatal: work.error?.fatal !== false });
  return { continue: false };
}

export async function handleTransientError(
  work: HydrationWork,
  log: HydrationCtx["log"],
  cfg: HydrationCtx["cfg"]
): Promise<void> {
  if (!work.error) return;
  work.error.retryCount = (work.error.retryCount || 0) + 1;
  work.error.firstErrorAt = work.error.firstErrorAt || nowMs();
  const intervalMs = Math.max(1000, cfg.unpackBackoffMs || 5000);
  work.error.nextRetryAt = nowMs() + intervalMs;
  log.warn("transient-error:will-retry", {
    message: work.error.message,
    retryCount: work.error.retryCount,
    nextRetryAt: work.error.nextRetryAt,
  });
}

import type { HydrationCtx, StageHandlerResult } from "../types.ts";
import type { HydrationWork } from "../../repoState.ts";

import { buildRecentWindowKeys, ensureHydrCoverForWork, setStage } from "../helpers.ts";
import { summarizeHydrationPlan } from "../status.ts";

export async function handleStagePlan(
  ctx: HydrationCtx,
  work: HydrationWork
): Promise<StageHandlerResult> {
  const { store, cfg, log } = ctx;
  const lastPackKey = (await store.get("lastPackKey")) || null;
  const packListRaw = (await store.get("packList")) || [];
  const packList = Array.isArray(packListRaw) ? packListRaw : [];
  const window = buildRecentWindowKeys(lastPackKey, packList, cfg.windowMax);

  work.snapshot = {
    lastPackKey,
    packList: packList.slice(0, cfg.windowMax),
    window,
  };
  work.progress = { ...(work.progress || {}), packIndex: 0, objCursor: 0 };

  try {
    await ensureHydrCoverForWork(ctx.state, store, cfg, work.workId);
  } catch (e) {
    log.warn("hydration:cover:init-failed", { error: String(e) });
  }

  if (work.dryRun) {
    try {
      const summary = await summarizeHydrationPlan(ctx.state, ctx.env, ctx.prefix);
      log.info("hydration:dry-run:summary", { summary });
    } catch (e) {
      log.warn("hydration:dry-run:summary-failed", { error: String(e) });
    }
    setStage(work, "done", log);
    log.info("hydration:planned(dry-run)", { window: window.length, last: lastPackKey });
    return { continue: true };
  }

  setStage(work, "scan-deltas", log);
  log.info("hydration:planned", { window: window.length, last: lastPackKey });
  return { continue: true };
}

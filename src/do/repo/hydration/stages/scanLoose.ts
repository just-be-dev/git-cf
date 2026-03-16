import type { HydrationCtx, StageHandlerResult } from "../types.ts";
import type { HydrationWork } from "../../repoState.ts";

import {
  clearError,
  setStage,
  updateProgress,
  makeHydrationLogger,
  nowMs,
  HYDR_LOOSE_LIST_PAGE,
} from "../helpers.ts";
import { handleTransientError } from "../cleanup.ts";
import {
  getDb,
  getHydrPendingCounts,
  insertHydrPendingOids,
  filterUncoveredAgainstHydrCover,
} from "../../db/index.ts";

export async function handleStageScanLoose(
  ctx: HydrationCtx,
  work: HydrationWork
): Promise<StageHandlerResult> {
  const { state, log, cfg } = ctx;
  const db = getDb(state.storage);
  log.debug("hydration:scan-loose:tick", {
    cursor: work.progress?.looseCursorKey || null,
  });
  const res = await scanLooseSlice(ctx, work);
  if (res === "next") {
    setStage(work, "build-segment", log);
    const counts = await getHydrPendingCounts(db, work.workId);
    log.info("hydration:scan-loose:done", { needLoose: counts.loose });
    clearError(work);
  } else if (res === "error") {
    await handleTransientError(work, log, cfg);
  } else {
    clearError(work);
  }
  return { continue: true };
}

async function scanLooseSlice(
  ctx: HydrationCtx,
  work: HydrationWork
): Promise<"more" | "next" | "error"> {
  const { state, env, cfg } = ctx;
  const start = nowMs();
  const log = makeHydrationLogger(env, work.snapshot?.lastPackKey || "");
  const db = getDb(state.storage);

  const needLoose = new Set<string>();

  const limit = HYDR_LOOSE_LIST_PAGE;
  let cursor = work.progress?.looseCursorKey || undefined;
  let done = false;

  while (!done && nowMs() - start < cfg.unpackMaxMs) {
    const opts: { prefix: string; limit: number; startAfter?: string } = {
      prefix: "obj:",
      limit,
      ...(cursor ? { startAfter: cursor } : {}),
    };
    let it;
    try {
      it = await state.storage.list(opts);
    } catch (e) {
      log.warn("scan-loose:list-error", { cursor, error: String(e) });
      work.error = { message: `Failed to list loose objects: ${String(e)}` };
      updateProgress(work, { looseCursorKey: cursor });
      await insertHydrPendingOids(db, work.workId, "loose", Array.from(needLoose));
      return "error";
    }
    const keys: string[] = [];
    for (const k of it.keys()) keys.push(String(k));
    if (keys.length === 0) {
      done = true;
      break;
    }
    const oids = keys.map((k) => String(k).slice(4).toLowerCase());
    let uncovered: string[] = [];
    try {
      uncovered = await filterUncoveredAgainstHydrCover(db, work.workId, oids);
    } catch (e) {
      log.warn("scan-loose:cover-check-failed", { error: String(e) });
      uncovered = oids;
    }
    for (const oid of uncovered) needLoose.add(oid);
    const lastKey = keys[keys.length - 1];
    if (nowMs() - start >= cfg.unpackMaxMs) {
      await insertHydrPendingOids(db, work.workId, "loose", Array.from(needLoose));
      updateProgress(work, { looseCursorKey: lastKey });
      log.debug("scan-loose:slice", { added: needLoose.size });
      return "more";
    }
    cursor = lastKey;
    if (keys.length < limit) {
      const next = await state.storage.list({ prefix: "obj:", limit: 1, startAfter: cursor });
      const hasMore = next && Array.from(next.keys()).length > 0;
      if (!hasMore) {
        done = true;
        break;
      }
    }
  }

  await insertHydrPendingOids(db, work.workId, "loose", Array.from(needLoose));
  if (done) {
    const prog = { ...(work.progress ?? {}) };
    prog.looseCursorKey = undefined;
    work.progress = prog;
    log.info("scan-loose:complete", { needLoose: needLoose.size });
    return "next";
  }
  updateProgress(work, { looseCursorKey: cursor });
  return "more";
}

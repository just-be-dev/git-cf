import type { HydrationCtx, StageHandler } from "./types.ts";
import type { RepoStateSchema, HydrationStage } from "../repoState.ts";

import { asTypedStorage } from "../repoState.ts";
import { ensureScheduled } from "../scheduler.ts";
import { getHydrConfig, makeHydrationLogger, nowMs } from "./helpers.ts";
import { handleStageDone, handleStageError } from "./cleanup.ts";
import { handleStagePlan } from "./stages/plan.ts";
import { handleStageScanDeltas } from "./stages/scanDeltas.ts";
import { handleStageScanLoose } from "./stages/scanLoose.ts";
import { handleStageBuildSegment } from "./stages/buildSegment.ts";

const STAGE_HANDLERS: Record<HydrationStage, StageHandler> = {
  plan: handleStagePlan,
  "scan-deltas": handleStageScanDeltas,
  "scan-loose": handleStageScanLoose,
  "build-segment": handleStageBuildSegment,
  done: handleStageDone,
  error: handleStageError,
};

export async function processHydrationSlice(
  state: DurableObjectState,
  env: Env,
  prefix: string
): Promise<boolean> {
  const store = asTypedStorage<RepoStateSchema>(state.storage);
  const log = makeHydrationLogger(env, prefix);
  const cfg = getHydrConfig(env);

  let work = (await store.get("hydrationWork")) || undefined;
  const queue = (await store.get("hydrationQueue")) || [];

  if (!work) {
    if (!Array.isArray(queue) || queue.length === 0) return false;
    const task = queue[0];
    work = {
      workId: `hydr-${nowMs()}`,
      startedAt: nowMs(),
      dryRun: !!task?.options?.dryRun,
      stage: "plan",
      progress: { packIndex: 0, objCursor: 0, segmentSeq: 0, producedBytes: 0 },
      stats: {},
    };
    await store.put("hydrationWork", work);
    await ensureScheduled(state, env);
    log.info("hydration:start", {
      stage: work.stage,
      reason: task?.reason || "?",
    });
    return true;
  }

  const ctx: HydrationCtx = { state, env, prefix, store, cfg, log };
  const handler = STAGE_HANDLERS[work.stage] as StageHandler | undefined;
  if (!handler) {
    await store.delete("hydrationWork");
    log.warn("reset:unknown-stage", {});
    return false;
  }

  const result = await handler(ctx, work);
  if (result.persist !== false) {
    await store.put("hydrationWork", work);
  }
  if (result.continue) {
    await ensureScheduled(state, env);
  }
  return result.continue;
}

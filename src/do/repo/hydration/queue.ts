import type { HydrationTask, HydrationReason } from "../repoState.ts";
import type { RepoStateSchema } from "../repoState.ts";

import { asTypedStorage } from "../repoState.ts";
import { createLogger } from "@/common/index.ts";
import { nowMs } from "./helpers.ts";
import { ensureScheduled } from "../scheduler.ts";

export async function enqueueHydrationTask(
  state: DurableObjectState,
  env: Env,
  options?: { dryRun?: boolean; reason?: HydrationReason }
): Promise<{ queued: boolean; workId: string; queueLength: number }> {
  const store = asTypedStorage<RepoStateSchema>(state.storage);
  const log = createLogger(env.LOG_LEVEL, { service: "Hydration" });
  const q = (await store.get("hydrationQueue")) || [];
  const reason = options?.reason || "admin";
  const exists = Array.isArray(q) && q.some((t: HydrationTask) => t?.reason === reason);
  const queue: HydrationTask[] = Array.isArray(q) ? q.slice() : [];
  const workId = `hydr-${nowMs()}`;
  if (!exists) {
    queue.push({ reason, createdAt: nowMs(), options: { dryRun: options?.dryRun } });
    await store.put("hydrationQueue", queue);
    await ensureScheduled(state, env);
    log.info("enqueue:ok", { queueLength: queue.length, reason });
  } else {
    log.info("enqueue:dedupe", { queueLength: queue.length, reason });
  }
  return { queued: true, workId, queueLength: queue.length };
}

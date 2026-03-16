import type { CacheContext } from "@/cache/index.ts";
import { parseCommitRefs, parseTreeChildOids, parseTagTarget } from "@/git/core/index.ts";
import { getRepoStub, createLogger } from "@/common/index.ts";
import { getLimiter, countSubrequest } from "../limits.ts";
import { findCommonHaves } from "../closure.ts";
import { readLooseObjectRaw } from "../read/index.ts";

export async function computeNeededFast(
  env: Env,
  repoId: string,
  wants: string[],
  haves: string[],
  cacheCtx?: CacheContext
): Promise<string[]> {
  const log = createLogger(env.LOG_LEVEL, { service: "NeededFast", repoId });
  const stub = getRepoStub(env, repoId);
  const limiter = getLimiter(cacheCtx);
  const startTime = Date.now();

  log.debug("fast:building-stop-set", { haves: haves.length });
  const stopSet = new Set<string>();
  const timeout = 49000;

  let ackOids: string[] = [];
  if (haves.length > 0) {
    ackOids = await findCommonHaves(env, repoId, haves.slice(0, 128), cacheCtx);
    for (const oid of ackOids) {
      stopSet.add(oid.toLowerCase());
    }

    if (ackOids.length === 0) {
      log.debug("fast:no-common-base", { haves: haves.length });
    }
  }

  if (ackOids.length > 0 && ackOids.length < 10) {
    const MAINLINE_BUDGET = 20;
    const mainlineQueue = [...ackOids];
    let mainlineCount = 0;

    while (mainlineQueue.length > 0 && mainlineCount < MAINLINE_BUDGET) {
      if (Date.now() - startTime > 2000) break;

      const oid = mainlineQueue.shift()!;
      try {
        const obj = await readLooseObjectRaw(env, repoId, oid, cacheCtx);
        if (obj?.type === "commit") {
          const refs = parseCommitRefs(obj.payload);
          if (refs.parents && refs.parents.length > 0) {
            const parent = refs.parents[0];
            if (!stopSet.has(parent)) {
              stopSet.add(parent);
              mainlineQueue.push(parent);
              mainlineCount++;
            }
          }
        }
      } catch {}
    }

    log.debug("fast:mainline-enriched", { stopSize: stopSet.size, walked: mainlineCount });
  }

  const seen = new Set<string>();
  const needed = new Set<string>();
  const queue = [...wants];

  if (cacheCtx) {
    cacheCtx.memo = cacheCtx.memo || {};
    cacheCtx.memo.refs = cacheCtx.memo.refs || new Map<string, string[]>();
    cacheCtx.memo.flags = cacheCtx.memo.flags || new Set<string>();
  }

  let doBatchBudget = cacheCtx?.memo?.doBatchBudget ?? 20;
  let doBatchDisabled = cacheCtx?.memo?.doBatchDisabled ?? false;
  let doBatchCalls = 0;
  let memoRefsHits = 0;
  let fallbackReads = 0;

  log.info("fast:starting-closure", { wants: wants.length, stopSet: stopSet.size });

  while (queue.length > 0) {
    if (Date.now() - startTime > timeout) {
      log.warn("fast:timeout", { seen: seen.size, needed: needed.size });
      if (cacheCtx) {
        cacheCtx.memo = cacheCtx.memo || {};
        cacheCtx.memo.flags = cacheCtx.memo.flags || new Set<string>();
        cacheCtx.memo.flags.add("closure-timeout");
      }
      break;
    }

    if (cacheCtx?.memo?.flags?.has("loader-capped")) {
      log.warn("fast:loader-capped", { seen: seen.size, needed: needed.size });
      if (cacheCtx) {
        cacheCtx.memo = cacheCtx.memo || {};
        cacheCtx.memo.flags = cacheCtx.memo.flags || new Set<string>();
        cacheCtx.memo.flags.add("closure-timeout");
      }
      break;
    }

    const batchSize = Math.min(128, queue.length);
    const batch = queue.splice(0, batchSize);
    const unseenBatch = batch.filter((oid) => !seen.has(oid));

    if (unseenBatch.length === 0) continue;

    const toProcess: string[] = [];
    for (const oid of unseenBatch) {
      seen.add(oid);
      const lc = oid.toLowerCase();

      if (stopSet.has(lc)) {
        log.debug("fast:hit-stop", { oid });
        continue;
      }

      needed.add(oid);
      toProcess.push(oid);
    }

    if (toProcess.length === 0) continue;

    let refsMap: Map<string, string[]> = new Map();

    if (cacheCtx?.memo?.refs) {
      for (const oid of toProcess) {
        const lc = oid.toLowerCase();
        const cached = cacheCtx.memo.refs.get(lc);
        if (cached && cached.length >= 0) {
          refsMap.set(oid, cached);
          memoRefsHits++;
        }
      }
    }

    const toBatch = toProcess.filter((oid) => !refsMap.has(oid));
    if (toBatch.length > 0 && !doBatchDisabled && doBatchBudget > 0) {
      try {
        const batchMap = await limiter.run("do:getObjectRefsBatch", async () => {
          countSubrequest(cacheCtx);
          return await stub.getObjectRefsBatch(toBatch);
        });
        doBatchBudget--;
        doBatchCalls++;

        for (const [oid, refs] of batchMap) {
          const lc = oid.toLowerCase();
          if (refs && refs.length >= 0) {
            refsMap.set(oid, refs);
            if (cacheCtx?.memo) {
              cacheCtx.memo.refs = cacheCtx.memo.refs || new Map<string, string[]>();
              cacheCtx.memo.refs.set(lc, refs);
            }
          }
        }
      } catch (e) {
        log.debug("fast:batch-error", { error: String(e) });
        doBatchDisabled = true;
      }
    }

    const stillMissing = toProcess.filter((oid) => !refsMap.has(oid));
    if (stillMissing.length > 0) {
      const CONC = 4;
      let idx = 0;
      const workers: Promise<void>[] = [];

      const fetchOne = async () => {
        while (idx < stillMissing.length) {
          const oid = stillMissing[idx++];
          fallbackReads++;

          try {
            const obj = await readLooseObjectRaw(env, repoId, oid, cacheCtx);
            if (!obj) continue;

            const refs: string[] = [];
            if (obj.type === "commit") {
              const commitRefs = parseCommitRefs(obj.payload);
              if (commitRefs.tree) refs.push(commitRefs.tree);
              if (commitRefs.parents) refs.push(...commitRefs.parents);
            } else if (obj.type === "tree") {
              const childOids = parseTreeChildOids(obj.payload);
              refs.push(...childOids);
            } else if (obj.type === "tag") {
              const tagInfo = parseTagTarget(obj.payload);
              if (tagInfo?.targetOid) refs.push(tagInfo.targetOid);
            }

            refsMap.set(oid, refs);
            if (cacheCtx?.memo) {
              const lc = oid.toLowerCase();
              cacheCtx.memo.refs = cacheCtx.memo.refs || new Map<string, string[]>();
              cacheCtx.memo.refs.set(lc, refs);
            }
          } catch {}
        }
      };

      for (let c = 0; c < CONC; c++) workers.push(fetchOne());
      await Promise.all(workers);
    }

    for (const [oid, refs] of refsMap) {
      for (const ref of refs) {
        if (!seen.has(ref)) {
          queue.push(ref);
        }
      }
    }
  }

  if (cacheCtx?.memo) {
    cacheCtx.memo.doBatchBudget = doBatchBudget;
    cacheCtx.memo.doBatchDisabled = doBatchDisabled;
  }

  const elapsed = Date.now() - startTime;
  log.info("fast:completed", {
    needed: needed.size,
    seen: seen.size,
    stopSet: stopSet.size,
    memoHits: memoRefsHits,
    doBatches: doBatchCalls,
    fallbacks: fallbackReads,
    timeMs: elapsed,
  });

  return Array.from(needed);
}

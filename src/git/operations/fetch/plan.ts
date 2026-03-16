import type { CacheContext } from "@/cache/index.ts";
import type { AssemblerPlan } from "./types.ts";

import { createLogger, getRepoStub } from "@/common/index.ts";
import { getPackCandidates } from "../packDiscovery.ts";
import { getLimiter } from "../limits.ts";
import { beginClosurePhase, endClosurePhase } from "../heavyMode.ts";
import {
  findCommonHaves,
  buildUnionNeededForKeys,
  countMissingRootTreesFromWants,
} from "../closure.ts";
import { getPackCapFromEnv } from "./config.ts";
import { computeNeededFast } from "./neededFast.ts";

export async function planUploadPack(
  env: Env,
  repoId: string,
  wants: string[],
  haves: string[],
  done: boolean,
  signal?: AbortSignal,
  cacheCtx?: CacheContext
): Promise<AssemblerPlan | null> {
  const log = createLogger(env.LOG_LEVEL, { service: "StreamPlan", repoId });
  const stub = getRepoStub(env, repoId);
  const doId = stub.id.toString();
  const heavy = cacheCtx?.memo?.flags?.has("no-cache-read") === true;
  const packCap = getPackCapFromEnv(env);
  const limiter = getLimiter(cacheCtx);

  const packKeys = await getPackCandidates(env, stub, doId, heavy, cacheCtx);

  if (haves.length === 0 && packKeys.length >= 2) {
    let maxKeys = Math.min(packCap, packKeys.length);
    let keys = packKeys.slice(0, maxKeys);
    let unionNeeded = await buildUnionNeededForKeys(stub, keys, limiter, cacheCtx, log);

    if (unionNeeded.length > 0) {
      try {
        const unionSet = new Set<string>(unionNeeded);
        const missingRoots = await countMissingRootTreesFromWants(
          env,
          repoId,
          wants,
          cacheCtx,
          unionSet
        );
        if (missingRoots > 0) {
          log.info("stream:plan:init-union:missing-roots", { missingRoots, keys: keys.length });
          maxKeys = packCap;
          keys = packKeys.slice(0, maxKeys);
          unionNeeded = await buildUnionNeededForKeys(stub, keys, limiter, cacheCtx, log);
        }
      } catch {}
    }

    if (unionNeeded.length > 0) {
      log.info("stream:plan:init-union", { packs: keys.length, union: unionNeeded.length });
      return {
        type: "InitCloneUnion",
        repoId,
        packKeys: keys,
        needed: unionNeeded,
        wants,
        ackOids: [],
        signal,
        cacheCtx,
      };
    }
  }

  beginClosurePhase(cacheCtx, { loaderCap: 400, doBatchBudget: 20 });
  const needed = await computeNeededFast(env, repoId, wants, haves, cacheCtx);
  endClosurePhase(cacheCtx);

  if (cacheCtx?.memo?.flags?.has("closure-timeout")) {
    log.warn("stream:plan:closure-timeout", { needed: needed.length });

    if (packKeys.length >= 2) {
      const maxKeys = Math.min(packCap, packKeys.length);
      const keys = packKeys.slice(0, maxKeys);
      const unionNeeded = await buildUnionNeededForKeys(stub, keys, limiter, cacheCtx, log);

      if (unionNeeded.length > 0) {
        const ackOids = done ? [] : await findCommonHaves(env, repoId, haves, cacheCtx);
        return {
          type: "IncrementalMulti",
          repoId,
          packKeys: keys,
          needed: unionNeeded,
          ackOids,
          signal,
          cacheCtx,
        };
      }
    }
    return null;
  }

  const ackOids = done ? [] : await findCommonHaves(env, repoId, haves, cacheCtx);

  if (packKeys.length === 1) {
    log.info("stream:plan:single-pack", {
      packKey: packKeys[0],
      needed: needed.length,
    });

    return {
      type: "IncrementalSingle",
      repoId,
      packKey: packKeys[0],
      needed,
      ackOids,
      signal,
      cacheCtx,
    };
  }

  if (packKeys.length >= 2) {
    log.info("stream:plan:multi-pack-available", {
      packs: packKeys.length,
      needed: needed.length,
    });

    return {
      type: "IncrementalSingle",
      repoId,
      packKey: packKeys[0],
      needed,
      ackOids,
      signal,
      cacheCtx,
    };
  }

  log.warn("stream:plan:no-packs-blocking", { needed: needed.length });
  return { type: "RepositoryNotReady" };
}

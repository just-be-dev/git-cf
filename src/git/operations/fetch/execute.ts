import type { ResolvedAssemblerPlan } from "./types.ts";

import { createLogger, getRepoStub } from "@/common/index.ts";
import { streamPackFromR2, streamPackFromMultiplePacks } from "@/git/pack/assemblerStream.ts";
import { getPackCandidates } from "../packDiscovery.ts";
import { getPackCapFromEnv } from "./config.ts";

export async function resolvePackStream(
  env: Env,
  plan: ResolvedAssemblerPlan,
  options?: {
    limiter?: { run<T>(label: string, fn: () => Promise<T>): Promise<T> };
    countSubrequest?: (n?: number) => void;
    onProgress?: (msg: string) => void;
    signal?: AbortSignal;
  }
): Promise<ReadableStream<Uint8Array> | undefined> {
  const log = createLogger(env.LOG_LEVEL, { service: "ResolvePackStream" });
  let packStream: ReadableStream<Uint8Array> | undefined;

  switch (plan.type) {
    case "InitCloneUnion":
    case "IncrementalMulti":
      packStream = await streamPackFromMultiplePacks(env, plan.packKeys, plan.needed, options);
      break;

    case "IncrementalSingle":
      packStream = await streamPackFromR2(env, plan.packKey, plan.needed, options);

      if (!packStream && plan.cacheCtx) {
        const stub = getRepoStub(env, plan.repoId);
        const doId = stub.id.toString();
        const heavy = plan.cacheCtx.memo?.flags?.has("no-cache-read") === true;
        const packKeys = await getPackCandidates(env, stub, doId, heavy, plan.cacheCtx);

        if (packKeys.length >= 2) {
          const packCap = getPackCapFromEnv(env);
          const slice = Math.min(packCap, packKeys.length);
          log.debug("pack-stream:single-fallback-to-multi", { packs: slice });
          packStream = await streamPackFromMultiplePacks(
            env,
            packKeys.slice(0, slice),
            plan.needed,
            options
          );
        }
      }
      break;
  }

  return packStream;
}

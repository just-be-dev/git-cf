import type {
  RepoStateSchema,
  HydrationTask,
  HydrationWork,
  HydrationStage,
  HydrationReason,
} from "../repoState.ts";
import type { Logger } from "@/common/logger.ts";
import { asTypedStorage } from "../repoState.ts";

export type HydrationCtx = {
  state: DurableObjectState;
  env: Env;
  prefix: string;
  store: ReturnType<typeof asTypedStorage<RepoStateSchema>>;
  cfg: {
    unpackMaxMs: number;
    unpackDelayMs: number;
    unpackBackoffMs: number;
    chunk: number;
    keepPacks: number;
    windowMax: number;
  };
  log: Logger;
};

export type HydrationPlan = {
  snapshot: { lastPackKey: string | null; packListCount: number };
  window: { packKeys: string[] };
  counts: {
    deltaBases: number;
    looseOnly: number;
    totalCandidates: number;
    alreadyCovered: number;
    toPack: number;
  };
  segments: { estimated: number; maxObjectsPerSegment: number; maxBytesPerSegment: number };
  budgets: { timePerSliceMs: number; softSubrequestLimit: number };
  stats: { examinedPacks: number; examinedObjects: number; examinedLoose: number };
  warnings: string[];
  partial: boolean;
};

export type StageHandlerResult = {
  continue: boolean;
  persist?: boolean;
};

export type StageHandler = (ctx: HydrationCtx, work: HydrationWork) => Promise<StageHandlerResult>;

export type PackHeaderEx = { type: number; baseRel?: number; baseOid?: string };

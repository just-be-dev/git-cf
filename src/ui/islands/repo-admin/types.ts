export type PackStat = {
  key?: string;
  packSize?: number;
  indexSize?: number;
  hasIndex?: boolean;
};

export type HydrationData = {
  running?: boolean;
  stage?: string;
  startedAt?: number;
  queued?: number;
  error?: string;
  progress?: {
    packIndex?: number;
    producedBytes?: number;
    segmentSeq?: number;
  };
};

export type AdminState = {
  packStats?: PackStat[];
  meta?: { doId?: string };
  looseR2SampleBytes?: number;
  looseR2SampleCount?: number;
  looseR2Truncated?: boolean;
  dbSizeBytes?: number;
  unpackWork?: { processedCount?: number; totalCount?: number };
  unpackNext?: unknown;
};

export type RepoAdminProps = {
  owner: string;
  repo: string;
  refEnc: string;
  head?: { target?: string; unborn?: boolean };
  refs: Array<{ name: string; oid: string }>;
  storageSize: string;
  packCount: number;
  packList: string[];
  state: AdminState;
  defaultBranch: string;
  hydrationStatus: string;
  hydrationStartedAt?: string | null;
  hydrationData?: HydrationData;
  hydrationPackCount: number;
  nextMaintenanceIn?: string;
  nextMaintenanceAt?: string;
};

/// <reference lib="dom" />

import { hydrateIsland } from "@/ui/client/hydrate";
import { countRefsByKind } from "@/git/refDisplay.ts";

export type { RepoAdminProps } from "./types";
import type { RepoAdminProps } from "./types";
import { useRepoAdminActions } from "./useRepoAdminActions";
import { RepoOverviewCard } from "./RepoOverviewCard";
import { HydrationCard } from "./HydrationCard";
import { PackFilesCard } from "./PackFilesCard";
import { RefsCard } from "./RefsCard";
import { DebugToolsCard } from "./DebugToolsCard";
import { DangerZoneCard } from "./DangerZoneCard";

export function RepoAdminIsland(props: RepoAdminProps) {
  const {
    owner,
    repo,
    head,
    refs,
    storageSize,
    packCount,
    packList,
    state,
    defaultBranch,
    hydrationStatus,
    hydrationStartedAt,
    hydrationData,
    hydrationPackCount,
    nextMaintenanceIn,
    nextMaintenanceAt,
  } = props;

  const {
    hydrationResult,
    oidResult,
    stateDump,
    pending,
    startHydration,
    clearHydration,
    removePack,
    checkOid,
    dumpState,
    purgeRepo,
  } = useRepoAdminActions(owner, repo);

  const { branchCount, tagCount } = countRefsByKind(refs);
  const packStats = Array.isArray(state.packStats) ? state.packStats : [];
  const hydrationRunning = Boolean(hydrationData?.running);

  return (
    <div className="space-y-6">
      <div className="alert warn">
        <strong>
          <i
            className="bi bi-exclamation-triangle-fill mr-2 inline h-4 w-4 align-[-2px] text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          ></i>
          Admin Area
        </strong>{" "}
        - Actions here can permanently modify repository data
      </div>

      <RepoOverviewCard
        storageSize={storageSize}
        packCount={packCount}
        hydrationPackCount={hydrationPackCount}
        nextMaintenanceIn={nextMaintenanceIn}
        nextMaintenanceAt={nextMaintenanceAt}
        state={state}
        head={head}
        branchCount={branchCount}
        tagCount={tagCount}
      />

      <HydrationCard
        hydrationRunning={hydrationRunning}
        hydrationData={hydrationData}
        packCount={packCount}
        hydrationStartedAt={hydrationStartedAt}
        hydrationStatus={hydrationStatus}
        pending={pending}
        startHydration={startHydration}
        clearHydration={clearHydration}
        hydrationResult={hydrationResult}
      />

      <PackFilesCard
        packCount={packCount}
        packStats={packStats}
        pending={pending}
        removePack={removePack}
      />

      <RefsCard refs={refs} />

      <DebugToolsCard
        oidResult={oidResult}
        stateDump={stateDump}
        pending={pending}
        checkOid={checkOid}
        dumpState={dumpState}
      />

      <DangerZoneCard
        defaultBranch={defaultBranch}
        packList={packList}
        pending={pending}
        purgeRepo={purgeRepo}
      />
    </div>
  );
}

export function initRepoAdmin() {
  hydrateIsland<RepoAdminProps>("repo-admin", RepoAdminIsland);
}

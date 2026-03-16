import type { HeadInfo, Ref } from "@/git";
import { isValidOwnerRepo } from "@/web";
import { renderUiView } from "@/ui/server/render";
import { getUnpackProgress, getRepoStub, unauthorizedAdminBasic } from "@/common";
import { verifyAuth } from "@/auth";
import { repoKey } from "@/keys";
import {
  badRequest,
  computeStorageMetrics,
  computeHydrationStatus,
  computeNextMaintenance,
  getDefaultBranchFromHead,
  loadHeadAndRefsCached,
  type DebugState,
} from "./helpers";

export async function handleAdminPage(request: Request, env: Env, ctx: ExecutionContext) {
  const { owner, repo } = (request as any).params;

  // Validate parameters
  if (!isValidOwnerRepo(owner) || !isValidOwnerRepo(repo)) {
    return badRequest(env, "Invalid owner/repo", "Owner or repo invalid", { owner, repo });
  }

  // Check authentication - admin access required
  if (!(await verifyAuth(env, owner, request, true))) {
    return unauthorizedAdminBasic();
  }

  const repoId = repoKey(owner, repo);
  const stub = getRepoStub(env, repoId);

  // Gather admin data in parallel for performance
  const [state, refsData, progress] = await Promise.all([
    stub.debugState().catch(() => ({}) as Partial<DebugState>),
    loadHeadAndRefsCached(env, request, ctx, repoId),
    getUnpackProgress(env, repoId),
  ]);

  const head: HeadInfo | undefined = refsData?.head || undefined;
  const refs: Ref[] = refsData?.refs || [];

  const { storageSize, packCount, packList, hydrationPackCount } = computeStorageMetrics(state);
  const { hydrationStatus, hydrationStartedAt } = computeHydrationStatus(
    state.hydration,
    packCount,
    hydrationPackCount
  );

  const defaultBranch = getDefaultBranchFromHead(head);
  const refEnc = encodeURIComponent(defaultBranch);

  const { nextMaintenanceIn, nextMaintenanceAt } = computeNextMaintenance(
    env,
    typeof state?.lastMaintenanceMs === "number" ? (state!.lastMaintenanceMs as number) : undefined
  );

  const html = await renderUiView(env, "admin", {
    title: `Admin · ${owner}/${repo}`,
    owner,
    repo,
    refEnc,
    head,
    refs,
    storageSize,
    packCount,
    packList,
    state,
    defaultBranch,
    hydrationStatus,
    hydrationStartedAt,
    hydrationData: state.hydration,
    hydrationPackCount,
    progress,
    nextMaintenanceIn,
    nextMaintenanceAt,
  });
  if (!html) {
    return new Response("Failed to render view", { status: 500 });
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Page-Renderer": "react-ssr",
    },
  });
}

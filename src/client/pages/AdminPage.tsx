import { type Progress, ProgressBanner } from "@/client/components/ProgressBanner";
import { RepoNav } from "@/client/components/RepoNav";
import { type RepoAdminProps, RepoAdminIsland } from "@/client/islands/repo-admin";
import { IslandHost } from "@/client/server/IslandHost";

export type AdminPageProps = RepoAdminProps & {
  progress?: Progress;
};

export function AdminPage({ progress, ...props }: AdminPageProps) {
  return (
    <div>
      <RepoNav
        owner={props.owner}
        repo={props.repo}
        refEnc={props.refEnc}
        currentTab="admin"
        showRefDropdown={false}
      />
      <ProgressBanner progress={progress} />
      <IslandHost name="repo-admin" props={props}>
        <RepoAdminIsland {...props} />
      </IslandHost>
    </div>
  );
}

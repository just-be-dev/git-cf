export type DangerZoneCardProps = {
  defaultBranch: string;
  packList: string[];
  pending: Record<string, boolean>;
  purgeRepo: (defaultBranch: string) => Promise<void>;
};

export function DangerZoneCard({
  defaultBranch,
  packList,
  pending,
  purgeRepo,
}: DangerZoneCardProps) {
  return (
    <details className="card border-2 border-red-500 p-6 dark:border-red-600">
      <summary className="cursor-pointer font-bold text-red-600 dark:text-red-500">
        <i
          className="bi bi-exclamation-triangle-fill mr-2 inline h-4 w-4 align-[-2px]"
          aria-hidden="true"
        ></i>
        Danger Zone - Irreversible Actions
      </summary>
      <div className="mt-6 space-y-4">
        <div className="alert error">
          <strong>Warning:</strong> These actions cannot be undone. All repository data will be
          permanently deleted.
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This will delete all objects, packs, references, and metadata associated with this
          repository. The repository will be removed from the owner registry.
        </p>
        <button
          className="btn bg-red-600 text-white hover:bg-red-700"
          type="button"
          onClick={() => void purgeRepo(defaultBranch)}
          disabled={pending["purge-repo"]}
        >
          <i className="bi bi-trash3-fill mr-2 inline h-4 w-4 align-[-2px]" aria-hidden="true"></i>
          <span className="label">
            {pending["purge-repo"] ? "Deleting..." : "Permanently Delete Repository"}
          </span>
        </button>
        <p className="muted text-xs">
          Default branch: <code>{defaultBranch}</code>
        </p>
        {packList.length ? (
          <p className="muted text-xs">Visible pack keys: {packList.length}</p>
        ) : null}
      </div>
    </details>
  );
}

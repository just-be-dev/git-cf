import { useState } from "react";
import { safeReadJson } from "@/client/json.ts";
import { isJsonObject, type JsonValue } from "@/web";

export function useRepoAdminActions(owner: string, repo: string) {
  const [hydrationResult, setHydrationResult] = useState<JsonValue | null>(null);
  const [oidResult, setOidResult] = useState<JsonValue | null>(null);
  const [stateDump, setStateDump] = useState<JsonValue | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  function readFlag(value: JsonValue | null, key: string): boolean {
    return isJsonObject(value) && value[key] === true;
  }

  function readErrorMessage(value: JsonValue | null): string {
    return isJsonObject(value) && typeof value.error === "string" ? value.error : "Unknown error";
  }

  async function runAction<T>(key: string, action: () => Promise<T>) {
    setPending((current) => ({ ...current, [key]: true }));
    try {
      return await action();
    } finally {
      setPending((current) => ({ ...current, [key]: false }));
    }
  }

  async function startHydration(dryRun: boolean) {
    await runAction(dryRun ? "hydration-dry-run" : "hydration-start", async () => {
      const response = await fetch(`/${owner}/${repo}/admin/hydrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await safeReadJson(response);
      setHydrationResult(data);
      if (response.ok && !dryRun) {
        window.setTimeout(() => window.location.reload(), 2000);
      }
    });
  }

  async function clearHydration() {
    if (!window.confirm("Clear all hydration state and hydration-generated packs?")) {
      return;
    }

    await runAction("hydration-clear", async () => {
      const response = await fetch(`/${owner}/${repo}/admin/hydrate`, { method: "DELETE" });
      const data = await safeReadJson(response);
      if (readFlag(data, "ok")) {
        window.alert("Hydration state cleared successfully");
        window.location.reload();
        return;
      }

      window.alert(`Error: ${readErrorMessage(data)}`);
    });
  }

  async function removePack(packName: string) {
    let warning = `Are you sure you want to remove pack: ${packName}?\n\nThis will delete the pack file, its index, and all associated metadata.`;
    if (packName.includes("pack-hydr-")) {
      warning = `WARNING: This is a hydration pack!\n\n${warning}\n\nRemoving hydration packs can impact fetch correctness. Only do this for troubleshooting and re-run hydration afterward.`;
    }
    if (!window.confirm(warning)) {
      return;
    }

    await runAction(`remove-pack:${packName}`, async () => {
      const response = await fetch(`/${owner}/${repo}/admin/pack/${encodeURIComponent(packName)}`, {
        method: "DELETE",
      });
      const data = await safeReadJson(response);
      if (readFlag(data, "ok")) {
        window.alert(
          `Pack removed successfully:\n- Pack file: ${readFlag(data, "deletedPack") ? "deleted" : "not found"}\n- Index file: ${readFlag(data, "deletedIndex") ? "deleted" : "not found"}\n- Metadata: ${readFlag(data, "deletedMetadata") ? "cleaned" : "unchanged"}`
        );
        window.location.reload();
        return;
      }

      window.alert(`Error removing pack: ${readErrorMessage(data)}`);
    });
  }

  async function checkOid(debugOid: string) {
    if (!debugOid || !/^[a-f0-9]{40}$/i.test(debugOid.trim())) {
      window.alert("Please enter a valid 40-character SHA-1 hash");
      return;
    }

    await runAction("check-oid", async () => {
      const response = await fetch(`/${owner}/${repo}/admin/debug-oid/${debugOid.trim()}`);
      setOidResult(await safeReadJson(response));
    });
  }

  async function dumpState() {
    await runAction("dump-state", async () => {
      const response = await fetch(`/${owner}/${repo}/admin/debug-state`);
      setStateDump(await safeReadJson(response));
    });
  }

  async function purgeRepo(defaultBranch: string) {
    const confirmation = window.prompt(
      `This action will PERMANENTLY DELETE all repository data.\n\nTo confirm, type exactly: purge-${owner}/${repo}`
    );
    if (confirmation !== `purge-${owner}/${repo}`) {
      if (confirmation !== null) {
        window.alert("Confirmation text did not match. Action cancelled.");
      }
      return;
    }
    if (!window.confirm("Final confirmation: Delete this repository forever?")) {
      return;
    }

    await runAction("purge-repo", async () => {
      const response = await fetch(`/${owner}/${repo}/admin/purge`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmation }),
      });
      const data = await safeReadJson(response);
      if (readFlag(data, "ok")) {
        window.alert("Repository has been permanently deleted");
        window.location.href = `/${owner}`;
        return;
      }

      window.alert(`Error: ${readErrorMessage(data)}`);
    });
  }

  return {
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
  };
}

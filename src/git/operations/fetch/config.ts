/**
 * Derive pack cap from env with clamping.
 */
export function getPackCapFromEnv(env: Env): number {
  const raw = Number(env.REPO_PACKLIST_MAX ?? 20);
  const n = Number.isFinite(raw) ? Math.floor(raw) : 20;
  return Math.max(1, Math.min(100, n));
}

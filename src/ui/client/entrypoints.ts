export const clientEntrypoints = {
  styles: "src/ui/client/entries/styles.ts",
  shell: "src/ui/client/entries/shell.ts",
  treePage: "src/ui/client/entries/tree-page.ts",
  blobPage: "src/ui/client/entries/blob-page.ts",
  commitPage: "src/ui/client/entries/commit-page.ts",
  commitsPage: "src/ui/client/entries/commits-page.ts",
  adminPage: "src/ui/client/entries/admin-page.ts",
  authPage: "src/ui/client/entries/auth-page.ts",
} as const;

export type ClientEntrypoint = (typeof clientEntrypoints)[keyof typeof clientEntrypoints];

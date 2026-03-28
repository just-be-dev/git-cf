import { initRepoAdmin } from "@/client/islands/repo-admin";
import { onReady } from "../on-ready";

onReady(() => {
  initRepoAdmin();
});

import { initAuthAdmin } from "@/client/islands/auth-admin";
import { onReady } from "../on-ready";

onReady(() => {
  initAuthAdmin();
});

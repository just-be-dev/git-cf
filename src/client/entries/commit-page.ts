import { initCommitDiffExpander } from "@/client/islands/commit-diff-expander";
import { initRefPicker } from "@/client/islands/ref-picker";
import { onReady } from "../on-ready";

onReady(() => {
  initRefPicker();
  initCommitDiffExpander();
});

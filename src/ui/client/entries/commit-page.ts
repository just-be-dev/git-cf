import { initCommitDiffExpander } from "@/ui/islands/commit-diff-expander";
import { initRefPicker } from "@/ui/islands/ref-picker";
import { onReady } from "../on-ready";

onReady(() => {
  initRefPicker();
  initCommitDiffExpander();
});

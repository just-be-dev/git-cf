import { initMergeExpander } from "@/ui/islands/merge-expander";
import { initRefPicker } from "@/ui/islands/ref-picker";
import { onReady } from "../on-ready";

onReady(() => {
  initRefPicker();
  initMergeExpander();
});

import { initMergeExpander } from "@/client/islands/merge-expander";
import { initRefPicker } from "@/client/islands/ref-picker";
import { onReady } from "../on-ready";

onReady(() => {
  initRefPicker();
  initMergeExpander();
});

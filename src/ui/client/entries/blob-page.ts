import { initBlobActions } from "@/ui/islands/blob-actions";
import { initCodeLineAnchors } from "@/ui/islands/code-line-anchors";
import { initRefPicker } from "@/ui/islands/ref-picker";
import { onReady } from "../on-ready";

onReady(() => {
  initRefPicker();
  initBlobActions();
  if (document.getElementById("blob-code")) {
    initCodeLineAnchors();
  }
});

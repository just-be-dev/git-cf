import { initBlobActions } from "@/client/islands/blob-actions";
import { initCodeLineAnchors } from "@/client/islands/code-line-anchors";
import { initRefPicker } from "@/client/islands/ref-picker";
import { onReady } from "../on-ready";

onReady(() => {
  initRefPicker();
  initBlobActions();
  if (document.getElementById("blob-code")) {
    initCodeLineAnchors();
  }
});

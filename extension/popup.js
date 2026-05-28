// ── Popup Script — checks backend health on open ─────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const dot   = document.getElementById("status-dot");
  const text  = document.getElementById("status-text");
  const model = document.getElementById("model-name");
  const feats = document.getElementById("feature-count");

  chrome.runtime.sendMessage({ type: "health" }, (response) => {
    if (response && response.ok) {
      dot.className = "status-dot online";
      text.textContent = "Backend connected";
      text.style.color = "#059669";
      model.textContent = response.data.model || "ranker_v1.lgb";
      feats.textContent = response.data.features || "11";
    } else {
      dot.className = "status-dot offline";
      text.textContent = "Backend offline";
      text.style.color = "#ef4444";
    }
  });
});

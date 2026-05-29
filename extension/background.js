// ── Search Re-Ranker — Background Service Worker ──────────────────────────
// Handles API calls to the local FastAPI backend on behalf of the content script.
// Detail page fetching is done in the content script (same-origin + has DOMParser).

const API_BASE = "http://localhost:8000";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "rerank") {
    fetch(`${API_BASE}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true; // keep channel open for async response
  }

  if (msg.type === "health") {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (msg.type === "logStats") {
    fetch(`${API_BASE}/stats/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    }).catch(() => {}); // best-effort, don't block

    return false;
  }
});

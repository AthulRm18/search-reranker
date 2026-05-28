// ── Search Re-Ranker — Background Service Worker ──────────────────────────
// Handles API calls to the local FastAPI backend on behalf of the content script.

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

  if (msg.type === "fetchDetail") {
    // Fetch a product detail page and extract description + bullets
    fetch(msg.url)
      .then((r) => r.text())
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Description
        let description = "";
        const descEl = doc.querySelector("#productDescription p, #productDescription");
        if (descEl) description = descEl.textContent.trim().slice(0, 500);

        // Bullet points
        let bullets = "";
        const bulletEls = doc.querySelectorAll("#feature-bullets ul li span.a-list-item");
        if (bulletEls.length) {
          bullets = Array.from(bulletEls)
            .map((el) => el.textContent.trim())
            .filter((t) => t.length > 5)
            .join(" | ")
            .slice(0, 500);
        }

        // Color
        let color = "";
        const colorRow = doc.querySelector('#productOverview_feature_div tr:has(td:first-child span:contains("Color")) td:last-child span');
        if (!colorRow) {
          const tbRows = doc.querySelectorAll("#productOverview_feature_div tr");
          for (const row of tbRows) {
            const label = row.querySelector("td:first-child span");
            if (label && label.textContent.trim().toLowerCase() === "color") {
              const val = row.querySelector("td:last-child span");
              if (val) color = val.textContent.trim();
              break;
            }
          }
        }

        sendResponse({ ok: true, data: { description, bullets, color } });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }
});

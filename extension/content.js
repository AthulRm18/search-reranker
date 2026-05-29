// ── Search Re-Ranker — Content Script ─────────────────────────────────────
// Runs on Amazon search result pages. Scrapes products, calls re-ranker API
// via background script, and reorders the DOM with animations.

(function () {
  "use strict";

  if (window.__searchRerankerInjected) return;
  window.__searchRerankerInjected = true;

  const LOG = (...args) => console.log("[SRR]", ...args);
  const ORIGIN = window.location.origin;

  let isReranked = false;
  let originalOrder = [];
  let currentMode = "balanced";
  let lastMetrics = null;

  // ══════════════════════════════════════════════════════════════════════════
  //  INIT — log page diagnostics immediately
  // ══════════════════════════════════════════════════════════════════════════
  function logDiagnostics() {
    const diag = {
      url: window.location.href,
      origin: ORIGIN,
      query_k: new URLSearchParams(window.location.search).get("k"),
      query_fk: new URLSearchParams(window.location.search).get("field-keywords"),
      data_asin_all: document.querySelectorAll("[data-asin]").length,
      data_asin_nonempty: document.querySelectorAll("[data-asin]:not([data-asin=''])").length,
      s_search_result: document.querySelectorAll('[data-component-type="s-search-result"]').length,
      cel_widget_search: document.querySelectorAll('[data-cel-widget*="search_result"]').length,
      cel_widget_any: document.querySelectorAll("[data-cel-widget]").length,
      s_result_item: document.querySelectorAll(".s-result-item").length,
      s_main_slot: !!document.querySelector(".s-main-slot"),
      search_div: !!document.querySelector("#search"),
      h2_count: document.querySelectorAll("h2").length,
      dp_links: document.querySelectorAll('a[href*="/dp/"]').length,
    };
    LOG("Page diagnostics:", JSON.stringify(diag, null, 2));
    return diag;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOATING ACTION BUTTON
  // ══════════════════════════════════════════════════════════════════════════
  function injectFAB() {
    if (document.getElementById("srr-fab")) return;

    const fab = document.createElement("div");
    fab.id = "srr-fab";
    fab.innerHTML = `
      <button id="srr-rerank-btn" title="Re-Rank with ML">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span>Re-Rank</span>
      </button>
      <div id="srr-mode-bar">
        <button class="srr-mode-btn srr-mode-active" data-mode="balanced">Balanced</button>
        <button class="srr-mode-btn" data-mode="relevance">Relevance</button>
        <button class="srr-mode-btn" data-mode="fair">Fairness</button>
      </div>
    `;
    document.body.appendChild(fab);

    document.getElementById("srr-rerank-btn").addEventListener("click", () => {
      if (isReranked) restoreOriginalOrder();
      else runRerank();
    });

    fab.querySelectorAll(".srr-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        fab.querySelectorAll(".srr-mode-btn").forEach((b) => b.classList.remove("srr-mode-active"));
        btn.classList.add("srr-mode-active");
        currentMode = btn.dataset.mode;
        if (isReranked) {
          restoreOriginalOrder();
          setTimeout(() => runRerank(), 100);
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PIPELINE OVERLAY
  // ══════════════════════════════════════════════════════════════════════════
  function showPipeline() {
    removePipeline();
    const overlay = document.createElement("div");
    overlay.id = "srr-pipeline";
    overlay.innerHTML = `
      <div class="srr-pipeline-inner">
        <div class="srr-pipeline-title">ML Re-Ranking Pipeline</div>
        <div class="srr-pipeline-steps">
          <div class="srr-step" id="srr-step-0"><span class="srr-step-dot"></span>Scraping</div>
          <div class="srr-step" id="srr-step-1"><span class="srr-step-dot"></span>Details</div>
          <div class="srr-step" id="srr-step-2"><span class="srr-step-dot"></span>Features</div>
          <div class="srr-step" id="srr-step-3"><span class="srr-step-dot"></span>LambdaMART</div>
          <div class="srr-step" id="srr-step-4"><span class="srr-step-dot"></span>Trust</div>
          <div class="srr-step" id="srr-step-5"><span class="srr-step-dot"></span>Re-Rank</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function setPipelineStep(i) {
    for (let j = 0; j <= 5; j++) {
      const el = document.getElementById(`srr-step-${j}`);
      if (!el) continue;
      el.classList.remove("srr-step-active", "srr-step-done");
      if (j < i) el.classList.add("srr-step-done");
      else if (j === i) el.classList.add("srr-step-active");
    }
  }

  function removePipeline() {
    const el = document.getElementById("srr-pipeline");
    if (el) el.remove();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  METRICS OVERLAY
  // ══════════════════════════════════════════════════════════════════════════
  function showMetrics(metrics, sponsoredBefore, sponsoredAfterTop5) {
    removeMetrics();
    const overlay = document.createElement("div");
    overlay.id = "srr-metrics";
    overlay.innerHTML = `
      <div class="srr-metrics-inner">
        <div class="srr-metrics-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Re-Ranked · ${currentMode}
          <button id="srr-close-metrics" title="Close">✕</button>
        </div>
        <div class="srr-metrics-grid">
          <div class="srr-metric">
            <span class="srr-metric-label">Baseline NDCG</span>
            <span class="srr-metric-value">${metrics.baseline_ndcg.toFixed(4)}</span>
          </div>
          <div class="srr-metric srr-metric-highlight">
            <span class="srr-metric-label">Optimized NDCG</span>
            <span class="srr-metric-value">${metrics.optimized_ndcg.toFixed(4)}</span>
          </div>
          <div class="srr-metric">
            <span class="srr-metric-label">Sponsored (before)</span>
            <span class="srr-metric-value">${sponsoredBefore}</span>
          </div>
          <div class="srr-metric">
            <span class="srr-metric-label">Sponsored (top 5 after)</span>
            <span class="srr-metric-value">${sponsoredAfterTop5}</span>
          </div>
        </div>
        <button id="srr-restore-btn">Restore Original</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("srr-close-metrics").addEventListener("click", removeMetrics);
    document.getElementById("srr-restore-btn").addEventListener("click", () => {
      restoreOriginalOrder();
      removeMetrics();
    });
  }

  function removeMetrics() {
    const el = document.getElementById("srr-metrics");
    if (el) el.remove();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SCRAPER — tries EVERYTHING to find product cards
  // ══════════════════════════════════════════════════════════════════════════

  function scrapeProducts() {
    const diag = logDiagnostics();

    // ── Strategy 1: data-component-type (amazon.com) ──
    let cards = Array.from(
      document.querySelectorAll('[data-component-type="s-search-result"]')
    );
    if (cards.length) LOG("Strategy 1 hit: s-search-result:", cards.length);

    // ── Strategy 2: data-cel-widget containing "search_result" (amazon.in) ──
    if (!cards.length) {
      cards = Array.from(
        document.querySelectorAll("[data-cel-widget]")
      ).filter((el) => {
        const w = el.getAttribute("data-cel-widget") || "";
        return w.includes("search_result") && el.querySelector("[data-asin]");
      });
      if (cards.length) {
        // The cel-widget wrapper may not have data-asin itself; find the inner asin element
        cards = cards.map((el) => el.querySelector("[data-asin]") || el);
        LOG("Strategy 2 hit: cel-widget search_result:", cards.length);
      }
    }

    // ── Strategy 3: .s-result-item with data-asin ──
    if (!cards.length) {
      cards = Array.from(document.querySelectorAll(".s-result-item[data-asin]"))
        .filter((el) => el.getAttribute("data-asin") !== "");
      if (cards.length) LOG("Strategy 3 hit: .s-result-item[data-asin]:", cards.length);
    }

    // ── Strategy 4: any data-asin inside #search or .s-main-slot ──
    if (!cards.length) {
      const container =
        document.querySelector(".s-main-slot") ||
        document.querySelector("#search") ||
        document.querySelector('[data-component-type="s-search-results"]') ||
        document.querySelector(".s-desktop-content");
      if (container) {
        cards = Array.from(container.querySelectorAll("[data-asin]"))
          .filter((el) => el.getAttribute("data-asin") !== "" && el.getAttribute("data-asin").length >= 5);
        if (cards.length) LOG("Strategy 4 hit: data-asin inside search container:", cards.length);
      }
    }

    // ── Strategy 5: ALL data-asin on page, filter by size ──
    if (!cards.length) {
      cards = Array.from(document.querySelectorAll("[data-asin]")).filter((el) => {
        const asin = el.getAttribute("data-asin");
        return asin && asin.length >= 5 && el.getBoundingClientRect().height > 50;
      });
      if (cards.length) LOG("Strategy 5 hit: all visible data-asin:", cards.length);
    }

    // ── Strategy 6 (NUCLEAR): find products by /dp/ links ──
    if (!cards.length) {
      LOG("All data-asin strategies failed. Trying /dp/ link approach...");
      const dpLinks = document.querySelectorAll('a[href*="/dp/"]');
      const asinMap = new Map(); // asin -> closest large parent
      dpLinks.forEach((a) => {
        const match = a.href.match(/\/dp\/([A-Z0-9]{10})/);
        if (!match) return;
        const asin = match[1];
        if (asinMap.has(asin)) return;
        // Walk up to find a reasonable "card" parent
        let parent = a.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
          if (parent.getBoundingClientRect().height > 100) {
            // Check this isn't the entire page
            if (parent.getBoundingClientRect().height < window.innerHeight * 0.8) {
              parent.setAttribute("data-asin", asin); // inject for later use
              asinMap.set(asin, parent);
              break;
            }
          }
          parent = parent.parentElement;
        }
      });
      cards = Array.from(asinMap.values());
      if (cards.length) LOG("Strategy 6 hit: /dp/ link parents:", cards.length);
    }

    if (!cards.length) {
      LOG("ALL strategies failed. Page HTML sample:", document.body.innerHTML.slice(0, 2000));
      return [];
    }

    // ── Deduplicate and extract data ──
    const products = [];
    const seenAsins = new Set();

    cards.forEach((card, index) => {
      let asin = card.getAttribute("data-asin");

      // If no data-asin, try to extract from a /dp/ link inside
      if (!asin || asin.length < 5) {
        const dpLink = card.querySelector('a[href*="/dp/"]');
        if (dpLink) {
          const m = dpLink.href.match(/\/dp\/([A-Z0-9]{10})/);
          if (m) asin = m[1];
        }
      }
      if (!asin || asin.length < 5 || seenAsins.has(asin)) return;
      seenAsins.add(asin);

      // ── Title ──
      let title = "";
      const TITLE_SELS = [
        "h2 a span.a-text-normal",
        "h2 a span",
        "h2 span.a-text-normal",
        "h2 span",
        'h2 a[href*="/dp/"] span',
        ".a-size-medium.a-text-normal",
        ".a-size-base-plus.a-text-normal",
        ".a-text-normal",
        "h2",
        'a[href*="/dp/"]',
      ];
      for (const sel of TITLE_SELS) {
        const el = card.querySelector(sel);
        if (el) {
          const t = el.textContent.trim();
          if (t.length > 5) { title = t.slice(0, 200); break; }
        }
      }
      if (!title) {
        LOG(`Skipping ${asin}: no title`);
        return;
      }

      // ── Brand ──
      let brand = "";
      const BRAND_SELS = [
        ".a-row .a-size-base-plus",
        ".s-line-clamp-1 .a-size-base",
        "span.a-size-base:first-of-type",
        ".a-row .a-size-base",
        ".puis-bold-weight-text",
      ];
      for (const sel of BRAND_SELS) {
        const el = card.querySelector(sel);
        if (el) {
          const t = el.textContent.trim();
          if (t.length > 0 && t.length < 60 && !/[₹$€£]/.test(t) && !t.includes("star")) {
            brand = t;
            break;
          }
        }
      }

      // ── Sponsored ──
      let sponsored = false;
      const topText = card.textContent.slice(0, 400).toLowerCase();
      if (
        /\bsponsored\b/i.test(topText) ||
        topText.includes("प्रायोजित") ||
        card.querySelector(".puis-label-popover-default") ||
        card.querySelector(".s-label-popover-default") ||
        card.querySelector('[data-component-type="sp-sponsored-result"]')
      ) {
        sponsored = true;
      }

      // ── URL ──
      const linkEl = card.querySelector('h2 a, a[href*="/dp/"]');
      const url = linkEl ? linkEl.href : `${ORIGIN}/dp/${asin}`;

      products.push({
        asin, title, brand, sponsored, url,
        original_rank: index + 1,
        element: card,
        description: "", bullets: "", color: "",
      });
    });

    LOG(`Scraped ${products.length} products (${products.filter((p) => p.sponsored).length} sponsored)`);
    products.slice(0, 3).forEach((p) => LOG(`  Sample: [${p.asin}] "${p.title.slice(0, 60)}..." spons=${p.sponsored}`));
    return products;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DETAIL FETCHER
  // ══════════════════════════════════════════════════════════════════════════

  async function fetchProductDetails(products) {
    const toFetch = products.slice(0, 12);
    for (let i = 0; i < toFetch.length; i += 3) {
      const batch = toFetch.slice(i, i + 3);
      await Promise.all(batch.map((p) => fetchSingleDetail(p)));
    }
    LOG(`Fetched details for ${Math.min(toFetch.length, products.length)} products`);
  }

  async function fetchSingleDetail(product) {
    try {
      const resp = await fetch(product.url, { credentials: "same-origin" });
      if (!resp.ok) return;
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // Description
      for (const sel of ["#productDescription p", "#productDescription", "#productDescription_feature_div p", "#aplus_feature_div"]) {
        const el = doc.querySelector(sel);
        if (el && el.textContent.trim().length > 20) {
          product.description = el.textContent.trim().slice(0, 500);
          break;
        }
      }

      // Bullets
      for (const sel of ["#feature-bullets ul li span.a-list-item", "#feature-bullets ul li", ".a-unordered-list .a-list-item"]) {
        const els = doc.querySelectorAll(sel);
        if (els.length) {
          product.bullets = Array.from(els).map((e) => e.textContent.trim()).filter((t) => t.length > 5 && t.length < 500).slice(0, 10).join(" | ").slice(0, 500);
          if (product.bullets.length > 20) break;
        }
      }

      // Color
      for (const row of doc.querySelectorAll("#productOverview_feature_div tr, #detailBullets_feature_div li, #poExpander tr, .prodDetTable tr")) {
        const text = row.textContent.toLowerCase();
        if (text.includes("color") || text.includes("colour")) {
          const cells = row.querySelectorAll("td span, td, span");
          if (cells.length >= 2) { product.color = cells[cells.length - 1].textContent.trim().slice(0, 50); break; }
        }
      }
    } catch (err) {
      LOG(`Detail fetch failed for ${product.asin}: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  API
  // ══════════════════════════════════════════════════════════════════════════

  async function callRerankAPI(products, query) {
    const payload = {
      query,
      mode: currentMode,
      products: products.map((p) => ({
        product_id: p.asin,
        product_title: p.title,
        product_description: p.description,
        product_bullet_point: p.bullets,
        product_brand: p.brand,
        product_color: p.color,
        original_rank: p.original_rank,
        sponsored: p.sponsored,
      })),
    };

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "rerank", payload }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (response && response.ok) resolve(response.data);
        else reject(new Error(response ? response.error : "No response"));
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DOM REORDER — FLIP animation
  // ══════════════════════════════════════════════════════════════════════════

  function findCommonParent(elements) {
    if (!elements.length) return null;
    const first = elements[0].parentElement;
    if (elements.every((el) => el.parentElement === first)) return first;
    let anc = first;
    while (anc && anc !== document.body) {
      if (elements.every((el) => anc.contains(el))) return anc;
      anc = anc.parentElement;
    }
    return first;
  }

  function reorderDOM(products, rankedResults) {
    const resultMap = {};
    rankedResults.results.forEach((r) => { resultMap[r.product_id] = r; });

    const container = findCommonParent(products.map((p) => p.element));
    if (!container) { LOG("No common parent found"); return; }

    originalOrder = products.map((p) => ({ asin: p.asin, element: p.element }));

    const sorted = [...products].sort((a, b) => (resultMap[a.asin]?.new_rank ?? 999) - (resultMap[b.asin]?.new_rank ?? 999));

    // FLIP
    const positions = new Map();
    products.forEach((p) => { const r = p.element.getBoundingClientRect(); positions.set(p.asin, { top: r.top, left: r.left }); });

    sorted.forEach((p) => container.appendChild(p.element));

    sorted.forEach((p) => {
      const old = positions.get(p.asin);
      const cur = p.element.getBoundingClientRect();
      if (old) {
        p.element.style.transform = `translate(${old.left - cur.left}px, ${old.top - cur.top}px)`;
        p.element.style.transition = "none";
        p.element.offsetHeight;
        p.element.style.transition = "transform 0.6s cubic-bezier(0.25,0.46,0.45,0.94)";
        p.element.style.transform = "translate(0,0)";
      }
    });

    sorted.forEach((p) => { const r = resultMap[p.asin]; if (r) addRankBadge(p.element, r); });

    isReranked = true;
    updateFABState();
    LOG(`Reordered ${sorted.length} products`);
  }

  function addRankBadge(element, result) {
    const existing = element.querySelector(".srr-badge");
    if (existing) existing.remove();

    const ch = result.rank_change;
    const cls = ch > 0 ? "srr-badge-up" : ch < 0 ? "srr-badge-down" : "srr-badge-neutral";
    const txt = ch > 0 ? `↑ ${ch}` : ch < 0 ? `↓ ${Math.abs(ch)}` : "→ 0";

    const badge = document.createElement("div");
    badge.className = "srr-badge";
    badge.innerHTML = `
      <div class="srr-badge-rank">#${result.new_rank}</div>
      <div class="srr-badge-change ${cls}">${txt}</div>
      <div class="srr-badge-scores">
        <div class="srr-score-row"><span>Rel</span><div class="srr-score-bar"><div class="srr-score-fill srr-score-rel" style="width:${(result.relevance_score * 100).toFixed(0)}%"></div></div><span>${(result.relevance_score * 100).toFixed(0)}%</span></div>
        <div class="srr-score-row"><span>Trust</span><div class="srr-score-bar"><div class="srr-score-fill srr-score-trust" style="width:${(result.trust_score * 100).toFixed(0)}%"></div></div><span>${(result.trust_score * 100).toFixed(0)}%</span></div>
      </div>
    `;
    element.style.position = "relative";
    element.appendChild(badge);
  }

  function restoreOriginalOrder() {
    if (!originalOrder.length) return;
    const container = findCommonParent(originalOrder.map((i) => i.element));
    const positions = new Map();
    originalOrder.forEach((item) => { const r = item.element.getBoundingClientRect(); positions.set(item.asin, { top: r.top, left: r.left }); });
    originalOrder.forEach((item) => container.appendChild(item.element));
    originalOrder.forEach((item) => {
      const old = positions.get(item.asin);
      const cur = item.element.getBoundingClientRect();
      if (old) {
        item.element.style.transform = `translate(${old.left - cur.left}px, ${old.top - cur.top}px)`;
        item.element.style.transition = "none";
        item.element.offsetHeight;
        item.element.style.transition = "transform 0.6s cubic-bezier(0.25,0.46,0.45,0.94)";
        item.element.style.transform = "translate(0,0)";
      }
      const b = item.element.querySelector(".srr-badge"); if (b) b.remove();
    });
    isReranked = false;
    updateFABState();
  }

  function updateFABState() {
    const btn = document.getElementById("srr-rerank-btn");
    if (!btn) return;
    if (isReranked) { btn.classList.add("srr-reranked"); btn.querySelector("span").textContent = "Restore"; }
    else { btn.classList.remove("srr-reranked"); btn.querySelector("span").textContent = "Re-Rank"; }
  }

  function getSearchQuery() {
    const p = new URLSearchParams(window.location.search);
    return p.get("k") || p.get("field-keywords") || "";
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MAIN FLOW
  // ══════════════════════════════════════════════════════════════════════════

  async function runRerank() {
    const query = getSearchQuery();
    if (!query) {
      alert("[Search Re-Ranker] Could not find search query in the URL.\nURL: " + window.location.href);
      return;
    }

    showPipeline();
    try {
      setPipelineStep(0);
      await sleep(200);
      const products = scrapeProducts();

      if (products.length === 0) {
        removePipeline();
        // Show alert with diagnostics so user can report
        const diag = logDiagnostics();
        alert(
          "[Search Re-Ranker] Could not find products on this page.\n\n" +
          "Debug info (share this if reporting a bug):\n" +
          `data-asin elements: ${diag.data_asin_nonempty}\n` +
          `s-search-result: ${diag.s_search_result}\n` +
          `cel-widget search: ${diag.cel_widget_search}\n` +
          `s-result-item: ${diag.s_result_item}\n` +
          `links to /dp/: ${diag.dp_links}\n` +
          `h2 tags: ${diag.h2_count}\n` +
          `#search exists: ${diag.search_div}\n` +
          `\nURL: ${window.location.href.slice(0, 100)}`
        );
        return;
      }

      setPipelineStep(1);
      await fetchProductDetails(products);
      await sleep(200);

      setPipelineStep(2); await sleep(300);
      setPipelineStep(3); await sleep(300);
      setPipelineStep(4);

      const apiResult = await callRerankAPI(products, query);
      await sleep(200);

      setPipelineStep(5); await sleep(300);

      lastMetrics = apiResult;
      reorderDOM(products, apiResult);
      removePipeline();
      showMetrics(apiResult, products.filter((p) => p.sponsored).length, apiResult.results.slice(0, 5).filter((r) => r.sponsored).length);

    } catch (err) {
      removePipeline();
      LOG("Error:", err);
      alert("[Search Re-Ranker] Error: " + err.message + "\n\nIs the FastAPI backend running on localhost:8000?");
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ══════════════════════════════════════════════════════════════════════════
  //  BOOT
  // ══════════════════════════════════════════════════════════════════════════
  LOG("Content script loaded.");
  logDiagnostics();
  injectFAB();
  LOG("FAB injected. Ready.");
})();

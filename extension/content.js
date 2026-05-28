// ── Search Re-Ranker — Content Script ─────────────────────────────────────
// Runs on Amazon search result pages. Scrapes products, calls re-ranker API
// via background script, and reorders the DOM with animations.

(function () {
  "use strict";

  // Prevent double injection
  if (window.__searchRerankerInjected) return;
  window.__searchRerankerInjected = true;

  // ── State ───────────────────────────────────────────────────────────────
  let isReranked = false;
  let originalOrder = []; // [{asin, element}]
  let currentMode = "balanced";
  let lastMetrics = null;

  // ── Floating Action Button ──────────────────────────────────────────────
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

    // Re-rank button
    document.getElementById("srr-rerank-btn").addEventListener("click", () => {
      if (isReranked) {
        restoreOriginalOrder();
      } else {
        runRerank();
      }
    });

    // Mode buttons
    fab.querySelectorAll(".srr-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        fab.querySelectorAll(".srr-mode-btn").forEach((b) => b.classList.remove("srr-mode-active"));
        btn.classList.add("srr-mode-active");
        currentMode = btn.dataset.mode;
        // Re-run if already reranked
        if (isReranked) {
          restoreOriginalOrder();
          setTimeout(() => runRerank(), 100);
        }
      });
    });
  }

  // ── Pipeline Overlay ────────────────────────────────────────────────────
  function showPipeline() {
    removePipeline();
    const overlay = document.createElement("div");
    overlay.id = "srr-pipeline";
    overlay.innerHTML = `
      <div class="srr-pipeline-inner">
        <div class="srr-pipeline-title">ML Re-Ranking Pipeline</div>
        <div class="srr-pipeline-steps">
          <div class="srr-step" id="srr-step-0"><span class="srr-step-dot"></span>Scraping Products</div>
          <div class="srr-step" id="srr-step-1"><span class="srr-step-dot"></span>Fetching Details</div>
          <div class="srr-step" id="srr-step-2"><span class="srr-step-dot"></span>Feature Extraction</div>
          <div class="srr-step" id="srr-step-3"><span class="srr-step-dot"></span>LambdaMART Scoring</div>
          <div class="srr-step" id="srr-step-4"><span class="srr-step-dot"></span>Trust Scoring</div>
          <div class="srr-step" id="srr-step-5"><span class="srr-step-dot"></span>Re-Ranking</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function setPipelineStep(stepIndex) {
    for (let i = 0; i <= 5; i++) {
      const el = document.getElementById(`srr-step-${i}`);
      if (!el) continue;
      el.classList.remove("srr-step-active", "srr-step-done");
      if (i < stepIndex) el.classList.add("srr-step-done");
      else if (i === stepIndex) el.classList.add("srr-step-active");
    }
  }

  function removePipeline() {
    const el = document.getElementById("srr-pipeline");
    if (el) el.remove();
  }

  // ── Metrics Overlay ─────────────────────────────────────────────────────
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

  // ── Scrape Amazon Search Results ────────────────────────────────────────
  function scrapeProducts() {
    const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
    const products = [];

    cards.forEach((card, index) => {
      const asin = card.getAttribute("data-asin");
      if (!asin) return;

      // Title
      const titleEl = card.querySelector("h2 a span, h2 span.a-text-normal");
      const title = titleEl ? titleEl.textContent.trim() : "";
      if (!title) return;

      // Brand
      let brand = "";
      const brandEl = card.querySelector(".a-row .a-size-base-plus, .s-line-clamp-1 .a-size-base");
      if (brandEl) brand = brandEl.textContent.trim();

      // Sponsored
      const sponsoredEl = card.querySelector(
        '.puis-label-popover-default, .s-label-popover-default, [data-component-type="sp-sponsored-result"]'
      );
      const cardText = card.textContent || "";
      const sponsored = !!(sponsoredEl || /\bSponsored\b/.test(cardText.slice(0, 200)));

      // Product URL
      const linkEl = card.querySelector("h2 a");
      const url = linkEl ? linkEl.href : `https://www.amazon.com/dp/${asin}`;

      products.push({
        asin,
        title,
        brand,
        sponsored,
        url,
        original_rank: index + 1,
        element: card,
        // Will be filled by detail fetcher
        description: "",
        bullets: "",
        color: "",
      });
    });

    return products;
  }

  // ── Fetch Product Detail Pages ──────────────────────────────────────────
  async function fetchProductDetails(products) {
    // Fetch details for up to 10 products in parallel (with limit)
    const toFetch = products.slice(0, 15);
    const promises = toFetch.map(
      (p) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "fetchDetail", url: p.url },
            (response) => {
              if (response && response.ok) {
                p.description = response.data.description || "";
                p.bullets = response.data.bullets || "";
                p.color = response.data.color || "";
              }
              resolve();
            }
          );
        })
    );

    await Promise.all(promises);
  }

  // ── Call Re-Rank API ────────────────────────────────────────────────────
  async function callRerankAPI(products, query) {
    const payload = {
      query: query,
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
        if (response && response.ok) resolve(response.data);
        else reject(new Error(response ? response.error : "No response from background"));
      });
    });
  }

  // ── Reorder DOM ─────────────────────────────────────────────────────────
  function reorderDOM(products, rankedResults) {
    // Map asin → result data
    const resultMap = {};
    rankedResults.results.forEach((r) => {
      resultMap[r.product_id] = r;
    });

    // Get the search results container
    const container = products[0]?.element?.parentElement;
    if (!container) return;

    // Save original order
    originalOrder = products.map((p) => ({
      asin: p.asin,
      element: p.element,
    }));

    // Sort products by new_rank
    const sorted = [...products].sort((a, b) => {
      const ra = resultMap[a.asin]?.new_rank ?? 999;
      const rb = resultMap[b.asin]?.new_rank ?? 999;
      return ra - rb;
    });

    // Animate: first capture current positions
    const positions = new Map();
    products.forEach((p) => {
      const rect = p.element.getBoundingClientRect();
      positions.set(p.asin, { top: rect.top, left: rect.left });
    });

    // Reorder DOM elements
    sorted.forEach((p) => {
      container.appendChild(p.element);
    });

    // Animate from old position to new (FLIP technique)
    sorted.forEach((p) => {
      const oldPos = positions.get(p.asin);
      const newRect = p.element.getBoundingClientRect();
      if (oldPos) {
        const dx = oldPos.left - newRect.left;
        const dy = oldPos.top - newRect.top;
        p.element.style.transform = `translate(${dx}px, ${dy}px)`;
        p.element.style.transition = "none";
        // Force reflow
        p.element.offsetHeight;
        p.element.style.transition = "transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        p.element.style.transform = "translate(0, 0)";
      }
    });

    // Add rank badges + score overlays
    sorted.forEach((p) => {
      const result = resultMap[p.asin];
      if (!result) return;
      addRankBadge(p.element, result);
    });

    isReranked = true;
    updateFABState();
  }

  // ── Rank Badge on Card ──────────────────────────────────────────────────
  function addRankBadge(element, result) {
    // Remove existing badge
    const existing = element.querySelector(".srr-badge");
    if (existing) existing.remove();

    const change = result.rank_change;
    let changeClass = "srr-badge-neutral";
    let changeText = "→ 0";
    if (change > 0) {
      changeClass = "srr-badge-up";
      changeText = `↑ ${change}`;
    } else if (change < 0) {
      changeClass = "srr-badge-down";
      changeText = `↓ ${Math.abs(change)}`;
    }

    const badge = document.createElement("div");
    badge.className = "srr-badge";
    badge.innerHTML = `
      <div class="srr-badge-rank">#${result.new_rank}</div>
      <div class="srr-badge-change ${changeClass}">${changeText}</div>
      <div class="srr-badge-scores">
        <div class="srr-score-row">
          <span>Rel</span>
          <div class="srr-score-bar"><div class="srr-score-fill srr-score-rel" style="width:${(result.relevance_score * 100).toFixed(0)}%"></div></div>
          <span>${(result.relevance_score * 100).toFixed(0)}%</span>
        </div>
        <div class="srr-score-row">
          <span>Trust</span>
          <div class="srr-score-bar"><div class="srr-score-fill srr-score-trust" style="width:${(result.trust_score * 100).toFixed(0)}%"></div></div>
          <span>${(result.trust_score * 100).toFixed(0)}%</span>
        </div>
      </div>
    `;
    element.style.position = "relative";
    element.appendChild(badge);
  }

  // ── Restore Original Order ──────────────────────────────────────────────
  function restoreOriginalOrder() {
    if (!originalOrder.length) return;

    const container = originalOrder[0].element.parentElement;

    // Capture current positions
    const positions = new Map();
    originalOrder.forEach((item) => {
      const rect = item.element.getBoundingClientRect();
      positions.set(item.asin, { top: rect.top, left: rect.left });
    });

    // Restore original DOM order
    originalOrder.forEach((item) => {
      container.appendChild(item.element);
    });

    // Animate
    originalOrder.forEach((item) => {
      const oldPos = positions.get(item.asin);
      const newRect = item.element.getBoundingClientRect();
      if (oldPos) {
        const dx = oldPos.left - newRect.left;
        const dy = oldPos.top - newRect.top;
        item.element.style.transform = `translate(${dx}px, ${dy}px)`;
        item.element.style.transition = "none";
        item.element.offsetHeight;
        item.element.style.transition = "transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        item.element.style.transform = "translate(0, 0)";
      }

      // Remove badges
      const badge = item.element.querySelector(".srr-badge");
      if (badge) badge.remove();
    });

    isReranked = false;
    updateFABState();
  }

  // ── Update FAB appearance ───────────────────────────────────────────────
  function updateFABState() {
    const btn = document.getElementById("srr-rerank-btn");
    if (!btn) return;
    if (isReranked) {
      btn.classList.add("srr-reranked");
      btn.querySelector("span").textContent = "Restore";
    } else {
      btn.classList.remove("srr-reranked");
      btn.querySelector("span").textContent = "Re-Rank";
    }
  }

  // ── Extract query from Amazon URL ───────────────────────────────────────
  function getSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get("k") || "";
  }

  // ── Main Re-Rank Flow ──────────────────────────────────────────────────
  async function runRerank() {
    const query = getSearchQuery();
    if (!query) {
      alert("Could not detect search query.");
      return;
    }

    showPipeline();

    try {
      // Step 0: Scrape
      setPipelineStep(0);
      const products = scrapeProducts();
      if (products.length === 0) {
        alert("No products found on this page.");
        removePipeline();
        return;
      }
      await sleep(300);

      // Step 1: Fetch details
      setPipelineStep(1);
      await fetchProductDetails(products);
      await sleep(200);

      // Step 2-4: API handles feature extraction + scoring + trust
      setPipelineStep(2);
      await sleep(350);
      setPipelineStep(3);
      await sleep(350);
      setPipelineStep(4);

      const apiResult = await callRerankAPI(products, query);
      await sleep(200);

      // Step 5: Reorder
      setPipelineStep(5);
      await sleep(300);

      lastMetrics = apiResult;
      const sponsoredBefore = products.filter((p) => p.sponsored).length;
      const sponsoredAfter = apiResult.results
        .slice(0, 5)
        .filter((r) => r.sponsored).length;

      reorderDOM(products, apiResult);
      removePipeline();
      showMetrics(apiResult, sponsoredBefore, sponsoredAfter);
    } catch (err) {
      removePipeline();
      console.error("[Search Re-Ranker]", err);
      showError("Failed to re-rank. Is the FastAPI backend running on localhost:8000?");
    }
  }

  // ── Error toast ─────────────────────────────────────────────────────────
  function showError(msg) {
    const toast = document.createElement("div");
    toast.className = "srr-toast srr-toast-error";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Init ────────────────────────────────────────────────────────────────
  injectFAB();
  console.log("[Search Re-Ranker] Content script loaded on Amazon search page.");
})();

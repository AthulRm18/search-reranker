// ── Search Re-Ranker — Content Script ─────────────────────────────────────
// Runs on Amazon search result pages. Scrapes products, calls re-ranker API
// via background script, and reorders the DOM with animations.
//
// Tested on: amazon.com, amazon.in, amazon.co.uk

(function () {
  "use strict";

  // Prevent double injection
  if (window.__searchRerankerInjected) return;
  window.__searchRerankerInjected = true;

  const LOG = (...args) => console.log("[Search Re-Ranker]", ...args);
  const ORIGIN = window.location.origin; // e.g. https://www.amazon.in

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

  // ══════════════════════════════════════════════════════════════════════════
  //  SCRAPER — multi-selector with fallbacks for .com / .in / .co.uk
  // ══════════════════════════════════════════════════════════════════════════

  function scrapeProducts() {
    // --- Step 1: Find all product cards ---
    // Try selectors in order of specificity. Amazon uses different structures
    // across regions and layout versions.
    const CARD_SELECTORS = [
      '[data-component-type="s-search-result"]',              // .com standard
      '[data-cel-widget^="search_result_"]',                  // .in common
      '.s-result-item[data-asin]',                            // generic fallback
      '[data-asin][data-index]',                              // index-based
      '.sg-col-4-of-24 [data-asin], .sg-col-4-of-20 [data-asin]', // grid layout
    ];

    let cards = [];
    for (const sel of CARD_SELECTORS) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = Array.from(found);
        LOG(`Found ${cards.length} products using selector: ${sel}`);
        break;
      }
    }

    // Last resort: any element with data-asin inside the main search area
    if (cards.length === 0) {
      const mainSlot = document.querySelector('.s-main-slot, #search, [data-component-type="s-search-results"]');
      if (mainSlot) {
        cards = Array.from(mainSlot.querySelectorAll('[data-asin]'));
        LOG(`Fallback: found ${cards.length} [data-asin] elements inside main search area`);
      }
    }

    if (cards.length === 0) {
      // Ultra fallback: just grab all data-asin on the page, filter out tiny ones
      cards = Array.from(document.querySelectorAll('[data-asin]')).filter(
        (el) => el.offsetHeight > 100 && el.getAttribute("data-asin").length > 3
      );
      LOG(`Ultra fallback: found ${cards.length} visible [data-asin] elements`);
    }

    // --- Step 2: Extract data from each card ---
    const products = [];
    const seenAsins = new Set();

    cards.forEach((card, index) => {
      const asin = card.getAttribute("data-asin");
      if (!asin || asin.length < 3 || seenAsins.has(asin)) return;
      seenAsins.add(asin);

      // ── Title ──
      // Try many selectors — Amazon varies a LOT
      const TITLE_SELECTORS = [
        'h2 a span.a-text-normal',
        'h2 a span',
        'h2 span.a-text-normal',
        'h2 span',
        '[data-cy="title-recipe"] h2 span',
        '.a-size-medium.a-text-normal',
        '.a-size-base-plus.a-text-normal',
        'a.a-link-normal .a-text-normal',
        '.a-size-mini h2 a span',
        'h2',
      ];

      let title = "";
      for (const sel of TITLE_SELECTORS) {
        const el = card.querySelector(sel);
        if (el && el.textContent.trim().length > 5) {
          title = el.textContent.trim();
          break;
        }
      }
      if (!title) {
        LOG(`Skipping ASIN ${asin}: no title found`);
        return;
      }

      // ── Brand ──
      let brand = "";
      const BRAND_SELECTORS = [
        '.a-row .a-size-base-plus',
        '.s-line-clamp-1 .a-size-base',
        'span.a-size-base:first-of-type',
        '.a-row .a-size-base',
        '[data-cy="reviews-block"] ~ div .a-size-base',
      ];
      for (const sel of BRAND_SELECTORS) {
        const el = card.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          // Filter out things that are clearly not brand names
          if (text.length > 0 && text.length < 60 && !text.includes("₹") && !text.includes("$") && !text.includes("star")) {
            brand = text;
            break;
          }
        }
      }

      // ── Sponsored Detection ──
      // Check for sponsored markers — handle English, Hindi, and other languages
      const SPONSORED_SELECTORS = [
        '.puis-label-popover-default',
        '.s-label-popover-default',
        '[data-component-type="sp-sponsored-result"]',
        '.a-color-secondary:first-child',
      ];

      let sponsored = false;
      // Selector-based check
      for (const sel of SPONSORED_SELECTORS) {
        const el = card.querySelector(sel);
        if (el) {
          const t = el.textContent.trim().toLowerCase();
          if (t.includes("sponsor") || t === "sponsored" || t.includes("प्रायोजित")) {
            sponsored = true;
            break;
          }
        }
      }
      // Text-based fallback: check first 300 chars of card text
      if (!sponsored) {
        const topText = card.textContent.slice(0, 300).toLowerCase();
        sponsored = /\bsponsored\b/.test(topText) || topText.includes("प्रायोजित");
      }

      // ── Product URL ──
      const linkEl = card.querySelector("h2 a, a.a-link-normal[href*='/dp/']");
      const url = linkEl ? linkEl.href : `${ORIGIN}/dp/${asin}`;

      products.push({
        asin,
        title: title.slice(0, 200),
        brand,
        sponsored,
        url,
        original_rank: index + 1,
        element: card,
        description: "",
        bullets: "",
        color: "",
      });
    });

    LOG(`Scraped ${products.length} products (${products.filter(p => p.sponsored).length} sponsored)`);
    return products;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DETAIL FETCHER — same-origin fetch + DOMParser
  // ══════════════════════════════════════════════════════════════════════════

  async function fetchProductDetails(products) {
    const toFetch = products.slice(0, 15);
    let fetched = 0;

    // Batch in groups of 3 to be polite
    for (let i = 0; i < toFetch.length; i += 3) {
      const batch = toFetch.slice(i, i + 3);
      await Promise.all(batch.map((p) => fetchSingleDetail(p)));
      fetched += batch.length;
    }

    LOG(`Fetched details for ${fetched} products`);
  }

  async function fetchSingleDetail(product) {
    try {
      const resp = await fetch(product.url, {
        credentials: "same-origin",
        headers: { "Accept": "text/html" },
      });
      if (!resp.ok) return;
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // ── Description ──
      const DESC_SELECTORS = [
        "#productDescription p",
        "#productDescription",
        "#productDescription_feature_div p",
        "#productDescription_feature_div",
        "#aplus_feature_div",
      ];
      for (const sel of DESC_SELECTORS) {
        const el = doc.querySelector(sel);
        if (el && el.textContent.trim().length > 20) {
          product.description = el.textContent.trim().slice(0, 500);
          break;
        }
      }

      // ── Bullet Points ──
      const BULLET_SELECTORS = [
        "#feature-bullets ul li span.a-list-item",
        "#feature-bullets ul li",
        ".a-unordered-list .a-list-item",
      ];
      for (const sel of BULLET_SELECTORS) {
        const els = doc.querySelectorAll(sel);
        if (els.length > 0) {
          product.bullets = Array.from(els)
            .map((el) => el.textContent.trim())
            .filter((t) => t.length > 5 && t.length < 500)
            .slice(0, 10)
            .join(" | ")
            .slice(0, 500);
          if (product.bullets.length > 20) break;
        }
      }

      // ── Color ──
      const overviewRows = doc.querySelectorAll(
        "#productOverview_feature_div tr, #detailBullets_feature_div li, #poExpander tr, .prodDetTable tr"
      );
      for (const row of overviewRows) {
        const text = row.textContent.toLowerCase();
        if (text.includes("color") || text.includes("colour")) {
          // Get all text nodes / spans and pick the value (usually second column)
          const cells = row.querySelectorAll("td span, td, span.a-text-bold + span");
          if (cells.length >= 2) {
            product.color = cells[cells.length - 1].textContent.trim().slice(0, 50);
            break;
          }
        }
      }
    } catch (err) {
      LOG(`Could not fetch details for ${product.asin}: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  API INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

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
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.ok) resolve(response.data);
        else reject(new Error(response ? response.error : "No response from background"));
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DOM REORDERING — FLIP animation technique
  // ══════════════════════════════════════════════════════════════════════════

  function reorderDOM(products, rankedResults) {
    const resultMap = {};
    rankedResults.results.forEach((r) => {
      resultMap[r.product_id] = r;
    });

    // Find the right container — the common parent of all product cards
    const container = findCommonParent(products.map((p) => p.element));
    if (!container) {
      LOG("Could not find common parent container for reordering");
      return;
    }

    // Save original order
    originalOrder = products.map((p) => ({
      asin: p.asin,
      element: p.element,
    }));

    // Sort by new_rank
    const sorted = [...products].sort((a, b) => {
      const ra = resultMap[a.asin]?.new_rank ?? 999;
      const rb = resultMap[b.asin]?.new_rank ?? 999;
      return ra - rb;
    });

    // FLIP: capture current positions
    const positions = new Map();
    products.forEach((p) => {
      const rect = p.element.getBoundingClientRect();
      positions.set(p.asin, { top: rect.top, left: rect.left });
    });

    // Reorder DOM
    sorted.forEach((p) => {
      container.appendChild(p.element);
    });

    // FLIP: animate from old to new position
    sorted.forEach((p) => {
      const oldPos = positions.get(p.asin);
      const newRect = p.element.getBoundingClientRect();
      if (oldPos) {
        const dx = oldPos.left - newRect.left;
        const dy = oldPos.top - newRect.top;
        p.element.style.transform = `translate(${dx}px, ${dy}px)`;
        p.element.style.transition = "none";
        p.element.offsetHeight; // force reflow
        p.element.style.transition = "transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        p.element.style.transform = "translate(0, 0)";
      }
    });

    // Add rank badges
    sorted.forEach((p) => {
      const result = resultMap[p.asin];
      if (result) addRankBadge(p.element, result);
    });

    isReranked = true;
    updateFABState();
    LOG(`Reordered ${sorted.length} products`);
  }

  // Find the closest common parent of all elements
  function findCommonParent(elements) {
    if (!elements.length) return null;
    if (elements.length === 1) return elements[0].parentElement;

    // If all share the same parent, use that
    const firstParent = elements[0].parentElement;
    if (elements.every((el) => el.parentElement === firstParent)) {
      return firstParent;
    }

    // Otherwise walk up from first element and find first ancestor containing all
    let ancestor = firstParent;
    while (ancestor && ancestor !== document.body) {
      if (elements.every((el) => ancestor.contains(el))) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    return firstParent; // fallback
  }

  // ── Rank Badge ──────────────────────────────────────────────────────────
  function addRankBadge(element, result) {
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

    const container = findCommonParent(originalOrder.map((i) => i.element));

    const positions = new Map();
    originalOrder.forEach((item) => {
      const rect = item.element.getBoundingClientRect();
      positions.set(item.asin, { top: rect.top, left: rect.left });
    });

    originalOrder.forEach((item) => {
      container.appendChild(item.element);
    });

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

      const badge = item.element.querySelector(".srr-badge");
      if (badge) badge.remove();
    });

    isReranked = false;
    updateFABState();
    LOG("Restored original order");
  }

  // ── FAB State ───────────────────────────────────────────────────────────
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

  // ── Extract Query ───────────────────────────────────────────────────────
  function getSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get("k") || params.get("field-keywords") || "";
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MAIN FLOW
  // ══════════════════════════════════════════════════════════════════════════

  async function runRerank() {
    const query = getSearchQuery();
    if (!query) {
      showError("Could not detect search query from URL.");
      return;
    }

    showPipeline();

    try {
      // Step 0: Scrape
      setPipelineStep(0);
      await sleep(200);
      const products = scrapeProducts();
      if (products.length === 0) {
        removePipeline();
        showError(
          `No products found. The scraper found 0 product cards.\n` +
          `Debug: data-asin count = ${document.querySelectorAll('[data-asin]').length}, ` +
          `s-search-result count = ${document.querySelectorAll('[data-component-type="s-search-result"]').length}, ` +
          `cel-widget count = ${document.querySelectorAll('[data-cel-widget^="search_result_"]').length}`
        );
        return;
      }
      await sleep(300);

      // Step 1: Fetch details
      setPipelineStep(1);
      await fetchProductDetails(products);
      await sleep(200);

      // Step 2-4: API
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
      const sponsoredAfter = apiResult.results.slice(0, 5).filter((r) => r.sponsored).length;

      reorderDOM(products, apiResult);
      removePipeline();
      showMetrics(apiResult, sponsoredBefore, sponsoredAfter);
    } catch (err) {
      removePipeline();
      LOG("Error:", err);
      showError("Re-rank failed: " + err.message);
    }
  }

  // ── Error Toast ─────────────────────────────────────────────────────────
  function showError(msg) {
    LOG("ERROR:", msg);
    const toast = document.createElement("div");
    toast.className = "srr-toast srr-toast-error";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 7000);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Init ────────────────────────────────────────────────────────────────
  injectFAB();
  LOG(`Loaded on ${ORIGIN}. data-asin elements: ${document.querySelectorAll('[data-asin]').length}`);
})();

// ─────────────────────────────────────────────────────────────────────────────
//  ReRank — Signal Intelligence Terminal
//  Precision Instrument aesthetic: Authoritative · Precise · Trustworthy
//  Fonts: Syne (wordmark) · DM Sans (UI) · IBM Plex Mono (data)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react"
import axios from "axios"
import "./App.css"
import {
  Search, Shield, Zap, TrendingUp, ArrowUp, ArrowDown,
  Loader2, Check, ChevronDown,
} from "lucide-react"

const API_BASE = import.meta.env.VITE_API_URL || "";

// ── Brand Logo — matches extension icon (up/down arrows) ─────────────────
function ReRankLogo({ size = 28, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="ReRank logo"
      role="img"
    >
      {/* Up arrow */}
      <path d="m3 16 4 4 4-4" stroke="var(--accent, #00D47E)" />
      <path d="M7 20V4"       stroke="var(--accent, #00D47E)" />
      {/* Down arrow */}
      <path d="m21 8-4-4-4 4" stroke="var(--text-muted, #5C6B82)" />
      <path d="M17 4v16"      stroke="var(--text-muted, #5C6B82)" />
    </svg>
  )
}

// ── Pipeline Steps Config ────────────────────────────────────────────────
const STEPS = [
  { label: "Features",    desc: "11 lexical signals" },
  { label: "LambdaMART",  desc: "Relevance scoring" },
  { label: "Trust Check", desc: "Review risk signals" },
  { label: "Fusion",      desc: "Objective blend" },
  { label: "Re-Rank",     desc: "Final ordering" },
]

// ── Pipeline Bar ─────────────────────────────────────────────────────────
function PipelineBar({ step }) {
  if (step < 0) return null
  return (
    <div className="rr-pipeline">
      <div className="rr-pipeline-steps">
        {STEPS.map((s, i) => {
          const done   = step > i
          const active = step === i
          return (
            <div
              key={s.label}
              className="rr-pipeline-step-wrap"
            >
              <div className="rr-pipeline-step">
                <div
                  className={`rr-pipeline-dot${active ? " rr-pipeline-dot--active" : ""}${done ? " rr-pipeline-dot--done" : ""}`}
                >
                  {done
                    ? <Check size={13} strokeWidth={2.5} />
                    : i + 1}
                </div>
                <span
                  className={`rr-pipeline-label${active || done ? " rr-pipeline-label--active" : ""}`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="rr-pipeline-connector">
                  <div
                    className={`rr-pipeline-connector-fill${done ? " rr-pipeline-connector-fill--done" : ""}${active ? " rr-pipeline-connector-fill--active" : ""}`}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Animated Number ──────────────────────────────────────────────────────
function AnimatedNum({ value, decimals = 4 }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef(null)
  useEffect(() => {
    const target = typeof value === "number" ? value : parseFloat(value) || 0
    const start = performance.now()
    const run = (now) => {
      const p = Math.min((now - start) / 900, 1)
      setDisplay(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf.current = requestAnimationFrame(run)
    }
    raf.current = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf.current)
  }, [value])
  return <>{display.toFixed(decimals)}</>
}

// ── Score Bar ────────────────────────────────────────────────────────────
function ScoreBar({ label, value, variant = "accent", delay = 0 }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(value * 100), 150 + delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return (
    <div className="rr-score-bar-wrap">
      <div className="rr-score-bar-header">
        <span className="rr-score-bar-label">{label}</span>
        <span className="rr-score-bar-value">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="rr-score-bar-track">
        <div
          className={`rr-score-bar-fill rr-score-bar-fill--${variant}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

// ── Product Card ─────────────────────────────────────────────────────────
function ProductCard({ product, rank, showScores, animating, delay }) {
  const rankChange  = product.rank_change ?? 0
  const isSponsored = product.sponsored
  const cardClass   = `rr-product${isSponsored ? " rr-product--sponsored" : ""}${animating ? " rr-product--animate" : ""}`

  return (
    <div
      className={cardClass}
      style={animating ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div className="rr-product-layout">
        {/* Rank Column */}
        <div className="rr-rank-col">
          <span className="rr-rank-num">#{rank}</span>
          {showScores && rankChange > 0 && (
            <span className="rr-rank-change rr-rank-change--up">
              <ArrowUp size={9} strokeWidth={3} />{rankChange}
            </span>
          )}
          {showScores && rankChange < 0 && (
            <span className="rr-rank-change rr-rank-change--down">
              <ArrowDown size={9} strokeWidth={3} />{Math.abs(rankChange)}
            </span>
          )}
          {showScores && rankChange === 0 && (
            <span className="rr-rank-change--same">–</span>
          )}
        </div>

        {/* Product Detail */}
        <div className="rr-product-detail">
          <div className="rr-product-meta">
            <span className="rr-product-brand">
              {product.product_brand && product.product_brand !== "nan"
                ? product.product_brand
                : "Generic"}
            </span>
            {isSponsored && (
              <span className="rr-product-sponsored-tag">Ad</span>
            )}
          </div>
          <p className="rr-product-title">{product.product_title}</p>

          {showScores && (
            <div className="rr-product-scores">
              <ScoreBar
                label="Relevance"
                value={product.relevance_score ?? 0}
                variant="signal"
                delay={delay}
              />
              <div className="rr-product-final">
                <span className="rr-product-final-score">
                  score <strong>{(product.final_score ?? 0).toFixed(4)}</strong>
                </span>
                <span className="rr-product-final-prev">
                  was #{product.original_rank}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Metric Tile ──────────────────────────────────────────────────────────
function MetricTile({ label, value, sub, numeric }) {
  return (
    <div className="rr-metric-tile">
      <div style={{ minWidth: 0 }}>
        <div className="rr-metric-label">{label}</div>
        <div className="rr-metric-value">
          {numeric ? <AnimatedNum value={value} /> : value}
        </div>
        <div className="rr-metric-sub">{sub}</div>
      </div>
    </div>
  )
}

// ── Column Header ────────────────────────────────────────────────────────
function ColHeader({ dotColor, title, badge, pulse }) {
  return (
    <div className="rr-col-header">
      <span
        className={`rr-col-dot${pulse ? " rr-col-dot--pulse" : ""}`}
        style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
      />
      <span className="rr-col-title">{title}</span>
      <span
        className="rr-col-badge"
        style={{
          color:       badge.color,
          background:  badge.bg,
          borderColor: badge.border,
        }}
      >
        {badge.text}
      </span>
    </div>
  )
}

// ── Mode Select ──────────────────────────────────────────────────────────
function ModeSelect({ value, onChange }) {
  return (
    <div className="rr-mode-wrap">
      <select
        className="rr-mode-select"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Ranking mode"
      >
        <option value="balanced">Balanced</option>
        <option value="relevance">Relevance Max</option>
        <option value="fair">Max Fairness</option>
      </select>
      <ChevronDown size={12} className="rr-mode-chevron" />
    </div>
  )
}

// ── Empty State ──────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, line1, line2 }) {
  return (
    <div className="rr-empty">
      <Icon size={36} strokeWidth={1.2} className="rr-empty-icon" />
      <p className="rr-empty-line1">{line1}</p>
      {line2 && <p className="rr-empty-line2">{line2}</p>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [query,        setQuery]        = useState("wireless headphones")
  const [mode,         setMode]         = useState("balanced")
  const [loading,      setLoading]      = useState(false)
  const [searching,    setSearching]    = useState(false)
  const [original,     setOriginal]     = useState([])
  const [reranked,     setReranked]     = useState([])
  const [metrics,      setMetrics]      = useState(null)
  const [animating,    setAnimating]    = useState(false)
  const [error,        setError]        = useState(null)
  const [totalMatches, setTotalMatches] = useState(0)
  const [pipeStep,     setPipeStep]     = useState(-1)
  const [showLoadModal,     setShowLoadModal]     = useState(true)

  const runPipeline = useCallback((cb) => {
    STEPS.forEach((_, i) => setTimeout(() => setPipeStep(i), i * 400))
    setTimeout(cb, STEPS.length * 400)
  }, [])

  // ── Search ──
  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    setReranked([])
    setMetrics(null)
    setAnimating(false)
    try {
      const res = await axios.get(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&n=10`)
      setOriginal(res.data.products)
      setTotalMatches(res.data.total_matches)
    } catch {
      setError("Search failed — is the FastAPI service running on port 8000?")
    } finally {
      setSearching(false)
    }
  }

  // ── Rerank ──
  const handleRerank = async () => {
    if (!original.length) return
    setLoading(true)
    setError(null)
    setAnimating(false)
    try {
      const res = await axios.post(`${API_BASE}/api/rerank`, { query, products: original, mode })
      runPipeline(() => {
        setTimeout(() => {
          setReranked(res.data.results)
          setMetrics(res.data)
          setAnimating(true)
          setLoading(false)
          setPipeStep(-1)
        }, 300)
      })
    } catch {
      setError("Ranking computation failed.")
      setLoading(false)
      setPipeStep(-1)
    }
  }

  const sponsoredOriginal = original.filter(p => p.sponsored).length
  const sponsoredReranked = reranked.slice(0, 5).filter(p => p.sponsored).length

  // ── CSS variable values for inline color references ──
  const C = {
    accent:    "var(--accent)",
    signal:    "var(--signal)",
    warn:      "var(--warn)",
    textMuted: "var(--text-muted)",
    text:      "var(--text)",
    elevated:  "var(--elevated)",
    border:    "var(--border)",
    accentDim: "var(--accent-dim)",
    accentBorder: "var(--accent-border)",
    signalDim: "var(--signal-dim)",
    signalBorder: "var(--signal-border)",
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", paddingBottom: 64 }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <header className="rr-header">
        <div className="rr-header-inner">
          {/* Brand */}
          <div className="rr-brand">
            <div className="rr-brand-icon">
              <ReRankLogo size={20} />
            </div>
            <div className="rr-brand-text">
              <h1>ReRank</h1>
            </div>
          </div>

          {/* Controls */}
          <div className="rr-controls">
            <div className="rr-search-wrap">
              <Search size={13} className="rr-search-icon" />
              <input
                className="rr-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Search products…"
                aria-label="Search query"
              />
            </div>

            <button
              className="rr-btn rr-btn--secondary"
              onClick={handleSearch}
              disabled={searching}
              aria-label="Load results"
            >
              {searching
                ? <Loader2 size={13} className="rr-spin" />
                : <Search size={13} />}
              Load
            </button>

            <ModeSelect value={mode} onChange={setMode} />

            <button
              className="rr-btn rr-btn--primary"
              onClick={handleRerank}
              disabled={loading || !original.length}
              aria-label="Run ranking optimization"
            >
              {loading
                ? <Loader2 size={13} className="rr-spin" />
                : <ReRankLogo size={14} />}
              Optimize
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────── */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px 0" }}>
        {/* Error */}
        {error && (
          <div className="rr-error" role="alert">
            <span className="rr-error-dot" />
            {error}
          </div>
        )}

        {/* Pipeline */}
        <PipelineBar step={pipeStep} />

        {/* Metrics */}
        {metrics && (
          <div className="rr-metrics-strip">
            <MetricTile
              label="Baseline NDCG@10"
              value={metrics.baseline_ndcg}
              sub="Unoptimized ranking score"
              numeric
            />
            <MetricTile
              label="Optimized NDCG@10"
              value={metrics.optimized_ndcg}
              sub="Model-ordered ranking score"
              numeric
            />
            <MetricTile
              label="Ads in top 10 (before)"
              value={`${sponsoredOriginal} / 10`}
              sub="Sponsored before re-rank"
            />
            <MetricTile
              label="Ads in top 5 (after)"
              value={`${sponsoredReranked} / 5`}
              sub="Sponsored after re-rank"
            />
          </div>
        )}

        {/* Match Info */}
        {totalMatches > 0 && (
          <div className="rr-match-info">
            <span className="rr-match-dot" />
            Matched
            <span className="rr-match-count">{totalMatches.toLocaleString()}</span>
            products for
            <span className="rr-match-query">"{query}"</span>
          </div>
        )}

        {/* Results Grid */}
        <div className="rr-results-grid">
          {/* Original Results Column */}
          <div className="rr-column">
            <ColHeader
              dotColor="var(--text-muted)"
              title="Standard Search Results"
              badge={{
                text: "Original",
                color: "var(--text-muted)",
                bg:   "var(--elevated)",
                border: "var(--border)",
              }}
              pulse={false}
            />
            <div className="rr-col-body">
              {original.length === 0
                ? (
                  <EmptyState
                    icon={Search}
                    line1="Ready. Enter a search query above."
                    line2="Results will appear here after loading."
                  />
                )
                : original.map((p, i) => (
                  <ProductCard
                    key={p.product_id}
                    product={p}
                    rank={i + 1}
                    showScores={false}
                    animating={false}
                    delay={0}
                  />
                ))}
            </div>
          </div>

          {/* Optimized Results Column */}
          <div className="rr-column">
            <ColHeader
              dotColor="var(--accent)"
              title="Rank-Optimized Results"
              badge={{
                text: "Optimized",
                color: "var(--accent)",
                bg:   "var(--accent-dim)",
                border: "var(--accent-border)",
              }}
              pulse
            />
            <div className="rr-col-body">
              {reranked.length === 0
                ? (
                  <EmptyState
                    icon={Shield}
                    line1={original.length
                      ? "Click Optimize to run the pipeline."
                      : "Awaiting search results…"}
                    line2={original.length
                      ? "LambdaMART + trust scoring will re-order results."
                      : undefined}
                  />
                )
                : reranked.map((p, i) => (
                  <ProductCard
                    key={p.product_id}
                    product={p}
                    rank={i + 1}
                    showScores
                    animating={animating}
                    delay={i * 55}
                  />
                ))}
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="rr-footer">
        <div className="rr-footer-brand">
          <ReRankLogo size={16} />
          ReRank
        </div>
      </footer>

      {/* ── Welcome/Load Modal ───────────────────────────────── */}
      {showLoadModal && (
        <div className="rr-modal-overlay">
          <div className="rr-modal-card" style={{ maxWidth: 500, padding: 28 }}>
            <div className="rr-modal-header" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="rr-modal-title" style={{ fontSize: 20, fontWeight: 700, textTransform: "none", letterSpacing: "-0.02em" }}>
                  Search Re-Ranker
                </span>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>
                  Amazon's search algorithm is optimized for seller revenue — not for you. This system fixes that.
                </span>
              </div>
            </div>
            <div className="rr-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)", marginBottom: 4 }}>
                  How it works:
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
                  Real Amazon search results get scraped and passed through a LambdaMART ranking model trained on 1.4 million Amazon query-product pairs. A multi-objective optimizer (NSGA-II) then finds the best trade-off between three signals simultaneously — relevance to your query, review authenticity, and price fairness — rather than maximizing any single metric. Sponsored products get penalized unless they genuinely match your search.
                </p>
              </div>
              <div>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)", marginBottom: 4 }}>
                  What's different:
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
                  Most re-ranking systems optimize one objective. This one runs a Pareto optimization across three competing signals and picks the solution closest to the utopia point — the same approach used in production recommendation systems at scale.
                </p>
              </div>
              <div>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)", marginBottom: 4 }}>
                  Numbers:
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
                  <strong>NDCG@10 of 0.9114</strong> on the Amazon ESCI benchmark — Amazon's own human-labeled relevance dataset with 1.8M query-product pairs. Sponsored product bias reduced by <strong>~31%</strong> in top-5 results.
                </p>
              </div>
              <div>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)", marginBottom: 4 }}>
                  Stack:
                </div>
                <p style={{ margin: 0, fontSize: 11.5, fontFamily: "var(--font-mono)", lineHeight: 1.5, color: "var(--text-muted)" }}>
                  LightGBM LambdaMART · NSGA-II (pymoo) · Isolation Forest fake review detector · FastAPI · React · Amazon ESCI Dataset
                </p>
              </div>
            </div>
            <div className="rr-modal-footer" style={{ marginTop: 8 }}>
              <button
                className="rr-btn rr-btn--primary"
                onClick={() => setShowLoadModal(false)}
                style={{ width: "100%", justifyContent: "center" }}
              >
                See it in action →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

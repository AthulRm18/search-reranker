import { useState, useEffect, useRef, useCallback } from "react"
import axios from "axios"
import { Search, Shield, Zap, TrendingUp, ArrowUp, ArrowDown, Minus, Loader2 } from "lucide-react"

// ── pipeline steps (the real-time ML visualization) ───────────────────────
const STEPS = [
  { label: "Feature Extraction", desc: "11 lexical features" },
  { label: "LambdaMART",         desc: "Relevance scoring" },
  { label: "Trust Scoring",      desc: "Isolation Forest" },
  { label: "NSGA-II Optimize",   desc: "Multi-objective" },
  { label: "Re-Ranking",         desc: "Final ordering" },
]

function PipelineBar({ step }) {
  if (step < 0) return null
  return (
    <div className="mb-4 p-3 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const done    = step > i
          const active  = step === i
          const pending = step < i
          return (
            <div key={s.label} className="flex items-center flex-1">
              <div className={`flex-1 rounded-lg px-2 py-1.5 text-center transition-all duration-300 ${
                done   ? "bg-emerald-50 border border-emerald-200" :
                active ? "bg-blue-50 border border-blue-300 shadow-sm" :
                         "bg-gray-50 border border-gray-100"
              }`}>
                <p className={`text-[10px] font-semibold ${
                  done ? "text-emerald-600" : active ? "text-blue-600" : "text-gray-400"
                }`}>
                  {done ? "✓ " : active ? "⟳ " : ""}{s.label}
                </p>
                {active && (
                  <p className="text-[8px] text-blue-400 mt-0.5">{s.desc}</p>
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-3 h-0.5 mx-0.5 rounded ${done ? "bg-emerald-300" : "bg-gray-200"}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── animated counter ──────────────────────────────────────────────────────
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

// ── animated card (original structure kept) ───────────────────────────────
function ProductCard({ product, rank, showScores, animating, delay }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  const rankChange = product.rank_change ?? 0

  return (
    <div
      className="transition-all duration-500 ease-out"
      style={{
        opacity:    animating ? (visible ? 1 : 0) : 1,
        transform:  animating ? (visible ? "translateY(0)" : "translateY(16px)") : "none",
      }}
    >
      <div className={`p-3 rounded-xl border text-sm mb-2 transition-all duration-300
        ${product.sponsored
          ? "border-yellow-300 bg-yellow-50 shadow-sm"
          : "border-gray-200 bg-white shadow-sm"}`}>

        <div className="flex items-start gap-2">
          <span className="text-gray-400 font-mono text-xs w-5 shrink-0 pt-0.5">#{rank}</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-800 text-xs leading-snug line-clamp-2">
              {product.product_title}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {product.product_brand && product.product_brand !== "nan" && (
                <span className="text-gray-400 text-xs">{product.product_brand}</span>
              )}
              {product.sponsored && (
                <span className="inline-flex items-center gap-0.5 text-yellow-700 bg-yellow-100 text-xs px-1.5 py-0.5 rounded">
                  <Zap size={9} /> Sponsored
                </span>
              )}
            </div>

            {showScores && (
              <div className="mt-2 space-y-1">
                <ScoreRow label="Relevance" value={product.relevance_score ?? 0} color="bg-blue-400" delay={delay} />
                <ScoreRow label="Trust"     value={product.trust_score ?? 0}     color="bg-emerald-400" delay={delay + 120} />
                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                  <span>Final: <span className="font-mono font-semibold text-gray-600">{(product.final_score ?? 0).toFixed(4)}</span></span>
                  <span>Was #{product.original_rank}</span>
                </div>
              </div>
            )}
          </div>

          {showScores && (
            <div className="shrink-0">
              {rankChange > 0  && <span className="flex items-center gap-0.5 text-emerald-600 font-bold text-xs"><ArrowUp size={11} />+{rankChange}</span>}
              {rankChange < 0  && <span className="flex items-center gap-0.5 text-red-400 font-bold text-xs"><ArrowDown size={11} />{rankChange}</span>}
              {rankChange === 0 && <span className="flex items-center gap-0.5 text-gray-300 text-xs"><Minus size={11} />0</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ScoreRow({ label, value, color, delay = 0 }) {
  const [width, setWidth] = useState(0)
  useEffect(() => { setTimeout(() => setWidth(value * 100), 100 + delay) }, [value, delay])
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-0.5">
        <span>{label}</span><span>{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${color} transition-all duration-700 ease-out`}
          style={{ width: `${width}%`, transitionDelay: `${delay}ms` }}
        />
      </div>
    </div>
  )
}

function MetricCard({ label, value, color, icon: Icon, numeric = false }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} className={color} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>
        {numeric ? <AnimatedNum value={value} /> : value}
      </p>
    </div>
  )
}

// ── main app (original structure, + pipeline + animated numbers) ──────────
export default function App() {
  const [query,       setQuery]       = useState("wireless headphones")
  const [mode,        setMode]        = useState("balanced")
  const [loading,     setLoading]     = useState(false)
  const [searching,   setSearching]   = useState(false)
  const [original,    setOriginal]    = useState([])
  const [reranked,    setReranked]    = useState([])
  const [metrics,     setMetrics]     = useState(null)
  const [animating,   setAnimating]   = useState(false)
  const [error,       setError]       = useState(null)
  const [totalMatches,setTotalMatches]= useState(0)
  const [pipeStep,    setPipeStep]    = useState(-1)

  // step through pipeline with delays
  const runPipeline = useCallback((i, cb) => {
    if (i >= STEPS.length) { cb(); return }
    setPipeStep(i)
    setTimeout(() => runPipeline(i + 1, cb), 420)
  }, [])

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    setReranked([])
    setMetrics(null)
    setAnimating(false)

    try {
      const res = await axios.get(`/api/search?q=${encodeURIComponent(query)}&n=10`)
      setOriginal(res.data.products)
      setTotalMatches(res.data.total_matches)
    } catch {
      setError("Search failed — is FastAPI running on port 8000?")
    } finally {
      setSearching(false)
    }
  }

  const handleRerank = async () => {
    if (!original.length) return
    setLoading(true)
    setError(null)
    setAnimating(false)

    try {
      const res = await axios.post("/api/rerank", { query, products: original, mode })

      // animate pipeline, THEN show results
      runPipeline(0, () => {
        setTimeout(() => {
          setReranked(res.data.results)
          setMetrics(res.data)
          setAnimating(true)
          setLoading(false)
          setPipeStep(-1)
        }, 300)
      })
    } catch {
      setError("Re-rank failed")
      setLoading(false)
      setPipeStep(-1)
    }
  }

  const sponsoredOriginal  = original.filter(p => p.sponsored).length
  const sponsoredReranked  = reranked.slice(0, 5).filter(p => p.sponsored).length

  return (
    <div className="min-h-screen bg-slate-50">

      {/* topbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Search Re-Ranker</h1>
            <p className="text-xs text-gray-400 mt-0.5">LambdaMART · NSGA-II · ESCI Dataset · NDCG@10 0.9114</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Search real Amazon products..."
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Search
            </button>
            <select
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={mode}
              onChange={e => setMode(e.target.value)}
            >
              <option value="balanced">Balanced</option>
              <option value="relevance">Relevance Only</option>
              <option value="fair">Max Fairness</option>
            </select>
            <button
              onClick={handleRerank}
              disabled={loading || !original.length}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
              Re-Rank
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5">

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
        )}

        {/* ── live pipeline ── */}
        <PipelineBar step={pipeStep} />

        {/* metrics row */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MetricCard label="Baseline NDCG@10"   value={metrics.baseline_ndcg}  color="text-gray-600"    icon={TrendingUp} numeric />
            <MetricCard label="Optimized NDCG@10"  value={metrics.optimized_ndcg} color="text-blue-600"    icon={TrendingUp} numeric />
            <MetricCard label="Sponsored (original)"  value={`${sponsoredOriginal}/10`} color="text-yellow-600" icon={Zap} />
            <MetricCard label="Sponsored (reranked)"  value={`${sponsoredReranked}/5`}  color="text-emerald-600" icon={Shield} />
          </div>
        )}

        {totalMatches > 0 && (
          <p className="text-xs text-gray-400 mb-3">
            Found <span className="font-semibold text-gray-600">{totalMatches.toLocaleString()}</span> real Amazon products matching "{query}" from ESCI dataset
          </p>
        )}

        {/* columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* left — amazon style */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-yellow-50">
              <Zap size={15} className="text-yellow-500" />
              <span className="font-semibold text-sm text-gray-700">Amazon-Style Ranking</span>
              <span className="ml-auto text-xs text-gray-400 italic">revenue optimized</span>
            </div>
            <div className="p-3">
              {original.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                  <Search size={36} className="mb-3" />
                  <p className="text-sm">Search to load real products</p>
                </div>
              ) : (
                original.map((p, i) => (
                  <ProductCard
                    key={p.product_id}
                    product={p}
                    rank={i + 1}
                    showScores={false}
                    animating={false}
                    delay={0}
                  />
                ))
              )}
            </div>
          </div>

          {/* right — reranked */}
          <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-blue-100 flex items-center gap-2 bg-blue-50">
              <Shield size={15} className="text-blue-500" />
              <span className="font-semibold text-sm text-gray-700">Re-Ranked Results</span>
              <span className="ml-auto text-xs text-gray-400 italic">user satisfaction</span>
            </div>
            <div className="p-3">
              {reranked.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                  <Shield size={36} className="mb-3" />
                  <p className="text-sm">{original.length ? "Click Re-Rank to optimize" : "Search first"}</p>
                </div>
              ) : (
                reranked.map((p, i) => (
                  <ProductCard
                    key={p.product_id}
                    product={p}
                    rank={i + 1}
                    showScores={true}
                    animating={animating}
                    delay={i * 80}
                  />
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
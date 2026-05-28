import { useState } from "react"
import axios from "axios"
import { Search, TrendingUp, Shield, DollarSign, Star, ArrowUp, ArrowDown, Minus, Zap } from "lucide-react"

const DEMO_PRODUCTS = [
  { product_id: "B001", product_title: "Wireless Bluetooth Headphones Premium Sound", product_description: "High quality audio with noise cancellation", product_bullet_point: "40hr battery, foldable design, premium drivers", product_brand: "SoundPro", product_color: "Black", original_rank: 1, sponsored: true },
  { product_id: "B002", product_title: "Bluetooth Headphones with Microphone", product_description: "Clear calls and music", product_bullet_point: "Built-in mic, comfortable fit, 30hr battery", product_brand: "AudioMax", product_color: "White", original_rank: 2, sponsored: true },
  { product_id: "B003", product_title: "Over Ear Headphones Noise Cancelling Wireless", product_description: "Active noise cancellation blocks ambient sound", product_bullet_point: "ANC technology, foldable, carrying case included", product_brand: "QuietZone", product_color: "Silver", original_rank: 3, sponsored: false },
  { product_id: "B004", product_title: "Wireless Headphones Bass Boost Sport", product_description: "Deep bass for workouts", product_bullet_point: "Sweat resistant, secure fit, 20hr battery", product_brand: "BassKing", product_color: "Red", original_rank: 4, sponsored: true },
  { product_id: "B005", product_title: "Professional Studio Monitor Headphones", product_description: "Flat frequency response for accurate audio monitoring", product_bullet_point: "50mm drivers, detachable cable, studio grade", product_brand: "StudioPro", product_color: "Black", original_rank: 5, sponsored: false },
  { product_id: "B006", product_title: "Kids Headphones Volume Limited Safe", product_description: "85dB volume limit protects children hearing", product_bullet_point: "Adjustable headband, durable, colorful design", product_brand: "KidSafe", product_color: "Blue", original_rank: 6, sponsored: false },
  { product_id: "B007", product_title: "Headphones with 3.5mm Jack Wired", product_description: "Universal compatibility wired headphones", product_bullet_point: "No charging needed, tangle free cable, foldable", product_brand: "WireSound", product_color: "Black", original_rank: 7, sponsored: false },
  { product_id: "B008", product_title: "Wireless Headphones Long Battery Life 60hr", product_description: "Industry leading 60 hour battery", product_bullet_point: "Fast charge, multipoint connection, soft earpads", product_brand: "EnduranceAudio", product_color: "Gray", original_rank: 8, sponsored: false },
  { product_id: "B009", product_title: "Gaming Headset Surround Sound RGB", product_description: "7.1 surround sound for immersive gaming", product_bullet_point: "RGB lighting, retractable mic, USB connection", product_brand: "GameAudio", product_color: "Black", original_rank: 9, sponsored: true },
  { product_id: "B010", product_title: "Headphones Comfortable Lightweight Daily Use", product_description: "Designed for all day comfort", product_bullet_point: "Memory foam earpads, lightweight 180g, foldable", product_brand: "ComfortWear", product_color: "Beige", original_rank: 10, sponsored: false },
]

const ScoreBar = ({ value, color }) => (
  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
    <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value * 100}%` }} />
  </div>
)

const RankBadge = ({ change }) => {
  if (change > 0) return <span className="flex items-center gap-0.5 text-emerald-600 font-bold text-xs"><ArrowUp size={12} />+{change}</span>
  if (change < 0) return <span className="flex items-center gap-0.5 text-red-500 font-bold text-xs"><ArrowDown size={12} />{change}</span>
  return <span className="flex items-center gap-0.5 text-gray-400 text-xs"><Minus size={12} />0</span>
}

const ProductCard = ({ product, rank, showScores }) => (
  <div className={`p-3 rounded-lg border text-sm ${product.sponsored ? "border-yellow-300 bg-yellow-50" : "border-gray-200 bg-white"}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <span className="text-gray-400 font-mono text-xs w-5 shrink-0 pt-0.5">#{rank}</span>
        <div className="min-w-0">
          <p className="font-medium text-gray-800 leading-snug text-xs line-clamp-2">{product.product_title}</p>
          <p className="text-gray-400 text-xs mt-0.5">{product.product_brand || "Unknown"}</p>
          {product.sponsored && (
            <span className="inline-flex items-center gap-0.5 text-yellow-700 bg-yellow-100 text-xs px-1.5 py-0.5 rounded mt-1">
              <Zap size={9} /> Sponsored
            </span>
          )}
        </div>
      </div>
      {showScores && product.rank_change !== undefined && (
        <RankBadge change={product.rank_change} />
      )}
    </div>
    {showScores && (
      <div className="mt-2 space-y-1 pl-7">
        <div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>Relevance</span><span>{(product.relevance_score * 100).toFixed(0)}%</span>
          </div>
          <ScoreBar value={product.relevance_score} color="bg-blue-400" />
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>Trust</span><span>{(product.trust_score * 100).toFixed(0)}%</span>
          </div>
          <ScoreBar value={product.trust_score} color="bg-emerald-400" />
        </div>
      </div>
    )}
  </div>
)

export default function App() {
  const [query, setQuery]       = useState("wireless headphones")
  const [mode, setMode]         = useState("balanced")
  const [loading, setLoading]   = useState(false)
  const [results, setResults]   = useState(null)
  const [error, setError]       = useState(null)

  const handleRerank = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.post("/api/rerank", {
        query,
        products: DEMO_PRODUCTS,
        mode,
      })
      setResults(res.data)
    } catch (e) {
      setError("API error — make sure FastAPI is running on port 8000")
    } finally {
      setLoading(false)
    }
  }

  const sponsoredOriginal = DEMO_PRODUCTS.filter(p => p.sponsored).length
  const sponsoredReranked = results?.results.slice(0, 10).filter(p => p.sponsored).length ?? 0

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto">

        {/* header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Search Re-Ranker</h1>
          <p className="text-gray-500 text-sm mt-1">LambdaMART + NSGA-II · Optimizing for user satisfaction over seller revenue</p>
        </div>

        {/* search bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-48 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRerank()}
                placeholder="Search query..."
              />
            </div>
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
              disabled={loading}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Ranking..." : "Re-Rank"}
            </button>
          </div>

          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        </div>

        {/* metrics */}
        {results && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { icon: TrendingUp, label: "Baseline NDCG@10", value: results.baseline_ndcg.toFixed(4), color: "text-gray-600" },
              { icon: TrendingUp, label: "Optimized NDCG@10", value: results.optimized_ndcg.toFixed(4), color: "text-blue-600" },
              { icon: Zap,        label: "Sponsored (original)", value: `${sponsoredOriginal}/10`, color: "text-yellow-600" },
              { icon: Shield,     label: "Sponsored (reranked)", value: `${sponsoredReranked}/10`, color: "text-emerald-600" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={14} className={color} />
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* baseline */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Zap size={15} className="text-yellow-500" />
              <span className="font-semibold text-sm text-gray-700">Amazon-Style Ranking</span>
              <span className="ml-auto text-xs text-gray-400">revenue optimized</span>
            </div>
            <div className="p-3 space-y-2">
              {DEMO_PRODUCTS.map((p, i) => (
                <ProductCard key={p.product_id} product={p} rank={i + 1} showScores={false} />
              ))}
            </div>
          </div>

          {/* reranked */}
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-blue-100 flex items-center gap-2">
              <Shield size={15} className="text-blue-500" />
              <span className="font-semibold text-sm text-gray-700">Re-Ranked Results</span>
              <span className="ml-auto text-xs text-gray-400">user satisfaction</span>
            </div>
            <div className="p-3 space-y-2">
              {results ? (
                results.results.map((p, i) => (
                  <ProductCard key={p.product_id} product={p} rank={i + 1} showScores={true} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Search size={32} className="mb-3 opacity-30" />
                  <p className="text-sm">Click Re-Rank to see results</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
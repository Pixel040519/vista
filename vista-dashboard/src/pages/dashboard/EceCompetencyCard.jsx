import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ChevronRight } from 'lucide-react'
import { eceApi } from '../../api/client'

const RATING_COLORS = {
  E:  'bg-emerald-500',
  G:  'bg-teal-500',
  F:  'bg-amber-500',
  NA: 'bg-red-400',
}

const RATING_LABELS = { E: 'Excellent', G: 'Good', F: 'Fair', NA: 'Needs Asst.' }

export default function EceCompetencyCard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    eceApi.getSummary()
      .then(r => { if (!cancelled) setData(r.data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="card p-5 flex items-center justify-center min-h-[180px]">
        <div className="w-5 h-5 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!data || data.totals.total_cells === 0) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-slate-800">ECE Competency Tracker</h3>
        </div>
        <div className="text-center py-6">
          <p className="text-xs text-slate-400">
            No competency skills set up yet.{' '}
            <Link to="/ece-competency" className="text-purple-600 font-medium">Get started</Link>
          </p>
        </div>
      </div>
    )
  }

  const { quarter, classes, rating_distribution: dist } = data
  const ratingTotal = dist.E + dist.G + dist.F + dist.NA

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800">ECE Competency Tracker</h3>
            <p className="text-xs text-slate-400">Rating progress · Q{quarter}</p>
          </div>
        </div>
        <Link to="/ece-competency" className="text-xs text-purple-600 font-medium hover:text-purple-700 flex items-center gap-1">
          View <ChevronRight size={13} />
        </Link>
      </div>

      {/* Per-class breakdown */}
      <div className="space-y-2.5 mb-3">
        {classes.map(c => {
          const barColor = c.completion_pct >= 100
            ? 'bg-emerald-500'
            : c.completion_pct > 0
              ? 'bg-amber-500'
              : 'bg-slate-300'
          return (
            <div key={`${c.grade_level}-${c.section}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-slate-700 truncate">
                  {c.grade_level} — {c.section}
                </span>
                <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                  {c.completion_pct}%
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full`} style={{ width: `${c.completion_pct}%` }} />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {c.rated_cells} / {c.total_cells} skills rated across {c.student_count} student{c.student_count !== 1 ? 's' : ''}
              </p>
            </div>
          )
        })}
      </div>

      {/* Rating distribution */}
      {ratingTotal > 0 && (
        <div>
          <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-2">
            {['E', 'G', 'F', 'NA'].map(r => dist[r] > 0 && (
              <div key={r} className={RATING_COLORS[r]} style={{ width: `${(dist[r] / ratingTotal) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {['E', 'G', 'F', 'NA'].map(r => (
              <span key={r}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${RATING_COLORS[r]} mr-1`} />
                {RATING_LABELS[r]} {dist[r]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ChevronRight } from 'lucide-react'
import { eceApi } from '../../api/client'

const ECE_GRADES = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']

const RATING_COLORS = {
  E:  'bg-emerald-500',
  G:  'bg-teal-500',
  F:  'bg-amber-500',
  NA: 'bg-red-400',
}

const RATING_LABELS = { E: 'Excellent', G: 'Good', F: 'Fair', NA: 'Needs Asst.' }

export default function AdminEceOverviewCard() {
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

  const byGradeLevel = data?.by_grade_level || ECE_GRADES.map(gl => ({
    grade_level: gl, class_count: 0, student_count: 0,
    rated_cells: 0, total_cells: 0, completion_pct: 0,
  }))
  const dist = data?.rating_distribution || { E: 0, G: 0, F: 0, NA: 0 }
  const ratingTotal = dist.E + dist.G + dist.F + dist.NA
  const quarter = data?.quarter || 1
  const hasAnyRecords = byGradeLevel.some(g => g.rated_cells > 0)

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800">ECE Competency Overview</h3>
            <p className="text-xs text-slate-400">Rating progress · 4 ECE levels · Q{quarter}</p>
          </div>
        </div>
        <Link
          to="/ece-competency"
          className="text-xs text-purple-600 font-medium hover:text-purple-700 flex items-center gap-1"
        >
          View <ChevronRight size={13} />
        </Link>
      </div>

      {!hasAnyRecords ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500">No ECE competency records yet.</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Teachers will populate this once they start rating.
          </p>
        </div>
      ) : (
        <>
          {/* Per-grade-level rows */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-4">
            {byGradeLevel.map(g => {
              const barColor = g.completion_pct >= 100
                ? 'bg-emerald-500'
                : g.completion_pct > 0
                  ? 'bg-amber-500'
                  : 'bg-slate-300'
              const hasWork = g.total_cells > 0
              return (
                <div key={g.grade_level}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-700">
                      {g.grade_level}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {hasWork ? `${g.completion_pct}%` : '—'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-full transition-all`}
                      style={{ width: `${g.completion_pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {g.class_count === 0
                      ? 'No classes assigned'
                      : !hasWork
                        ? `${g.class_count} class${g.class_count !== 1 ? 'es' : ''} · no skills set up`
                        : g.rated_cells === 0
                          ? `${g.class_count} class${g.class_count !== 1 ? 'es' : ''} · ${g.student_count} students · Not started`
                          : `${g.class_count} class${g.class_count !== 1 ? 'es' : ''} · ${g.student_count} students · ${g.rated_cells}/${g.total_cells} rated`
                    }
                  </p>
                </div>
              )
            })}
          </div>

          {/* School-wide rating distribution */}
          {ratingTotal > 0 && (
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[11px] text-slate-400 mb-2 font-medium">School-wide rating distribution</p>
              <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-2">
                {['E', 'G', 'F', 'NA'].map(r => dist[r] > 0 && (
                  <div
                    key={r}
                    className={RATING_COLORS[r]}
                    style={{ width: `${(dist[r] / ratingTotal) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                {['E', 'G', 'F', 'NA'].map(r => (
                  <span key={r} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${RATING_COLORS[r]}`} />
                    {RATING_LABELS[r]} <span className="font-semibold text-slate-700">{dist[r]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

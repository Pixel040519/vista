import clsx from 'clsx'
import { AlertTriangle, ClipboardList, Info } from 'lucide-react'
import { LoadingSpinner, EmptyState } from './UI'
import { formatName } from '../utils/nameHelper'
import LearnerSidePanel from './LearnerSidePanel'

// ============================================================
// CATEGORY SCORES PANEL
// ============================================================
// What one Grade Summary cell is made of: every score item under one grading
// category (Written Work, Performance Task…) for one learner in one period,
// grouped by component, with the raw score beside the highest possible score.
//
// Read-only. The totals — T, PS, WS per component and the category's WS — are
// taken from the learner's `/scores/breakdown` entry, never recomputed here, so
// the panel cannot disagree with the cell that opened it. Only the item rows
// come from `/scores/items` + `/scores`.
//
// A blank score shows as "—" and is said to count as 0, because that is what
// both `POST /api/scores` and `/breakdown` do with it.

// 18 rather than 18.00; 18.5 stays 18.5.
const fmtNum = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
const fmt2 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—')

export default function CategoryScoresPanel({
  entry, structure, studentScores, loading, error,
  categoryId, onCategoryChange,
  ordered, onNavigate, onClose,
  subjectLabel, grading, period, gradeLevel, section, syLabel,
}) {
  const { student } = entry
  const category = entry.categories.find(c => c.id === categoryId) || entry.categories[0]
  const structCategory = structure?.find(c => c.id === category?.id)
  const itemsOf = (componentId) =>
    structCategory?.components.find(c => c.id === componentId)?.items || []
  const scoreOf = (itemId) => {
    const v = studentScores?.get(itemId)
    return v === null || v === undefined ? null : Number(v)
  }
  const hasMissing = !!category && category.components.some(comp =>
    itemsOf(comp.id).some(item => scoreOf(item.id) === null))

  return (
    <LearnerSidePanel
      student={student}
      subtitle={`${subjectLabel} · ${grading.abbr(period)} · ${gradeLevel} – ${section} · SY ${syLabel}`}
      ariaLabel={`${category?.name || 'Category'} scores of ${formatName(student)}`}
      ordered={ordered}
      getId={e => e.student.id}
      onNavigate={onNavigate}
      onClose={onClose}
    >
      {/* Category switcher — every category of this subject, so moving from
          Written Work to Performance Task does not mean closing the panel. */}
      <div className="flex flex-wrap gap-1.5">
        {entry.categories.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCategoryChange(c.id)}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
              c.id === category?.id ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            )}
          >
            {c.name} <span className={c.id === category?.id ? 'text-white/70' : 'text-slate-400'}>{fmtNum(c.weight)}%</span>
          </button>
        ))}
      </div>

      {category && (
        <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50">
          <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center font-mono text-xl font-bold text-brand-600 flex-shrink-0">
            {fmt2(category.ws)}
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{category.name} · weighted score</p>
            <p className="text-sm text-slate-700">
              <span className="font-mono font-semibold">{fmt2(category.ws)}</span> of {fmtNum(category.weight)}% for {grading.label(period)}
            </p>
            <p className="text-xs text-slate-400">
              The sum of the weighted scores of its {category.components.length} component{category.components.length !== 1 ? 's' : ''} below.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8"><LoadingSpinner /></div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      ) : !category || category.components.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No components" description="This category has no components in its grading structure." />
      ) : (
        <>
          {category.components.map(comp => {
            const items = itemsOf(comp.id)
            return (
              <div key={comp.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-800 truncate">{comp.name}</p>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{fmtNum(comp.weight)}% of the grade</span>
                </div>

                {items.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-slate-400">
                    No items recorded for this {grading.periodNoun.toLowerCase()}. It adds 0 to the grade.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2 text-left whitespace-nowrap">Item</th>
                          <th className="px-3 py-2 text-center whitespace-nowrap">Score</th>
                          <th className="px-3 py-2 text-center whitespace-nowrap">HPS</th>
                          <th className="px-4 py-2 text-right whitespace-nowrap">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(item => {
                          const score = scoreOf(item.id)
                          const hps = Number(item.highest_possible_score)
                          return (
                            <tr key={item.id} className="border-b border-slate-100 last:border-b-0">
                              <td className="px-4 py-2 text-slate-700">{item.name}</td>
                              <td className="px-3 py-2 text-center font-mono">
                                {score === null
                                  ? <span className="text-slate-300" title="Not recorded — counts as 0">—</span>
                                  : <span className="font-semibold text-slate-800">{fmtNum(score)}</span>}
                              </td>
                              <td className="px-3 py-2 text-center font-mono text-slate-500">{fmtNum(hps)}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                                {score === null || !(hps > 0) ? '—' : `${Math.round((score / hps) * 100)}%`}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span>Total <span className="font-mono font-semibold text-slate-700">{fmtNum(comp.total)} / {fmtNum(comp.hps_total)}</span></span>
                  <span>PS <span className="font-mono font-semibold text-slate-700">{fmt2(comp.ps)}%</span></span>
                  <span>WS <span className="font-mono font-semibold text-brand-600">{fmt2(comp.ws)}</span></span>
                </div>
              </div>
            )
          })}

          <p className="flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
            <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <span>
              PS is the component total over its highest possible score; WS is PS × the component’s weight.
              {hasMissing && ' A “—” is a score not recorded yet, and it counts as 0.'}
            </span>
          </p>
        </>
      )}
    </LearnerSidePanel>
  )
}

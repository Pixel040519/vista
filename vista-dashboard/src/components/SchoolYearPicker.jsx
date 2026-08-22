import { useState } from 'react'
import { CalendarDays, ChevronDown as ChevDown, Plus } from 'lucide-react'
import clsx from 'clsx'

/**
 * School-year dropdown, shared by Curriculum Management and Enrollment.
 *
 * There is no school-year context in the app — each page fetches
 * `curriculumApi.getSchoolYears()` itself and owns its own selection, so this
 * is a controlled component: pass `schoolYears`, `selectedSY` and `onSelect`.
 *
 * `onManage` adds a trailing "Create New School Year" row; omit it (or pass
 * `canManage={false}`) on pages where the caller cannot create years.
 */

/**
 * The three-way status derived from the boolean pair — there is no status
 * column. Mirror of `syStatus` in the backend's `utils/schoolYear.js`; it lives
 * here because the pill below was already the one place that derived it.
 */
export const syStatus = (sy) =>
  !sy ? null : sy.is_active ? 'active' : sy.is_upcoming ? 'upcoming' : 'archived'

/** True for a year that has closed, and whose records are therefore history. */
export const isArchivedYear = (sy) => syStatus(sy) === 'archived'

const STATUS_TONES = {
  active:   'bg-emerald-100 text-emerald-700',
  upcoming: 'bg-blue-100 text-blue-700',
  archived: 'bg-slate-100 text-slate-500',
}

export function SYStatusPill({ sy, className = '' }) {
  const status = syStatus(sy)
  if (!status) return null
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium', STATUS_TONES[status], className)}>
      {status}
    </span>
  )
}

export default function SchoolYearPicker({
  schoolYears = [], selectedSY, onSelect, onManage, canManage = true, manageLabel = 'Create New School Year',
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 hover:border-brand-300 transition-colors shadow-sm"
      >
        <CalendarDays size={15} className="text-brand-500"/>
        SY {selectedSY?.label || '—'}
        <SYStatusPill sy={selectedSY}/>
        <ChevDown size={13} className={clsx('text-slate-400 transition-transform', open && 'rotate-180')}/>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)}/>
          <div className="absolute top-full left-0 mt-1 z-20 w-64 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
            {schoolYears.map(sy => (
              <button key={sy.id}
                onClick={() => { onSelect(sy); setOpen(false) }}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors',
                  sy.id === selectedSY?.id && 'bg-brand-50'
                )}>
                <CalendarDays size={14} className="text-slate-400 flex-shrink-0"/>
                <span className="flex-1 text-sm font-medium text-slate-800">SY {sy.label}</span>
                <SYStatusPill sy={sy}/>
              </button>
            ))}
            {canManage && onManage && (
              <div className="border-t border-slate-100">
                <button onClick={() => { setOpen(false); onManage() }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-brand-600 hover:bg-brand-50 transition-colors font-medium">
                  <Plus size={14}/> {manageLabel}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

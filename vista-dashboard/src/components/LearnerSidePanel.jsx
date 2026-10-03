import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { X, ChevronLeft, ChevronRight, ArrowUpRight } from 'lucide-react'
import { formatName } from '../utils/nameHelper'

// ============================================================
// LEARNER SIDE PANEL
// ============================================================
// The right-hand drawer the Grades page opens over a table: a learner header,
// a scrolling body, and Previous/Next across the table's own order. Shared by
// the All subjects learner record and the Grade Summary's category scores, so
// the two panels open, close and walk the class the same way.
//
// `ordered` is the table's row order (gender groups flattened, search applied)
// and `getId(entry)` reads a learner id from one of its entries, so each caller
// passes its rows as they are rather than reshaping them.
export default function LearnerSidePanel({ student, subtitle, ariaLabel, ordered, getId, onNavigate, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const position = ordered.findIndex(entry => getId(entry) === student.id)
  const prev = position > 0 ? ordered[position - 1] : null
  const next = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null
  const initials = `${student.first_name?.[0] || ''}${student.surname?.[0] || ''}`.toUpperCase() || '?'

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 animate-fade-in" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="relative w-full max-w-3xl h-full bg-white shadow-2xl flex flex-col"
      >
        <div className="px-4 sm:px-6 py-5 border-b border-slate-100 flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-full bg-brand-100 text-brand-600 font-semibold text-[15px] flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 truncate">{formatName(student)}</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {children}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" disabled={!prev} onClick={() => prev && onNavigate(getId(prev))}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Previous learner">
              <ChevronLeft size={16} />
            </button>
            <button type="button" disabled={!next} onClick={() => next && onNavigate(getId(next))}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Next learner">
              <ChevronRight size={16} />
            </button>
            {position >= 0 && <span className="text-xs text-slate-400">{position + 1} of {ordered.length}</span>}
          </div>
          <Link to={`/students/${student.id}`} className="btn-primary">
            Open student profile <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
    </div>,
    document.body
  )
}

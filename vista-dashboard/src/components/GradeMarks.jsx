import clsx from 'clsx'
import { DO15_2026_DESCRIPTORS } from '../utils/grading'

// The pieces a numeric grade is shown with, shared by the Grades page and
// Student Detail so both read a grade the same way:
//
//   GradeNumber      a plain whole number, red below the passing grade
//   DescriptorLabel  the policy's qualitative descriptor — renders nothing
//                    useful on a policy without one (DO 8), so callers hide
//                    the column on `grading.descriptorFor` instead
//   RemarksPill      PASSED / FAILED against the passing grade, every policy

// Rank-ordered, best first — the same order as DO15_2026_DESCRIPTORS.
const DESCRIPTOR_DOTS = ['bg-emerald-500', 'bg-brand-400', 'bg-slate-400', 'bg-amber-500', 'bg-red-500']

// `tone`: 'final' is the grade that counts (teal), 'plain' a period grade,
// 'muted' an area shown beneath its learning area.
export function GradeNumber({ grade, passing, tone = 'plain', small = false }) {
  if (grade === null || grade === undefined) {
    return <span className={clsx('font-mono text-slate-300', small ? 'text-[13px]' : 'text-sm')}>—</span>
  }
  const failing = grade < passing
  return (
    <span className={clsx(
      'font-mono', small ? 'text-[13px]' : 'text-sm',
      failing ? 'text-red-500 font-semibold'
        : tone === 'final' ? 'text-teal-600 font-bold'
        : tone === 'muted' ? 'text-slate-500'
        : 'text-slate-700'
    )}>
      {grade}
    </span>
  )
}

export function RemarksPill({ grade, passing }) {
  if (grade === null || grade === undefined) return <span className="text-slate-300 text-xs">—</span>
  const passed = grade >= passing
  return (
    <span className={clsx(
      'inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
    )}>
      {passed ? 'PASSED' : 'FAILED'}
    </span>
  )
}

export function DescriptorLabel({ grade, grading }) {
  if (grade === null || grade === undefined || !grading.descriptorFor) {
    return <span className="text-slate-300 text-xs">—</span>
  }
  const d = grading.descriptorFor(grade)
  const rank = DO15_2026_DESCRIPTORS.findIndex(x => x.label === d.label)
  return (
    <span
      title={d.response}
      className={clsx(
        'inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap',
        grade < grading.passingGrade ? 'text-red-600' : 'text-slate-700'
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', DESCRIPTOR_DOTS[rank] || 'bg-slate-300')} />
      {d.label}
    </span>
  )
}

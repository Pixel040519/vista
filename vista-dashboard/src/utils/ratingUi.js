/**
 * Presentation helpers for descriptive rating scales.
 *
 * Kept out of `utils/grading.js` so that module stays a verbatim mirror of the
 * backend one — colours are a dashboard concern the API knows nothing about.
 *
 * The class strings are written out in full rather than composed (e.g.
 * `bg-${color}-500`) because Tailwind's JIT scans source text literally and
 * would not emit classes it never sees spelled out.
 */
import { ratingScale } from './grading'

export const RATING_COLOR_CLASSES = {
  emerald: 'bg-emerald-500 text-white border-emerald-600',
  brand:   'bg-brand-500 text-white border-brand-600',
  sky:     'bg-sky-500 text-white border-sky-600',
  amber:   'bg-amber-500 text-white border-amber-600',
  red:     'bg-red-500 text-white border-red-600',
}

/** Soft/tinted variant used for legends and non-interactive badges. */
export const RATING_TINT_CLASSES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  brand:   'bg-brand-50 text-brand-700 border-brand-200',
  sky:     'bg-sky-50 text-sky-700 border-sky-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  red:     'bg-red-50 text-red-700 border-red-200',
}

/** Bar-segment fill used by the distribution bars on the dashboard cards. */
export const RATING_BAR_CLASSES = {
  emerald: 'bg-emerald-500',
  brand:   'bg-brand-500',
  sky:     'bg-sky-500',
  amber:   'bg-amber-500',
  red:     'bg-red-500',
}

const FALLBACK = 'bg-slate-400 text-white border-slate-500'

/**
 * Rating buttons/badges for one scale, in best-to-worst order.
 * Shape matches the old hardcoded `RATINGS` array so call sites read the same.
 */
export function ratingOptions(scaleId) {
  return ratingScale(scaleId).levels.map(lv => ({
    value: lv.code,
    label: lv.label,
    filipino: lv.filipino || null,
    description: lv.description || null,
    color: RATING_COLOR_CLASSES[lv.color] || FALLBACK,
    tint: RATING_TINT_CLASSES[lv.color] || FALLBACK,
    bar: RATING_BAR_CLASSES[lv.color] || 'bg-slate-400',
  }))
}

export const ratingOption = (scaleId, code) =>
  ratingOptions(scaleId).find(o => o.value === code) || null

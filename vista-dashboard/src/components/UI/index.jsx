import clsx from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── Stat Card ─────────────────────────────────────────────────
export function StatCard({ title, value, subtitle, icon: Icon, color = 'teal', trend }) {
  const colorMap = {
    teal:    'bg-teal-50 text-teal-600',
    blue:    'bg-blue-50 text-blue-600',
    amber:   'bg-amber-50 text-amber-600',
    red:     'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    purple:  'bg-purple-50 text-purple-600',
  }
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', colorMap[color])}>
          {Icon && <Icon size={20} />}
        </div>
        {trend !== undefined && (
          <div className={clsx('flex items-center gap-1 text-xs font-medium',
            trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-slate-400'
          )}>
            {trend > 0 ? <TrendingUp size={14} /> : trend < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm font-medium text-slate-700 mt-0.5">{title}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

// ── Risk Badge ────────────────────────────────────────────────
export function RiskBadge({ level }) {
  if (!level) return null
  const cls = {
    'Stable':        'badge-stable',
    'Moderate Risk': 'badge-moderate',
    'High Risk':     'badge-high',
  }[level] || 'badge-stable'

  const dot = {
    'Stable':        'bg-emerald-500',
    'Moderate Risk': 'bg-amber-500',
    'High Risk':     'bg-red-500',
  }[level] || 'bg-slate-400'

  return (
    <span className={cls}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', dot)} />
      {level}
    </span>
  )
}

// ── Sentiment Badge ───────────────────────────────────────────
export function SentimentBadge({ sentiment }) {
  if (!sentiment) return null
  const cls = {
    Positive: 'badge-positive',
    Negative: 'badge-negative',
    Neutral:  'badge-neutral',
  }[sentiment] || 'badge-neutral'

  const emoji = { Positive: '😊', Negative: '😟', Neutral: '😐' }[sentiment] || '😐'

  return <span className={cls}>{emoji} {sentiment}</span>
}

// ── Loading Spinner ───────────────────────────────────────────
export function LoadingSpinner({ size = 'md' }) {
  const sz = { sm: 'w-5 h-5 border-2', md: 'w-8 h-8 border-3', lg: 'w-12 h-12 border-4' }[size]
  return (
    <div className="flex items-center justify-center py-12">
      <div className={clsx(sz, 'border-teal-500 border-t-transparent rounded-full animate-spin')} />
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Icon size={26} className="text-slate-400" />
        </div>
      )}
      <p className="text-slate-700 font-semibold">{title}</p>
      {description && <p className="text-slate-400 text-sm mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative w-full card shadow-2xl animate-slide-up', widths[size])}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-xl leading-none"
          >×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ── Grade Color ───────────────────────────────────────────────
export function GradeChip({ grade }) {
  if (!grade && grade !== 0) return <span className="text-slate-400 text-xs">—</span>
  const g = parseFloat(grade)
  const cls = g >= 90 ? 'text-emerald-700 bg-emerald-50' :
              g >= 80 ? 'text-blue-700 bg-blue-50' :
              g >= 75 ? 'text-amber-700 bg-amber-50' :
                        'text-red-700 bg-red-50'
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-lg text-xs font-semibold font-mono', cls)}>
      {g.toFixed(1)}
    </span>
  )
}
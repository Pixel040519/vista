import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, MoreHorizontal, Check, Copy, Pencil } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { toneClasses, shortStateLabel } from '../utils/accessDisplay'
import { formatName } from '../utils/nameHelper'

// The building blocks of Account Management's three tabs — Teachers, Admins and
// Parents — so the three rosters look and behave as one page: the same filter
// bar, the same person cell, the same access chip with one line under it, the
// same ⋯ menu and the same confirmation after an invitation is created. What
// differs between the tabs is only what is genuinely different: assignments vs
// role vs children, and which actions an account's state allows.

/** Two letters for an avatar — "Dela Cruz, Ana" → "DA". */
export const initials = (p) =>
  `${(p?.surname || '')[0] || ''}${(p?.first_name || '')[0] || ''}`.toUpperCase() || '?'

/** A modal title with a line under it. `Modal` renders the title in an <h3>, so block spans, not a <p>. */
export const titled = (title, subtitle) => (
  <span className="block">
    <span className="block">{title}</span>
    <span className="block text-[13px] font-normal text-slate-500 mt-0.5">{subtitle}</span>
  </span>
)

// ── Filters ───────────────────────────────────────────────────
// Search on the left, state chips beside it. A chip nobody is in is not offered
// — except All, and whichever is selected, so a filter is never invisible
// while it is still narrowing the list.
export function RosterFilters({ search, onSearch, placeholder, label, chips, value, onChange }) {
  const shown = chips.filter(c => !c.id || c.n > 0 || c.id === value)
  return (
    <div className="card p-4 flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="relative lg:w-80 shrink-0">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-10" placeholder={placeholder} aria-label={label}
          value={search} onChange={e => onSearch(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map(c => (
          <button key={c.id || 'all'} onClick={() => onChange(c.id)}
            className={clsx('px-3.5 py-1.5 rounded-full text-[13px] font-medium border transition-colors',
              value === c.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
            {c.label} <span className={value === c.id ? 'opacity-80' : 'text-slate-500'}>{c.n}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** The chip list for RosterFilters: All, then each state with its count. */
export const stateChips = (states, counts, total) => [
  { id: '', label: 'All', n: total },
  ...states.map(s => ({ id: s.id, label: shortStateLabel(s), n: counts[s.id] || 0 })),
]

// ── Cells ─────────────────────────────────────────────────────
const AVATAR = {
  brand:  'bg-brand-100 text-brand-700',
  purple: 'bg-purple-100 text-purple-700',
  off:    'bg-slate-100 text-slate-400',
}

export function PersonCell({ person, tone = 'brand', muted = false, suffix = null }) {
  return (
    <div className="flex items-center gap-3">
      <div className={clsx('w-9 h-9 rounded-full grid place-items-center text-xs font-bold shrink-0', AVATAR[muted ? 'off' : tone])}>
        {initials(person)}
      </div>
      <div className="min-w-0">
        <p className={clsx('font-medium', muted ? 'text-slate-500' : 'text-slate-800')}>
          {formatName(person)}{suffix}
        </p>
        <p className="text-xs text-slate-500 truncate">{person.email}</p>
      </div>
    </div>
  )
}

export function AccessChip({ state }) {
  const tone = toneClasses(state.tone)
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap', tone.chip)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', tone.dot)} />
      {state.label}
    </span>
  )
}

export function AccessCell({ state, detail }) {
  return (
    <div>
      <AccessChip state={state} />
      {detail && <p className="text-xs text-slate-500 mt-1">{detail}</p>}
    </div>
  )
}

// ── Row menu ──────────────────────────────────────────────────
/**
 * One open menu at a time for the whole page; a click anywhere else or Escape
 * closes it. Returns `{ isOpen(key), toggle(key) }`.
 */
export function useRowMenus() {
  const [open, setOpen] = useState(null)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const esc = (e) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', esc) }
  }, [open])
  return {
    isOpen: (key) => open === key,
    toggle: (key) => () => setOpen(o => (o === key ? null : key)),
    close: () => setOpen(null),
  }
}

const MENU_HEIGHT_GUESS = 280

/**
 * The ⋯ menu. `items` above the divider, `danger` (red, ends access) below it;
 * each is `{ key, icon, label, hint?, run }`.
 *
 * Portalled and fixed-positioned off its button: the rosters sit in an
 * `overflow-x-auto` wrapper, which clips anything hanging below it, so a menu
 * opened on the last row would otherwise be cut off. It opens upward when there
 * is no room below, and closes on scroll or resize rather than drifting away
 * from the row it belongs to.
 */
export function RowMenu({ label, open, onToggle, items, danger = [] }) {
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!open) { setPos(null); return }
    const r = btnRef.current.getBoundingClientRect()
    const below = r.bottom + 4 + MENU_HEIGHT_GUESS <= window.innerHeight
    setPos({
      right: window.innerWidth - r.right,
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    })
    const close = () => onToggle()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={onToggle} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        className={clsx('p-1.5 rounded-lg transition-colors',
          open ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100')}>
        <MoreHorizontal size={16} />
      </button>
      {open && pos && createPortal(
        <div role="menu" onClick={e => e.stopPropagation()} style={pos}
          className="fixed z-50 w-64 p-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl text-left animate-fade-in">
          {items.map(it => <MenuItem key={it.key} item={it} onToggle={onToggle} />)}
          {danger.length > 0 && <div className="h-px mx-2 my-1.5 bg-slate-100" />}
          {danger.map(it => <MenuItem key={it.key} item={it} onToggle={onToggle} danger />)}
        </div>,
        document.body
      )}
    </div>
  )
}

function MenuItem({ item, onToggle, danger }) {
  const Icon = item.icon
  return (
    <button role="menuitem" onClick={() => { onToggle(); item.run() }}
      className="flex items-start gap-2.5 w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 text-left">
      <Icon size={15} className={clsx('mt-0.5 shrink-0', danger ? 'text-red-600' : 'text-slate-500')} />
      <span>
        <span className={clsx('block text-sm font-medium', danger ? 'text-red-700' : 'text-slate-800')}>{item.label}</span>
        {item.hint && <span className="block text-xs text-slate-500 mt-0.5">{item.hint}</span>}
      </span>
    </button>
  )
}

/** Pencil + ⋯ — the actions cell, the same on every tab. */
export function RowActions({ editLabel, onEdit, menu }) {
  return (
    <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
      <button onClick={onEdit} aria-label={editLabel} title="Edit"
        className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
        <Pencil size={15} />
      </button>
      {menu}
    </div>
  )
}

// ── Invite forms ──────────────────────────────────────────────
/** What saving an invitation does, said once where it is decided. */
export function WhatHappensNext({ steps }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3.5 space-y-2.5">
      <p className="text-sm font-semibold text-slate-800">What happens next</p>
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2.5 text-[13px] text-slate-600 leading-relaxed">
          <span className="w-5 h-5 mt-px shrink-0 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold grid place-items-center">{i + 1}</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * After an invitation is created. Nothing has been emailed — the code goes out
 * only when they ask for it — so the admin is the one who tells them; this
 * hands over the exact steps, with a Copy button.
 */
export function InvitationCreated({ name, email, roleLabel, state, openUntil, steps, onAnother, onDone }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'))
      toast.success('Steps copied.')
    } catch { toast.error('Copy did not work — select the steps and copy them instead.') }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center gap-2">
        <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center">
          <Check size={26} strokeWidth={2.6} />
        </div>
        <p className="text-lg font-bold text-slate-900">Invitation created</p>
        <p className="text-sm text-slate-600">{name} can now activate their {roleLabel.toLowerCase()} account.</p>
      </div>

      <dl className="rounded-xl border border-slate-100 divide-y divide-slate-100 text-sm">
        <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-500">Sign-in email</dt><dd className="font-semibold text-slate-800 truncate">{email}</dd></div>
        <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-500">Role</dt><dd className="font-semibold text-slate-800">{roleLabel}</dd></div>
        <div className="flex justify-between items-center gap-4 px-4 py-2.5"><dt className="text-slate-500">Status</dt><dd><AccessChip state={state} /></dd></div>
        {openUntil && (
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-500">Open until</dt><dd className="font-semibold text-slate-800">{openUntil}</dd></div>
        )}
      </dl>

      <div className="space-y-2.5">
        <p className="text-sm font-semibold text-slate-800">Let them know</p>
        <p className="text-[13px] text-slate-600 leading-relaxed">
          VISTA hasn't emailed them. The code is sent only when they ask for it, so share these steps:
        </p>
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <ol className="flex-1 min-w-0 list-decimal pl-4 text-[13px] text-slate-700 leading-relaxed space-y-0.5 break-words select-text">
            {steps.map(s => <li key={s}>{s}</li>)}
          </ol>
          <button type="button" onClick={copy} className="btn-secondary !py-1.5 !px-3 text-xs shrink-0">
            <Copy size={13} /> Copy
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button onClick={onAnother} className="btn-secondary">Invite another</button>
        <button onClick={onDone} className="btn-primary">Done</button>
      </div>
    </div>
  )
}

/**
 * How an account's access is put into words — shared by the three Account
 * Management tabs (Teachers, Admins, Parents) so one state reads the same way
 * on each. The *states* stay in utils/staffAccess.js and utils/parentAccess.js,
 * which mirror their backend modules; this file is presentation only.
 */

const dateFmt  = { month: 'short', day: 'numeric' }
const dateYear = { month: 'short', day: 'numeric', year: 'numeric' }

export const fmtDate = (v, withYear = false) =>
  new Date(v).toLocaleDateString('en-PH', withYear ? dateYear : dateFmt)

const isToday = (d) => {
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

/** "today, 7:42 AM" / "Sep 30" — for a last sign-in. */
export const whenSignedIn = (v) => {
  const d = new Date(v)
  if (isToday(d)) return `today, ${d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`
  return fmtDate(v)
}

/** "Invited Oct 2 by you · open until Nov 1" — `meId` turns the inviter into "you". */
export const invitedLine = (inv, meId) => {
  if (!inv?.invited_at) return 'Invited · waiting for them to activate'
  const by = meId && inv.invited_by === meId
    ? ' by you'
    : inv.invited_by_name ? ` by ${inv.invited_by_name}` : ''
  return `Invited ${fmtDate(inv.invited_at)}${by} · open until ${fmtDate(inv.expires_at)}`
}

/** "Not activated by Sep 27", or a plain prompt when there is no lapsed date to name. */
export const expiredLine = (inv) =>
  inv?.expires_at && !inv.revoked_at && !inv.consumed_at
    ? `Not activated by ${fmtDate(inv.expires_at)}`
    : 'No open invitation · reissue it'

export const IN_PROGRESS_LINE = 'A code was sent and is waiting to be entered'

export const invitationOpenUntil = (inv) => (inv?.expires_at ? fmtDate(inv.expires_at, true) : null)

// The chip labels are long ("Activation In Progress"); the filter chips use these.
const SHORT = { in_progress: 'In Progress' }
export const shortStateLabel = (state) => SHORT[state.id] || state.label

// Complete class strings — Tailwind's scanner only sees whole class names.
const TONE = {
  emerald: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  blue:    { chip: 'bg-blue-50 text-blue-700',       dot: 'bg-blue-500'    },
  amber:   { chip: 'bg-amber-50 text-amber-700',     dot: 'bg-amber-500'   },
  red:     { chip: 'bg-red-50 text-red-700',         dot: 'bg-red-500'     },
  slate:   { chip: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400'   },
}
export const toneClasses = (tone) => TONE[tone] || TONE.slate

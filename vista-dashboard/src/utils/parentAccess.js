/**
 * The five parent/guardian account-access states.
 *
 * Mirror of vista-backend/node-api/src/utils/parentAccess.js — same convention
 * as utils/roles.js and utils/grading.js. The API already sends a resolved
 * `access` object on every guardian, so most surfaces just read that; this
 * exists for the cases that have to decide before a round trip (what the toggle
 * in an unsaved form implies, which action buttons to offer) and so the two
 * sides cannot describe the same row differently.
 *
 * If you change a state here, change it there in the same commit.
 */

export const PARENT_ACCESS_STATES = [
  { id: 'none',        label: 'No account access',      tone: 'slate'   },
  { id: 'revoked',     label: 'Revoked',                tone: 'slate'   },
  { id: 'expired',     label: 'Expired',                tone: 'red'     },
  { id: 'pending',     label: 'Pending Activation',     tone: 'blue'    },
  { id: 'in_progress', label: 'Activation In Progress', tone: 'amber'   },
  { id: 'active',      label: 'Active',                 tone: 'emerald' },
]

const STATE_BY_ID = Object.fromEntries(PARENT_ACCESS_STATES.map((s) => [s.id, s]))

// The dashboard's badge tones, matching utils/enrollment.js so a status chip
// here looks like a status chip everywhere else.
const TONE_CLASSES = {
  emerald: 'bg-emerald-100 text-emerald-700',
  blue:    'bg-blue-100 text-blue-700',
  amber:   'bg-amber-100 text-amber-700',
  red:     'bg-red-100 text-red-700',
  slate:   'bg-slate-100 text-slate-600',
}

const isPast = (value) => {
  if (!value) return false
  const t = new Date(value).getTime()
  return Number.isFinite(t) && t <= Date.now()
}

export function resolveParentAccess({ hasAccount, accountStatus, invitation } = {}) {
  if (!hasAccount) return STATE_BY_ID.none
  if (accountStatus === 'active') return STATE_BY_ID.active
  if (accountStatus === 'revoked') return STATE_BY_ID.revoked
  if (!invitation) return STATE_BY_ID.pending
  if (invitation.revoked_at) return STATE_BY_ID.revoked
  if (invitation.consumed_at) return STATE_BY_ID.pending
  if (isPast(invitation.expires_at)) return STATE_BY_ID.expired
  return invitation.has_live_code ? STATE_BY_ID.in_progress : STATE_BY_ID.pending
}

/** The access object the API sends, or a derived one, or the 'none' fallback. */
export const accessOf = (guardian) =>
  guardian?.access || resolveParentAccess({
    hasAccount: guardian?.has_account,
    accountStatus: guardian?.account_status,
    invitation: guardian?.invitation,
  })

export const accessClasses = (state) => TONE_CLASSES[STATE_BY_ID[state]?.tone] || TONE_CLASSES.slate
export const accessLabel = (state) => STATE_BY_ID[state]?.label || 'No account access'

// Everything but Active can be granted, re-issued or restored — re-issuing a
// pending invitation restarts its 30 days and cancels any unused code.
export const canInvite = (state) => state !== 'active'
export const canRevoke = (state) => state === 'pending' || state === 'in_progress' || state === 'active'
// Editable only while no password was ever set. Checked on the password, not
// the status: a revoked account that was once active still belongs to a parent
// who proved the address.
export const canChangeEmail = (guardian) => !guardian?.has_account || !guardian?.has_password

// Short chip text for tight spaces like the guardian list.
const SHORT = { none: 'No app', pending: 'Pending', in_progress: 'In progress', active: 'Active', revoked: 'Revoked', expired: 'Expired' }
export const accessShortLabel = (state) => SHORT[state] || 'No app'

/**
 * The button label for granting access, which is not always "Add Invitation".
 * A revoked account that still holds a password is restored rather than
 * re-invited — the parent already proved they own the address, and asking them
 * to do it again would be theatre.
 */
export const grantLabel = (guardian) => {
  const state = accessOf(guardian).id
  if (state === 'revoked' && guardian?.has_password) return 'Restore Access'
  if (state === 'none') return 'Add Invitation'
  return 'Reissue Invitation'
}

/** A one-line account of where this guardian's access stands, for under the row. */
export const accessDetail = (guardian) => {
  const state = accessOf(guardian).id
  const inv = guardian?.invitation
  const by = inv?.invited_by_name ? ` by ${inv.invited_by_name}` : ''
  const on = inv?.invited_at ? new Date(inv.invited_at).toLocaleDateString() : null

  switch (state) {
    case 'pending':
      return on ? `Invited ${on}${by} · no message sent yet` : 'Invited · no message sent yet'
    case 'in_progress':
      return 'A code has been sent and is waiting to be entered'
    case 'active':
      return 'Signs in to the VISTA Parent app'
    case 'revoked':
      return 'Access withdrawn · the guardian record and history are unchanged'
    case 'expired':
      return 'The invitation was never used and has lapsed'
    default:
      return guardian?.email ? 'Contact only · not invited to the parent portal' : 'Contact only · no email on file'
  }
}

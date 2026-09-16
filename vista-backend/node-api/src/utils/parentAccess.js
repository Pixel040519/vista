/**
 * The five parent/guardian account-access states, derived rather than stored.
 *
 * Nothing writes a "status" column for this. Two facts already answer it —
 * users.account_status (can this account sign in) and the account's newest
 * parent_invitations row (where is the invitation up to) — and deriving keeps
 * them from disagreeing, the same reason the Students page derives
 * status_display instead of storing a second enrolment status.
 *
 * Mirrored in vista-dashboard/src/utils/parentAccess.js. Same convention as
 * utils/roles.js and utils/grading.js: if you change a state here, change it
 * there in the same commit.
 */

// Ordered worst-to-best for anything that wants to sort by state.
const PARENT_ACCESS_STATES = [
  { id: 'none',        label: 'No account access',      tone: 'slate'   },
  { id: 'revoked',     label: 'Revoked',                tone: 'slate'   },
  { id: 'expired',     label: 'Expired',                tone: 'red'     },
  { id: 'pending',     label: 'Pending Activation',     tone: 'blue'    },
  { id: 'in_progress', label: 'Activation In Progress', tone: 'amber'   },
  { id: 'active',      label: 'Active',                 tone: 'emerald' },
]

const STATE_BY_ID = Object.fromEntries(PARENT_ACCESS_STATES.map((s) => [s.id, s]))

const isPast = (value) => {
  if (!value) return false
  const t = new Date(value).getTime()
  return Number.isFinite(t) && t <= Date.now()
}

/**
 * @param {object}  input
 * @param {boolean} input.hasAccount    parent_student.parent_id IS NOT NULL
 * @param {string}  input.accountStatus users.account_status
 * @param {object}  [input.invitation]  the newest parent_invitations row, or null
 *        {string}  invitation.expires_at
 *        {string}  invitation.consumed_at
 *        {string}  invitation.revoked_at
 *        {boolean} invitation.has_live_code   code_hash IS NOT NULL AND not expired
 * @returns {{id: string, label: string, tone: string}}
 */
const resolveParentAccess = ({ hasAccount, accountStatus, invitation } = {}) => {
  if (!hasAccount) return STATE_BY_ID.none

  // An account that can sign in is Active whatever its invitation history says
  // — a consumed invitation is exactly what an activated account looks like.
  if (accountStatus === 'active') return STATE_BY_ID.active
  if (accountStatus === 'revoked') return STATE_BY_ID.revoked

  // From here the account is 'pending': invited, no password yet.
  if (!invitation) return STATE_BY_ID.pending
  if (invitation.revoked_at) return STATE_BY_ID.revoked
  if (invitation.consumed_at) return STATE_BY_ID.pending
  if (isPast(invitation.expires_at)) return STATE_BY_ID.expired

  // A live code means they are mid-activation right now. When it lapses the row
  // falls back to Pending Activation on its own — the invitation outlives the
  // code, so they can simply ask for another.
  return invitation.has_live_code ? STATE_BY_ID.in_progress : STATE_BY_ID.pending
}

/** Can an admin issue (or re-issue) a code-bearing invitation for this row? */
const canInvite = (state) => state === 'none' || state === 'revoked' || state === 'expired'

/** Can an admin revoke? Anything that currently grants or promises access. */
const canRevoke = (state) => state === 'pending' || state === 'in_progress' || state === 'active'

/**
 * The email is editable only while the invitation is unclaimed. Once the parent
 * has activated, the address is their sign-in identity and is theirs to change.
 */
const canChangeEmail = (state) => state !== 'active'

module.exports = {
  PARENT_ACCESS_STATES,
  resolveParentAccess,
  canInvite,
  canRevoke,
  canChangeEmail,
}

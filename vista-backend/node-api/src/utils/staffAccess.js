/**
 * The account-access states of a teacher or admin, derived rather than stored.
 *
 * The same idea as utils/parentAccess.js, and mostly the same states, but staff
 * have one thing parents do not: `users.is_active`. A staff account is switched
 * off by deactivating it (it keeps its assignments, grades and history), never
 * by revoking, so "Deactivated" takes the place of "Revoked" and outranks
 * everything else — a deactivated account cannot sign in or activate whatever
 * its invitation says.
 *
 * Mirrored in vista-dashboard/src/utils/staffAccess.js. Same convention as
 * utils/roles.js: if you change a state here, change it there in the same
 * commit.
 */

const STAFF_ACCESS_STATES = [
  { id: 'active',      label: 'Active',                 tone: 'emerald' },
  { id: 'pending',     label: 'Pending Activation',     tone: 'blue'    },
  { id: 'in_progress', label: 'Activation In Progress', tone: 'amber'   },
  { id: 'expired',     label: 'Expired',                tone: 'red'     },
  { id: 'deactivated', label: 'Deactivated',            tone: 'slate'   },
]

const STATE_BY_ID = Object.fromEntries(STAFF_ACCESS_STATES.map((s) => [s.id, s]))

const isPast = (value) => {
  if (!value) return false
  const t = new Date(value).getTime()
  return Number.isFinite(t) && t <= Date.now()
}

/**
 * @param {object}  input
 * @param {boolean} input.isActive       users.is_active
 * @param {string}  input.accountStatus  users.account_status
 * @param {object}  [input.invitation]   the newest account_invitations row, or null
 * @returns {{id: string, label: string, tone: string}}
 */
const resolveStaffAccess = ({ isActive, accountStatus, invitation } = {}) => {
  if (!isActive) return STATE_BY_ID.deactivated
  if (accountStatus === 'active') return STATE_BY_ID.active
  // Staff are never revoked; read it as switched off rather than guess.
  if (accountStatus === 'revoked') return STATE_BY_ID.deactivated

  // From here the account is 'pending': invited, no password yet. With no open
  // invitation they cannot activate, which is what Expired means to an admin —
  // reissue it.
  if (!invitation || invitation.revoked_at || invitation.consumed_at) return STATE_BY_ID.expired
  if (isPast(invitation.expires_at)) return STATE_BY_ID.expired
  return invitation.has_live_code ? STATE_BY_ID.in_progress : STATE_BY_ID.pending
}

/** Reissue reopens the invitation for 30 days. Only for an account that never activated. */
const canReissue = (state) => state === 'pending' || state === 'in_progress' || state === 'expired'

/** Cancelling an invitation deactivates an account that never activated. */
const canCancel = canReissue

module.exports = {
  STAFF_ACCESS_STATES,
  resolveStaffAccess,
  canReissue,
  canCancel,
}

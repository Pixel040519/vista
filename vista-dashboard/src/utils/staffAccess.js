/**
 * The account-access states of a teacher or admin.
 *
 * Mirror of vista-backend/node-api/src/utils/staffAccess.js — same convention
 * as utils/roles.js and utils/parentAccess.js. The API sends a resolved
 * `access` object on every staff row, so beyond the resolver this file only
 * decides which actions a row offers and the line under its chip. How things
 * are worded and coloured is shared with the Parents tab, in
 * utils/accessDisplay.js.
 *
 * If you change a state here, change it there in the same commit.
 */
import { whenSignedIn, invitedLine, expiredLine, IN_PROGRESS_LINE } from './accessDisplay'

export const STAFF_ACCESS_STATES = [
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

export function resolveStaffAccess({ isActive, accountStatus, invitation } = {}) {
  if (!isActive) return STATE_BY_ID.deactivated
  if (accountStatus === 'active') return STATE_BY_ID.active
  if (accountStatus === 'revoked') return STATE_BY_ID.deactivated
  if (!invitation || invitation.revoked_at || invitation.consumed_at) return STATE_BY_ID.expired
  if (isPast(invitation.expires_at)) return STATE_BY_ID.expired
  return invitation.has_live_code ? STATE_BY_ID.in_progress : STATE_BY_ID.pending
}

/** The state the API sent, or one derived from the row. */
export const staffAccessOf = (staff) =>
  STATE_BY_ID[staff?.access?.id] || resolveStaffAccess({
    isActive: staff?.is_active,
    accountStatus: staff?.account_status,
    invitation: staff?.invitation,
  })

/** An account that never activated: its invitation can be reissued or cancelled. */
export const canReissue = (stateId) => stateId === 'pending' || stateId === 'in_progress' || stateId === 'expired'
export const canCancel  = canReissue

/** The sign-in email is correctable until the holder activates — see the API's changeStaffEmail(). */
export const canChangeStaffEmail = (staff) => !staff?.has_password

/** The one line under the chip. */
export function staffAccessDetail(staff, { meId } = {}) {
  switch (staffAccessOf(staff).id) {
    case 'active':
      return staff?.last_login_at ? `Last signed in ${whenSignedIn(staff.last_login_at)}` : 'Has activated their account'
    case 'pending':     return invitedLine(staff?.invitation, meId)
    case 'in_progress': return IN_PROGRESS_LINE
    case 'expired':     return expiredLine(staff?.invitation)
    case 'deactivated': return staff?.has_password ? 'Can no longer sign in' : 'Invitation cancelled · never activated'
    default:            return ''
  }
}

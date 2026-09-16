/**
 * Creating, re-issuing and revoking parent portal invitations.
 *
 * This replaces ensureParentAccount(), which took a password the admin had
 * typed and bcrypt-hashed it. The account row is now born with
 * password_hash NULL / account_status 'pending', and the parent sets the
 * password themselves after proving they control the address.
 *
 * What did NOT change, and must not: an email is one login. An existing parent
 * account is reused rather than duplicated (the sibling case), and an email
 * belonging to a teacher or admin is refused — linking it would hand that staff
 * account a learner's parent-side access, pickup QR included.
 */
const { AppError } = require('../middleware/error.middleware')
const { ROLES } = require('./roles')
const { invitationExpiry } = require('./authCodes')

/** The newest invitation for an account, live or not. */
const latestInvitation = async (client, userId) => {
  const r = await client.query(
    `SELECT id, email, invited_at, expires_at, consumed_at, revoked_at,
            (code_hash IS NOT NULL AND code_expires_at > NOW()) AS has_live_code,
            code_expires_at
       FROM parent_invitations
      WHERE user_id = $1
      ORDER BY invited_at DESC
      LIMIT 1`,
    [userId]
  )
  return r.rows[0] || null
}

/**
 * Create or refresh the live invitation.
 *
 * The partial unique index allows exactly one unconsumed, unrevoked row per
 * account, so this updates that row when it exists and inserts otherwise.
 * Either way any unused code is cleared — which is how "issuing a new code
 * invalidates the previous one" happens by construction rather than by rule.
 *
 * Sends nothing. No message goes out until the parent asks for a code.
 */
const issueInvitation = async (client, { userId, email, invitedBy }) => {
  const expiresAt = invitationExpiry()
  const updated = await client.query(
    `UPDATE parent_invitations
        SET email = $2, invited_by = $3, invited_at = NOW(), expires_at = $4,
            code_hash = NULL, code_issued_at = NULL, code_expires_at = NULL,
            code_attempts = 0, updated_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
      RETURNING id`,
    [userId, email, invitedBy || null, expiresAt]
  )
  if (updated.rows.length) return updated.rows[0].id

  const inserted = await client.query(
    `INSERT INTO parent_invitations (user_id, email, invited_by, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, email, invitedBy || null, expiresAt]
  )
  return inserted.rows[0].id
}

/**
 * Give this email access to the portal.
 *
 * Returns {id, outcome} where outcome is one of:
 *   'invited'  — a new account was created, Pending Activation
 *   'reissued' — an existing pending account got a fresh invitation
 *   'restored' — a revoked account that already had a password is live again
 *   'linked'   — the email is already an active account; nothing to invite
 */
const grantParentAccess = async (client, { email, surname, first_name, middle_name, phone, invitedBy }) => {
  const exist = await client.query(
    'SELECT id, role, account_status, password_hash FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email]
  )

  if (exist.rows.length) {
    const u = exist.rows[0]
    if (u.role !== ROLES.PARENT) {
      throw new AppError(
        `${email} already belongs to a staff account. Use a different email for parent portal access.`,
        409
      )
    }

    // Already signing in. This is the sibling case — the same parent gaining a
    // second child — and there is nothing to activate.
    if (u.account_status === 'active') return { id: u.id, outcome: 'linked' }

    // Revoked but holding a password: they had an account and it was switched
    // off. Restoring it is the right move; making them re-activate would be
    // asking them to prove something they already proved.
    if (u.password_hash) {
      await client.query("UPDATE users SET account_status='active', updated_at=NOW() WHERE id=$1", [u.id])
      return { id: u.id, outcome: 'restored' }
    }

    await client.query("UPDATE users SET account_status='pending', updated_at=NOW() WHERE id=$1", [u.id])
    await issueInvitation(client, { userId: u.id, email, invitedBy })
    return { id: u.id, outcome: 'reissued' }
  }

  // password_hash stays NULL: there is no password until the parent sets one,
  // and no temporary the admin could read off a screen.
  const created = await client.query(
    `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone, account_status)
     VALUES ($1, NULL, $2, $3, $4, 'parent', $5, 'pending') RETURNING id`,
    [email, surname, first_name, middle_name || null, phone || null]
  )
  const id = created.rows[0].id
  await issueInvitation(client, { userId: id, email, invitedBy })
  return { id, outcome: 'invited' }
}

/**
 * Withdraw access. Kills any live invitation and any unused code with it, and
 * stops sign-in for an account that had already activated. The guardian row,
 * the account and all history stay — this is access, not deletion.
 */
const revokeParentAccess = async (client, { userId, revokedBy }) => {
  await client.query(
    `UPDATE parent_invitations
        SET revoked_at = NOW(), revoked_by = $2,
            code_hash = NULL, code_issued_at = NULL, code_expires_at = NULL, updated_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId, revokedBy || null]
  )
  await client.query("UPDATE users SET account_status='revoked', updated_at=NOW() WHERE id=$1", [userId])
}

/** Change the address an unclaimed invitation points at. */
const changeInvitationEmail = async (client, { userId, email }) => {
  await client.query('UPDATE users SET email=$2, updated_at=NOW() WHERE id=$1', [userId, email])
  await client.query(
    `UPDATE parent_invitations
        SET email = $2, code_hash = NULL, code_issued_at = NULL, code_expires_at = NULL,
            code_attempts = 0, updated_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId, email]
  )
}

/**
 * The sentence appended to a guardian save, so the admin learns which of the
 * four things happened. A reused account used to silently ignore the password
 * the admin had typed; the same trap applies to an invitation that was never
 * created because the account was already live.
 */
const accessNote = (outcome, email) => {
  switch (outcome) {
    case 'invited':
      return ` ${email} can now activate the VISTA Parent app. No message has been sent yet — activation starts from the app.`
    case 'reissued':
      return ` A fresh invitation was issued for ${email}. Any unused code was cancelled.`
    case 'restored':
      return ` Portal access for ${email} was restored. Their existing password still works.`
    case 'linked':
      return ` ${email} already has an active parent account, so this guardian was linked to it. No invitation was needed and no password was changed.`
    default:
      return ''
  }
}

module.exports = {
  latestInvitation,
  issueInvitation,
  grantParentAccess,
  revokeParentAccess,
  changeInvitationEmail,
  accessNote,
}

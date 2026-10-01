/**
 * Account invitations — the part that is the same for every role.
 *
 * An invitation authorizes an email address. Nothing is sent when one is
 * created: the holder of the address asks for a code (the VISTA Parent app for
 * a parent, "Activate your account" on the dashboard's sign-in page for staff),
 * proves they hold it, and chooses their own password. The admin never sets,
 * sees or can recover that password.
 *
 * Parent-specific rules — one email is one login across a family's children,
 * linking contact-only guardian entries, restoring a revoked account — live in
 * utils/parentInvitations.js on top of this. Staff-specific ones live in
 * routes/account.routes.js.
 */
const { invitationExpiry } = require('./authCodes')

/** The newest invitation for an account, live or not. */
const latestInvitation = async (client, userId) => {
  const r = await client.query(
    `SELECT id, email, invited_at, expires_at, consumed_at, revoked_at,
            (code_hash IS NOT NULL AND code_expires_at > NOW()) AS has_live_code,
            code_expires_at
       FROM account_invitations
      WHERE user_id = $1
      ORDER BY invited_at DESC, (consumed_at IS NULL AND revoked_at IS NULL) DESC
      LIMIT 1`,
    [userId]
  )
  return r.rows[0] || null
}

/**
 * The newest invitation as a JSON object, for a list query — a correlated
 * subquery rather than a lateral join, so it can sit beside a `json_agg` and a
 * `GROUP BY u.id` without multiplying rows or widening the grouping.
 *
 * @param {string} userIdExpr  the SQL expression for the account's id, e.g. `u.id`
 */
const invitationJsonSql = (userIdExpr) => `(
  SELECT row_to_json(x) FROM (
    SELECT ai.invited_at, ai.expires_at, ai.consumed_at, ai.revoked_at,
           (ai.code_hash IS NOT NULL AND ai.code_expires_at > NOW()) AS has_live_code,
           ai.invited_by, ib.full_name AS invited_by_name
      FROM account_invitations ai
      LEFT JOIN users ib ON ib.id = ai.invited_by
     WHERE ai.user_id = ${userIdExpr}
     -- On a tie (two rows written in one transaction share NOW()) the open
     -- invitation is the one that describes the account.
     ORDER BY ai.invited_at DESC, (ai.consumed_at IS NULL AND ai.revoked_at IS NULL) DESC
     LIMIT 1
  ) x
)`

/**
 * Create or refresh the live invitation.
 *
 * The partial unique index allows exactly one unconsumed, unrevoked row per
 * account, so this updates that row when it exists and inserts otherwise.
 * Either way any unused code is cleared — which is how "issuing a new code
 * invalidates the previous one" happens by construction rather than by rule.
 *
 * Sends nothing. No message goes out until the holder asks for a code.
 */
const issueInvitation = async (client, { userId, email, invitedBy }) => {
  const expiresAt = invitationExpiry()
  const updated = await client.query(
    `UPDATE account_invitations
        SET email = $2, invited_by = $3, invited_at = NOW(), expires_at = $4,
            code_hash = NULL, code_issued_at = NULL, code_expires_at = NULL,
            code_attempts = 0, updated_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
      RETURNING id`,
    [userId, email, invitedBy || null, expiresAt]
  )
  if (updated.rows.length) return updated.rows[0].id

  const inserted = await client.query(
    `INSERT INTO account_invitations (user_id, email, invited_by, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, email, invitedBy || null, expiresAt]
  )
  return inserted.rows[0].id
}

/**
 * Close the live invitation, if there is one, and any unused code with it.
 * Touches only the invitation — what that means for the account (revoked for a
 * parent, deactivated for staff) is the caller's to write.
 */
const revokeLiveInvitation = async (client, { userId, revokedBy }) => {
  await client.query(
    `UPDATE account_invitations
        SET revoked_at = NOW(), revoked_by = $2,
            code_hash = NULL, code_issued_at = NULL, code_expires_at = NULL, updated_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId, revokedBy || null]
  )
}

/** Change the address an unclaimed invitation points at, on the account and the invitation together. */
const changeInvitationEmail = async (client, { userId, email }) => {
  await client.query('UPDATE users SET email=$2, updated_at=NOW() WHERE id=$1', [userId, email])
  await client.query(
    `UPDATE account_invitations
        SET email = $2, code_hash = NULL, code_issued_at = NULL, code_expires_at = NULL,
            code_attempts = 0, updated_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId, email]
  )
}

module.exports = {
  latestInvitation,
  invitationJsonSql,
  issueInvitation,
  revokeLiveInvitation,
  changeInvitationEmail,
}

/**
 * One-time verification codes for parent account activation and password
 * reset, plus the two things that keep those endpoints from answering the
 * question "does this email have a VISTA account?".
 *
 * Both endpoints are unauthenticated, so an attacker controls the input and
 * watches the output. Two channels leak:
 *
 *   1. WHAT we say. Handled by the callers: one generic message on every
 *      branch (see GENERIC_ACTIVATION / GENERIC_RESET below).
 *   2. HOW LONG we take. Handled here. A sleep floor alone is not enough —
 *      if the real branch runs a 250 ms bcrypt and the floor is 200 ms, the
 *      floor is invisible and the branches separate again. So the branch with
 *      no account to check burns the SAME work (equalizeWork) and only then
 *      does both branches pad to a common floor (settle).
 *
 * Mail is never awaited by a request — see utils/mailer.js — so the response
 * time never depends on the SMTP provider either.
 */
const crypto = require('crypto')
const bcrypt = require('bcryptjs')

// Codes are 6 digits: short enough to read off a phone, and with a 10-minute
// life and 5 attempts the odds of a blind guess landing are 5 in a million.
const CODE_LENGTH = 6
const CODE_TTL_MINUTES = 10
const MAX_CODE_ATTEMPTS = 5
// An invitation an admin creates is good for a month — long enough to survive
// a school holiday, short enough that a forgotten one does not stay live.
const INVITATION_TTL_DAYS = 30
// Every unauthenticated auth response takes at least this long, whatever it did.
const RESPONSE_FLOOR_MS = 600
const BCRYPT_COST = 12

// The exact words both branches answer with. They must not vary: not by
// status code, not by punctuation, not by which of them ran.
const GENERIC_ACTIVATION =
  'If an eligible VISTA invitation exists for this email, a verification code will be sent. Please check your email.'
const GENERIC_RESET =
  'If an account exists for this email, password-reset instructions will be sent.'
// Identical whether the email was never invited, the code was wrong, or the
// code expired. "Wrong code" and "no invitation" must not be distinguishable.
const GENERIC_CODE_REJECTED =
  'That code is not valid or has expired. Request a new one and try again.'

// Work the no-account branch burns so it costs what a real bcrypt compare
// costs. Warmed at load so the first request does not pay to build it.
let dummyHash = null
const dummyHashReady = bcrypt
  .genSalt(BCRYPT_COST)
  .then((salt) => bcrypt.hash('vista-timing-equalizer', salt))
  .then((h) => { dummyHash = h })
  .catch(() => { /* equalizeWork falls back to a fresh hash below */ })

/** A cryptographically secure numeric code. Never logged, never stored raw. */
const generateCode = () => {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += crypto.randomInt(0, 10).toString()
  return out
}

const hashCode = async (code) => bcrypt.hash(code, await bcrypt.genSalt(BCRYPT_COST))

const compareCode = async (code, hash) => {
  if (!hash) return false
  return bcrypt.compare(code, hash)
}

/**
 * Spend what a real bcrypt compare would spend, and discard it. Called on
 * every branch that has no hash to check — an unknown email, a revoked
 * invitation, an account that is already active.
 */
const equalizeWork = async () => {
  await dummyHashReady
  const h = dummyHash || (await hashCode('vista-timing-equalizer'))
  await bcrypt.compare('vista-timing-equalizer', h)
}

/**
 * Pad to the common floor. Pass the value captured at the very top of the
 * handler, before any branching.
 *
 *   const startedAt = Date.now()
 *   ... whichever branch ...
 *   await settle(startedAt)
 *   res.json({ message: GENERIC_ACTIVATION })
 */
const settle = async (startedAt) => {
  const remaining = RESPONSE_FLOOR_MS - (Date.now() - startedAt)
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
}

const codeExpiry = () => new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)
const invitationExpiry = () => new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

/** A short-lived single-use ticket proving a code was just verified. */
const generateActivationToken = () => crypto.randomBytes(32).toString('hex')

module.exports = {
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  INVITATION_TTL_DAYS,
  RESPONSE_FLOOR_MS,
  GENERIC_ACTIVATION,
  GENERIC_RESET,
  GENERIC_CODE_REJECTED,
  generateCode,
  hashCode,
  compareCode,
  equalizeWork,
  settle,
  codeExpiry,
  invitationExpiry,
  generateActivationToken,
}

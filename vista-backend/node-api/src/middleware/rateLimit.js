/**
 * Per-route rate limiters for the unauthenticated auth endpoints.
 *
 * These run in EVERY environment. The existing limiter in server.js is wrapped
 * in `if (NODE_ENV === 'production')` and is one global 100-per-15-minutes
 * bucket across all of /api/ — which means that outside production nothing is
 * limited at all, and inside it a single bucket is shared by every route. An
 * endpoint that mails a one-time code to whoever asks cannot ship on that.
 *
 * Every limiter here is attached inside auth.routes.js rather than server.js,
 * because the per-email ones read req.body and so must run after
 * express.json() — which server.js installs after its own limiter block.
 *
 * Two keys per request, deliberately:
 *   - per IP    stops one source working through a list of addresses
 *   - per email stops a list of sources hammering one mailbox
 * Neither depends on whether the email exists, so being limited reveals
 * nothing that answering normally would not.
 */
const rateLimit = require('express-rate-limit')

const HOUR = 60 * 60 * 1000

// Neutral, and identical for every caller — the 429 must not become the signal
// that the generic 200 was written to avoid.
const TOO_MANY = { error: 'Too many attempts. Please wait a while and try again.' }

const emailKey = (req) => String(req.body?.email || '').trim().toLowerCase() || 'anonymous'

const base = {
  windowMs: HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
}

/** Asking for a code — activation or password reset. The mailing endpoints. */
const requestCodePerIp = rateLimit({ ...base, limit: 20 })

const requestCodePerEmail = rateLimit({
  ...base,
  limit: 5,
  keyGenerator: emailKey,
})

/**
 * Submitting a code. The per-invitation attempt cap (5, then the code is burned)
 * lives in the database and is the real defence; this only stops someone
 * cycling fresh invitations to get more guesses.
 */
const verifyCodePerIp = rateLimit({ ...base, limit: 30 })

const verifyCodePerEmail = rateLimit({
  ...base,
  limit: 15,
  keyGenerator: emailKey,
})

/** Sign-in. Not part of the invitation work, but the same reasoning applies. */
const loginPerIp = rateLimit({ ...base, limit: 40 })

module.exports = {
  requestCodePerIp,
  requestCodePerEmail,
  verifyCodePerIp,
  verifyCodePerEmail,
  loginPerIp,
}

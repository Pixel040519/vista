/**
 * Outbound mail for account activation and password reset.
 *
 * Two rules this module exists to enforce:
 *
 *   1. A REQUEST NEVER AWAITS A SEND. queueMail() returns immediately and the
 *      drain runs on its own. If delivery were awaited, an unauthenticated
 *      caller could tell an invited email from an uninvited one just by timing
 *      the response — the branch that sends would take as long as the SMTP
 *      provider does. See utils/authCodes.js for the other half of that.
 *
 *   2. THE RAW CODE IS NEVER LOGGED. It is passed to a template and dropped.
 *      Nothing in this file writes it to a log, an error, or a retry record —
 *      only its bcrypt hash is persisted, by the caller.
 *
 * "Asynchronous job queue where practical" is read here as an in-process
 * deferred queue with retry. VISTA runs one Node process against one Postgres
 * and has no Redis or broker; adding one to send a handful of codes a day
 * would be infrastructure nobody operates. The tradeoff is real and worth
 * naming: a crash mid-queue loses unsent mail. That is survivable because a
 * parent who gets nothing simply asks for another code, which is already the
 * designed recovery path.
 */
const nodemailer = require('nodemailer')

const FROM = process.env.MAIL_FROM || 'VISTA <no-reply@vista.school>'
const TRANSPORT = (process.env.MAIL_TRANSPORT || '').toLowerCase()
const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 2000

// Dev-only escape hatch: with no SMTP server to hand, print the message to the
// console so the activation flow can be exercised end to end. This DOES print
// the code, which is exactly what rule 2 forbids in a real deployment — so it
// refuses to start in production rather than relying on nobody setting it.
const isConsoleTransport = TRANSPORT === 'console'
if (isConsoleTransport && process.env.NODE_ENV === 'production') {
  throw new Error('MAIL_TRANSPORT=console prints verification codes to the log and must not be used in production. Configure SMTP_HOST instead.')
}

let transporter = null
const getTransporter = () => {
  if (transporter) return transporter
  if (!process.env.SMTP_HOST) return null
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  })
  return transporter
}

const queue = []
let draining = false

const drain = async () => {
  if (draining) return
  draining = true
  while (queue.length) {
    const job = queue.shift()
    try {
      if (isConsoleTransport) {
        // eslint-disable-next-line no-console
        console.log(`\n── [dev mail] to ${job.to}\n   ${job.subject}\n${job.text}\n──\n`)
      } else {
        const tx = getTransporter()
        if (!tx) {
          // No SMTP configured and not in console mode. Say so once per message,
          // without the body — a missing provider is an operator problem, and
          // the parent's recovery path (ask for another code) still works once
          // it is fixed.
          console.warn(`[mailer] no SMTP configured; dropped "${job.subject}" to ${job.to}`)
          continue
        }
        await tx.sendMail({ from: FROM, to: job.to, subject: job.subject, text: job.text })
      }
    } catch (err) {
      job.attempts = (job.attempts || 0) + 1
      if (job.attempts < MAX_ATTEMPTS) {
        setTimeout(() => { queue.push(job); drain() }, RETRY_BASE_MS * job.attempts)
      } else {
        // Note the failure, never the contents.
        console.error(`[mailer] giving up on "${job.subject}" to ${job.to} after ${job.attempts} attempts: ${err.message}`)
      }
    }
  }
  draining = false
}

/** Hand a message to the queue and return at once. Never throws, never awaits delivery. */
const queueMail = ({ to, subject, text }) => {
  queue.push({ to, subject, text, attempts: 0 })
  setImmediate(drain)
}

/**
 * Activation code. Deliberately carries no student name, grade, section or LRN:
 * this message goes to an address nobody has proved they control yet, so it
 * must not disclose anything about a child — or, for staff, about the role
 * being granted.
 *
 * `forParent` only chooses where the message says to enter the code: a parent
 * activates in the VISTA Parent app, staff on the dashboard's sign-in page.
 */
const sendActivationCode = (email, code, ttlMinutes, { forParent = true } = {}) => queueMail({
  to: email,
  subject: 'Your VISTA activation code',
  text: [
    forParent ? 'Your VISTA Parent app verification code is:' : 'Your VISTA verification code is:',
    '',
    `    ${code}`,
    '',
    `The code expires in ${ttlMinutes} minutes and can be used once.`,
    '',
    forParent
      ? 'Enter it in the VISTA Parent app to finish activating your account and choose your password.'
      : 'Enter it on the VISTA sign-in page, under "Activate your account", to finish activating your account and choose your password.',
    '',
    'If you were not expecting this, you can ignore this message — no account is created or changed until the code is used.',
  ].join('\n'),
})

/** Password reset code. Same restraint: no account or child details. */
const sendPasswordResetCode = (email, code, ttlMinutes) => queueMail({
  to: email,
  subject: 'Your VISTA password reset code',
  text: [
    'Your VISTA password reset code is:',
    '',
    `    ${code}`,
    '',
    `The code expires in ${ttlMinutes} minutes and can be used once.`,
    '',
    'If you did not ask to reset your password, you can ignore this message — nothing has changed.',
  ].join('\n'),
})

module.exports = { queueMail, sendActivationCode, sendPasswordResetCode }

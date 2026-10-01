const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Joi      = require('joi');
const { query } = require('../config/database');
const { authenticate, authorizeSuperAdmin } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { normaliseName } = require('../utils/nameHelper');
const { gradeScopeForRole } = require('../utils/roles');
const { photoUrlFromPath } = require('../middleware/upload.middleware');
const { advisorySections } = require('../utils/advisory');
const { withTransaction } = require('../config/database');
const {
  requestCodePerIp, requestCodePerEmail, verifyCodePerIp, verifyCodePerEmail, loginPerIp,
} = require('../middleware/rateLimit');
const {
  CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS,
  GENERIC_ACTIVATION, GENERIC_RESET, GENERIC_CODE_REJECTED,
  generateCode, hashCode, compareCode, equalizeWork, settle, codeExpiry,
} = require('../utils/authCodes');
const { sendActivationCode, sendPasswordResetCode } = require('../utils/mailer');

/**
 * The sections a teacher advises in the **active** school year.
 *
 * Scoped server-side, unlike `assignments`, which deliberately returns every
 * year and is filtered client-side against `active_school_year` — an advisory
 * is a now-fact, and no surface asks for last year's. `syncActiveSchoolYear()`
 * on the frontend re-fetches /me whenever the active year changes, so this
 * stays current without new plumbing.
 *
 * An array, though `idx_sections_adviser_sy_unique` caps it at one: the shape
 * is what callers destructure, and array-to-scalar is a painful change to make
 * later if the one-per-year rule is ever relaxed.
 *
 * It reads `utils/advisory.js` — the same module that decides what the advisory
 * endpoints will actually serve — rather than repeating the query, so what the
 * client is told it advises and what the API will hand over cannot drift.
 */
const loadAdvisory = (teacherId) => advisorySections(teacherId);

const registerSchema = Joi.object({
  email:       Joi.string().email().required(),
  password:    Joi.string().min(8).required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  // 'parent' is deliberately absent: a parent account is created only by the
  // invitation flow, from an email the school has authorized.
  role:        Joi.string().valid('super_admin','admin_ece','admin_elem','teacher').required(),
  phone:       Joi.string().optional().allow(''),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

const generateTokens = (user) => {
  const payload = { id: user.id, email: user.email, role: user.role };
  return {
    accessToken:  jwt.sign(payload, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }),
    refreshToken: jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' }),
  };
};

/**
 * The session payload both /login and activation return, and the shape /me
 * mirrors. Extracted so a freshly activated parent lands with exactly what a
 * signing-in parent gets — the vista_parent app reads one shape, not two.
 */
const buildUserPayload = async (req, user) => {
  const payload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    surname: user.surname,
    first_name: user.first_name,
    middle_name: user.middle_name,
    role: user.role,
    phone: user.phone,
    photo_url: photoUrlFromPath(req, user.photo_path),
    grade_scope: gradeScopeForRole(user.role),
  };

  if (user.role === 'teacher') {
    const asgn = await query(
      `SELECT id, grade_level, section, subject, school_year
       FROM teacher_assignments WHERE teacher_id=$1
       ORDER BY grade_level, section, subject`,
      [user.id]
    );
    payload.assignments = asgn.rows;
    payload.advisory    = await loadAdvisory(user.id);
  }

  const syRes = await query(
    'SELECT label, period_model, grading_policy FROM school_years WHERE is_active=TRUE LIMIT 1'
  );
  payload.active_school_year = syRes.rows[0]?.label || null;
  payload.period_model   = syRes.rows[0]?.period_model   || '4Q';
  payload.grading_policy = syRes.rows[0]?.grading_policy || 'DO8_2015';
  return payload;
};

/**
 * Record a sign-in. The staff roster shows it ("Last signed in today, 7:42 AM"),
 * which is what tells an admin an Active account is actually in use.
 */
const stampLogin = (userId) =>
  query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [userId]);

// POST /api/auth/register
//
// Was unauthenticated AND took `role` from the request body, so anyone who
// could reach the API could mint a super_admin. It is now super-admin only,
// and `parent` is gone from the role list: a parent account exists only where
// the school has authorized an email, which is what the invitation flow below
// is for. Staff accounts have their own super-admin-gated CRUD at
// /api/accounts/*; this endpoint stays for bootstrapping and scripts.
router.post('/register', authenticate, authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);

    const { email, password, role, phone, ...nameFields } = value;
    const { surname, first_name, middle_name } = normaliseName(nameFields);

    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) throw new AppError('Email already registered.', 409);

    const hash = await bcrypt.hash(password, await bcrypt.genSalt(12));

    const result = await query(
      `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, full_name, surname, first_name, middle_name, role, created_at`,
      [email, hash, surname, first_name, middle_name || null, role, phone || null]
    );

    const user = result.rows[0];
    res.status(201).json({ message: 'User registered successfully.', user, ...generateTokens(user) });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', loginPerIp, async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);

    // Case-insensitive, matching the LOWER(email) unique index. It used to match
    // exactly, so an invitation issued for "Rosa@mail.com" would not be found by
    // a parent who typed "rosa@mail.com" — and they would have had no way to
    // tell why.
    const result = await query('SELECT * FROM users WHERE LOWER(email)=LOWER($1) AND is_active=TRUE', [value.email]);
    if (!result.rows.length) throw new AppError('Invalid credentials.', 401);

    const user = result.rows[0];

    // An invited-but-not-yet-activated account has no password_hash at all, so
    // without this bcrypt.compare would be handed NULL. Answering with the same
    // 'Invalid credentials.' as a wrong password is deliberate: telling an
    // unauthenticated caller "that account exists but is not activated" is the
    // same disclosure the activation endpoint goes to such lengths to avoid.
    if (user.account_status !== 'active' || !user.password_hash) {
      throw new AppError('Invalid credentials.', 401);
    }

    if (!await bcrypt.compare(value.password, user.password_hash)) throw new AppError('Invalid credentials.', 401);

    await stampLogin(user.id);
    res.json({
      message: 'Login successful.',
      user: await buildUserPayload(req, user),
      ...generateTokens(user),
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token required.', 401);
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    // account_status is re-checked here, not just at login: revoking access has
    // to end a session that is already running, and a refresh token lives 7 days.
    const result  = await query(
      "SELECT id,email,role FROM users WHERE id=$1 AND is_active=TRUE AND account_status='active'",
      [decoded.id]
    );
    if (!result.rows.length) throw new AppError('User not found.', 401);
    res.json(generateTokens(result.rows[0]));
  } catch (err) {
    // An expired refresh token used to fall through to a 500.
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new AppError('Invalid refresh token.', 401));
    }
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, surname, first_name, middle_name, role, phone, photo_path, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!result.rows.length) throw new AppError('User not found.', 404);
    const user = result.rows[0];
    user.photo_url = photoUrlFromPath(req, user.photo_path);
    delete user.photo_path;
    user.grade_scope = gradeScopeForRole(user.role);

    if (user.role === 'teacher') {
      const asgn = await query(
        `SELECT id, grade_level, section, subject, school_year
         FROM teacher_assignments WHERE teacher_id=$1
         ORDER BY grade_level, section, subject`,
        [user.id]
      );
      user.assignments = asgn.rows;
      user.advisory    = await loadAdvisory(user.id);
    }

    const syRes = await query(
      'SELECT label, period_model, grading_policy FROM school_years WHERE is_active=TRUE LIMIT 1'
    );
    user.active_school_year = syRes.rows[0]?.label || null;
    user.period_model   = syRes.rows[0]?.period_model   || '4Q';
    user.grading_policy = syRes.rows[0]?.grading_policy || 'DO8_2015';

    res.json({ user });
  } catch (err) { next(err); }
});

/* ──────────────────────────────────────────────────────────────────────────
 * Account activation — parents and staff alike
 *
 * VISTA has no self-registration. An account exists only where an admin has
 * authorized the email address — Students → Manage Guardians → Add Invitation
 * for a parent, Account Management → Invite Teacher / Invite Admin for staff —
 * and these three endpoints let the holder of that address prove they control
 * it and choose their own password. A parent does it from the VISTA Parent
 * app, staff from "Activate your account" on the dashboard's sign-in page; the
 * endpoints are the same and never ask which.
 *
 * `u.is_active = TRUE` on every lookup: a deactivated staff account must not
 * be activatable, whatever its invitation says. Parent accounts are never
 * deactivated (they are revoked instead), so the clause costs them nothing.
 *
 * ANTI-ENUMERATION. These are the only unauthenticated endpoints in the API
 * that take an arbitrary email, so they are the ones that could be used to ask
 * "does this address have a VISTA account?". Four things keep the answer to
 * themselves, and all four have to hold together:
 *
 *   1. One message on every branch. GENERIC_ACTIVATION for a request,
 *      GENERIC_CODE_REJECTED for a failed verify — the same words for an
 *      uninvited address, a revoked invitation, a wrong code and an expired
 *      one.
 *   2. One status code per endpoint, whatever happened.
 *   3. Equal work. The branch with nothing to check runs equalizeWork(), which
 *      burns what the real bcrypt costs, and both branches then settle() to a
 *      common floor. A floor alone would be invisible behind a 250 ms bcrypt.
 *   4. Mail is queued, never awaited, so the response never carries the SMTP
 *      provider's latency as a tell.
 *
 * Breaking any one of them re-opens the hole, so treat a change to one as a
 * change to all four.
 * ────────────────────────────────────────────────────────────────────────── */

const emailOnlySchema = Joi.object({ email: Joi.string().email().required() });

/** Everything the two `request` endpoints do once they know the outcome. */
const answerGenerically = async (res, startedAt, message) => {
  await settle(startedAt);
  res.json({ message });
};

// POST /api/auth/activation/request  — { email }
router.post('/activation/request', requestCodePerIp, requestCodePerEmail, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { error, value } = emailOnlySchema.validate(req.body || {}, { stripUnknown: true });
    // A syntax check only. Rejecting "not-an-email" discloses nothing about
    // accounts, and every well-formed address takes the uniform path below.
    if (error) throw new AppError('Enter a valid email address.', 422);

    const email = value.email.trim();
    const r = await query(
      `SELECT u.id, u.role, u.account_status, pi.id AS invitation_id, pi.expires_at
         FROM users u
         LEFT JOIN account_invitations pi
           ON pi.user_id = u.id AND pi.consumed_at IS NULL AND pi.revoked_at IS NULL
        WHERE LOWER(u.email) = LOWER($1) AND u.is_active = TRUE
        LIMIT 1`,
      [email]
    );

    const row = r.rows[0];
    const eligible = !!row
      && row.account_status === 'pending'
      && !!row.invitation_id
      && new Date(row.expires_at) > new Date();

    if (eligible) {
      const code = generateCode();
      // Only the hash is stored. The code itself goes straight to the mailer
      // and is never written to a log, an error or a retry record.
      await query(
        `UPDATE account_invitations
            SET code_hash=$2, code_issued_at=NOW(), code_expires_at=$3, code_attempts=0, updated_at=NOW()
          WHERE id=$1`,
        [row.invitation_id, await hashCode(code), codeExpiry()]
      );
      // The role only chooses where the message tells them to enter the code.
      // It changes nothing about the response, which stays identical.
      sendActivationCode(email, code, CODE_TTL_MINUTES, { forParent: row.role === 'parent' });
    } else {
      await equalizeWork();
    }

    await answerGenerically(res, startedAt, GENERIC_ACTIVATION);
  } catch (err) { next(err); }
});

// POST /api/auth/activation/verify  — { email, code } → { activation_token }
router.post('/activation/verify', verifyCodePerIp, verifyCodePerEmail, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { error, value } = Joi.object({
      email: Joi.string().email().required(),
      code:  Joi.string().trim().required(),
    }).validate(req.body || {}, { stripUnknown: true });
    if (error) throw new AppError('Enter your email and the code from your message.', 422);

    const reject = async () => {
      await settle(startedAt);
      throw new AppError(GENERIC_CODE_REJECTED, 400);
    };

    const r = await query(
      `SELECT pi.id, pi.code_hash, pi.code_expires_at, pi.code_attempts, pi.expires_at
         FROM users u
         JOIN account_invitations pi
           ON pi.user_id = u.id AND pi.consumed_at IS NULL AND pi.revoked_at IS NULL
        WHERE LOWER(u.email) = LOWER($1) AND u.is_active = TRUE AND u.account_status='pending'
        LIMIT 1`,
      [value.email.trim()]
    );
    const inv = r.rows[0];

    const usable = inv
      && inv.code_hash
      && new Date(inv.code_expires_at) > new Date()
      && new Date(inv.expires_at) > new Date()
      && inv.code_attempts < MAX_CODE_ATTEMPTS;

    if (!usable) { await equalizeWork(); return await reject(); }

    if (!await compareCode(value.code, inv.code_hash)) {
      // Count the miss, and burn the code once the allowance is gone. The
      // invitation itself survives — they can ask for another code, which is
      // the designed way back and keeps a wrong guess from costing them the
      // whole invitation.
      //
      // The casts are load-bearing: without them Postgres deduces $2 as
      // smallint for the column and as integer for the comparison, refuses the
      // statement, and a wrong code answered 500 — a different status from the
      // 400 an unknown email gets, which is exactly the tell these endpoints
      // exist not to give.
      const attempts = inv.code_attempts + 1;
      await query(
        `UPDATE account_invitations
            SET code_attempts=$2::int,
                code_hash = CASE WHEN $2::int >= $3::int THEN NULL ELSE code_hash END,
                code_expires_at = CASE WHEN $2::int >= $3::int THEN NULL ELSE code_expires_at END,
                updated_at=NOW()
          WHERE id=$1`,
        [inv.id, attempts, MAX_CODE_ATTEMPTS]
      );
      return await reject();
    }

    // Single use: spend the code now, before the password is chosen. If they
    // abandon the flow here the code is gone and they request a fresh one.
    await query(
      `UPDATE account_invitations
          SET code_hash=NULL, code_expires_at=NULL, updated_at=NOW()
        WHERE id=$1`,
      [inv.id]
    );

    // A short-lived ticket, not a session. It needs no store of its own: the
    // completion below consumes the invitation, so a replayed token finds
    // nothing left to activate.
    const activation_token = jwt.sign(
      { inv: inv.id, purpose: 'activation' }, process.env.JWT_SECRET, { expiresIn: '15m' }
    );

    await settle(startedAt);
    res.json({ message: 'Email verified.', activation_token });
  } catch (err) { next(err); }
});

// POST /api/auth/activation/complete — { activation_token, password }
router.post('/activation/complete', async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      activation_token: Joi.string().required(),
      password: Joi.string().min(8).required()
        .messages({ 'string.min': 'Choose a password of at least 8 characters.' }),
    }).validate(req.body || {}, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);

    let decoded;
    try {
      decoded = jwt.verify(value.activation_token, process.env.JWT_SECRET);
    } catch {
      throw new AppError('This activation has expired. Request a new code and try again.', 400);
    }
    if (decoded.purpose !== 'activation') throw new AppError('Invalid activation token.', 400);

    const user = await withTransaction(async (client) => {
      const r = await client.query(
        `SELECT pi.id AS invitation_id, u.id AS user_id
           FROM account_invitations pi
           JOIN users u ON u.id = pi.user_id
          WHERE pi.id = $1
            AND pi.consumed_at IS NULL AND pi.revoked_at IS NULL AND pi.expires_at > NOW()
            AND u.account_status = 'pending' AND u.is_active = TRUE
          FOR UPDATE OF pi`,
        [decoded.inv]
      );
      if (!r.rows.length) {
        throw new AppError('This activation is no longer valid. Request a new code and try again.', 400);
      }

      const hash = await bcrypt.hash(value.password, await bcrypt.genSalt(12));
      // last_login_at too: activating signs them in, below.
      await client.query(
        "UPDATE users SET password_hash=$2, account_status='active', last_login_at=NOW(), updated_at=NOW() WHERE id=$1",
        [r.rows[0].user_id, hash]
      );
      await client.query(
        'UPDATE account_invitations SET consumed_at=NOW(), updated_at=NOW() WHERE id=$1',
        [r.rows[0].invitation_id]
      );

      const u = await client.query('SELECT * FROM users WHERE id=$1', [r.rows[0].user_id]);
      return u.rows[0];
    });

    // Signed in on the spot. They proved they hold the address and chose the
    // password in the same session, so there is nothing further to prove —
    // unlike the password reset below, which deliberately does not do this.
    res.json({
      message: 'Your account is active.',
      user: await buildUserPayload(req, user),
      ...generateTokens(user),
    });
  } catch (err) { next(err); }
});

/* ──────────────────────────────────────────────────────────────────────────
 * Password reset — the same three beats, the same four anti-enumeration rules.
 * ────────────────────────────────────────────────────────────────────────── */

// POST /api/auth/password-reset/request — { email }
router.post('/password-reset/request', requestCodePerIp, requestCodePerEmail, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { error, value } = emailOnlySchema.validate(req.body || {}, { stripUnknown: true });
    if (error) throw new AppError('Enter a valid email address.', 422);

    const r = await query(
      "SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND is_active=TRUE AND account_status='active' LIMIT 1",
      [value.email.trim()]
    );

    if (r.rows.length) {
      const code = generateCode();
      // One live code per account: replace the row rather than stacking, which
      // is what invalidates a previous unused code.
      await query('DELETE FROM password_reset_codes WHERE user_id=$1 AND consumed_at IS NULL', [r.rows[0].id]);
      await query(
        'INSERT INTO password_reset_codes (user_id, code_hash, code_expires_at) VALUES ($1,$2,$3)',
        [r.rows[0].id, await hashCode(code), codeExpiry()]
      );
      sendPasswordResetCode(value.email.trim(), code, CODE_TTL_MINUTES);
    } else {
      await equalizeWork();
    }

    await answerGenerically(res, startedAt, GENERIC_RESET);
  } catch (err) { next(err); }
});

// POST /api/auth/password-reset/verify — { email, code } → { reset_token }
router.post('/password-reset/verify', verifyCodePerIp, verifyCodePerEmail, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { error, value } = Joi.object({
      email: Joi.string().email().required(),
      code:  Joi.string().trim().required(),
    }).validate(req.body || {}, { stripUnknown: true });
    if (error) throw new AppError('Enter your email and the code from your message.', 422);

    const reject = async () => {
      await settle(startedAt);
      throw new AppError(GENERIC_CODE_REJECTED, 400);
    };

    const r = await query(
      `SELECT prc.id, prc.code_hash, prc.code_expires_at, prc.code_attempts
         FROM users u
         JOIN password_reset_codes prc ON prc.user_id = u.id AND prc.consumed_at IS NULL
        WHERE LOWER(u.email)=LOWER($1) AND u.is_active=TRUE AND u.account_status='active'
        LIMIT 1`,
      [value.email.trim()]
    );
    const rc = r.rows[0];

    const usable = rc && rc.code_hash
      && new Date(rc.code_expires_at) > new Date()
      && rc.code_attempts < MAX_CODE_ATTEMPTS;

    if (!usable) { await equalizeWork(); return await reject(); }

    if (!await compareCode(value.code, rc.code_hash)) {
      await query('UPDATE password_reset_codes SET code_attempts=code_attempts+1 WHERE id=$1', [rc.id]);
      return await reject();
    }

    const reset_token = jwt.sign(
      { rst: rc.id, purpose: 'password_reset' }, process.env.JWT_SECRET, { expiresIn: '15m' }
    );

    await settle(startedAt);
    res.json({ message: 'Code verified.', reset_token });
  } catch (err) { next(err); }
});

// POST /api/auth/password-reset/complete — { reset_token, password }
router.post('/password-reset/complete', async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      reset_token: Joi.string().required(),
      password: Joi.string().min(8).required()
        .messages({ 'string.min': 'Choose a password of at least 8 characters.' }),
    }).validate(req.body || {}, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);

    let decoded;
    try {
      decoded = jwt.verify(value.reset_token, process.env.JWT_SECRET);
    } catch {
      throw new AppError('This reset has expired. Request a new code and try again.', 400);
    }
    if (decoded.purpose !== 'password_reset') throw new AppError('Invalid reset token.', 400);

    await withTransaction(async (client) => {
      const r = await client.query(
        `SELECT id, user_id FROM password_reset_codes
          WHERE id=$1 AND consumed_at IS NULL AND code_expires_at > NOW() FOR UPDATE`,
        [decoded.rst]
      );
      if (!r.rows.length) {
        throw new AppError('This reset is no longer valid. Request a new code and try again.', 400);
      }
      const hash = await bcrypt.hash(value.password, await bcrypt.genSalt(12));
      await client.query('UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1', [r.rows[0].user_id, hash]);
      await client.query('UPDATE password_reset_codes SET consumed_at=NOW() WHERE id=$1', [r.rows[0].id]);
    });

    // Deliberately NOT signed in. Whoever completed this holds a mailbox and a
    // new password; making them sign in with it is the last step that proves
    // the reset landed where it was meant to, and it costs one screen.
    res.json({ message: 'Your password has been changed. Sign in with your new password.' });
  } catch (err) { next(err); }
});

module.exports = router;
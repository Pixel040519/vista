const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Joi      = require('joi');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { normaliseName } = require('../utils/nameHelper');
const { gradeScopeForRole } = require('../utils/roles');
const { photoUrlFromPath } = require('../middleware/upload.middleware');
const { advisorySections } = require('../utils/advisory');

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
  role:        Joi.string().valid('super_admin','admin_ece','admin_elem','teacher','parent').required(),
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

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
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
router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);

    const result = await query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [value.email]);
    if (!result.rows.length) throw new AppError('Invalid credentials.', 401);

    const user = result.rows[0];
    if (!await bcrypt.compare(value.password, user.password_hash)) throw new AppError('Invalid credentials.', 401);

    const userData = {
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
      userData.assignments = asgn.rows;
      userData.advisory    = await loadAdvisory(user.id);
    }

    const syRes = await query(
      'SELECT label, period_model, grading_policy FROM school_years WHERE is_active=TRUE LIMIT 1'
    );
    userData.active_school_year = syRes.rows[0]?.label || null;
    userData.period_model   = syRes.rows[0]?.period_model   || '4Q';
    userData.grading_policy = syRes.rows[0]?.grading_policy || 'DO8_2015';

    res.json({
      message: 'Login successful.',
      user: userData,
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
    const result  = await query('SELECT id,email,role FROM users WHERE id=$1 AND is_active=TRUE', [decoded.id]);
    if (!result.rows.length) throw new AppError('User not found.', 401);
    res.json(generateTokens(result.rows[0]));
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return next(new AppError('Invalid refresh token.', 403));
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

module.exports = router;
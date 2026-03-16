const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Joi      = require('joi');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { normaliseName } = require('../utils/nameHelper');

const registerSchema = Joi.object({
  email:       Joi.string().email().required(),
  password:    Joi.string().min(8).required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  role:        Joi.string().valid('admin','teacher','parent').required(),
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

    res.json({
      message: 'Login successful.',
      user: { id: user.id, email: user.email, full_name: user.full_name, surname: user.surname, first_name: user.first_name, middle_name: user.middle_name, role: user.role },
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
      'SELECT id, email, full_name, surname, first_name, middle_name, role, phone, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!result.rows.length) throw new AppError('User not found.', 404);
    res.json({ user: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
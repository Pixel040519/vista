const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');

// ─── Validation Schemas ────────────────────────────────────────
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  full_name: Joi.string().min(2).required(),
  role: Joi.string().valid('admin', 'teacher', 'parent').required(),
  phone: Joi.string().optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// ─── Helpers ───────────────────────────────────────────────────
const generateTokens = (user) => {
  const payload = { id: user.id, email: user.email, role: user.role };

  console.log("JWT_SECRET:", process.env.JWT_SECRET)
  
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h'
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '7d'
  });
  return { accessToken, refreshToken };
};

// ─── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);

    const { email, password, full_name, role, phone } = value;

    // Check if email exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new AppError('Email already registered.', 409);
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, created_at`,
      [email, password_hash, full_name, role, phone]
    );

    const user = result.rows[0];
    const tokens = generateTokens(user);

    res.status(201).json({
      message: 'User registered successfully.',
      user,
      ...tokens
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);

    const { email, password } = value;

    // Find user
    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid credentials.', 401);
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) throw new AppError('Invalid credentials.', 401);

    const tokens = generateTokens(user);

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      },
      ...tokens
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/refresh ────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token required.', 401);

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const result = await query(
      'SELECT id, email, role FROM users WHERE id = $1 AND is_active = TRUE',
      [decoded.id]
    );

    if (result.rows.length === 0) throw new AppError('User not found.', 401);

    const tokens = generateTokens(result.rows[0]);
    res.json(tokens);
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid refresh token.', 403));
    }
    next(err);
  }
});

// ─── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, phone, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) throw new AppError('User not found.', 404);
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
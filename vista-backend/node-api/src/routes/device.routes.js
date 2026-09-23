const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');

router.use(authenticate);

const registerSchema = Joi.object({
  token: Joi.string().min(1).max(4096).required(),
  platform: Joi.string().valid('ios', 'android').required(),
});

// POST /api/devices/register — vista_parent calls this after
// login + permission grant. Upsert so re-registering the same token just
// bumps last_seen_at. A token that was previously owned by another user
// (shared device, account switch) is re-homed to the current caller.
router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);

    const r = await query(
      `INSERT INTO device_tokens (user_id, token, platform, last_seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     platform = EXCLUDED.platform,
                     last_seen_at = NOW()
       RETURNING id`,
      [req.user.id, value.token, value.platform]
    );

    res.status(201).json({ message: 'Device registered.', id: r.rows[0].id });
  } catch (err) { next(err); }
});

// DELETE /api/devices/:token — logout cleanup. Only deletes if the row belongs
// to the caller (prevents one user from killing another's push channel).
router.delete('/:token', async (req, res, next) => {
  try {
    await query(
      `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2`,
      [req.params.token, req.user.id]
    );
    res.json({ message: 'Device unregistered.' });
  } catch (err) { next(err); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, authorizeAnyAdmin } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*, u.full_name as posted_by_name
       FROM announcements a JOIN users u ON u.id = a.posted_by
       WHERE a.is_active = TRUE ORDER BY a.created_at DESC`
    );
    res.json({ announcements: result.rows });
  } catch (err) { next(err); }
});

router.post('/', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { title, content, target_audience } = req.body;
    const result = await query(
      `INSERT INTO announcements (title, content, posted_by, target_audience)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, content, req.user.id, target_audience || 'all']
    );
    res.status(201).json({ announcement: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
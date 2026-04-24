const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, authorizeAnyAdmin } = require('../middleware/auth.middleware');
const { isAnyAdmin, ROLES } = require('../utils/roles');

router.use(authenticate);

// Map the caller's role to the target_audience values they are allowed to see.
function audiencesForRole(role) {
  if (isAnyAdmin(role))       return ['all', 'admins'];
  if (role === ROLES.TEACHER) return ['all', 'teachers'];
  if (role === ROLES.PARENT)  return ['all', 'parents'];
  return ['all'];
}

router.get('/', async (req, res, next) => {
  try {
    const audiences = audiencesForRole(req.user.role);
    const result = await query(
      `SELECT a.*, u.full_name as posted_by_name
       FROM announcements a JOIN users u ON u.id = a.posted_by
       WHERE a.is_active = TRUE AND a.target_audience = ANY($1::text[])
       ORDER BY a.created_at DESC`,
      [audiences]
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

router.put('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, content, target_audience } = req.body;
    const existing = await query(
      `SELECT posted_by FROM announcements WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Announcement not found.' });
    if (existing.rows[0].posted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit announcements you posted.' });
    }
    const result = await query(
      `UPDATE announcements SET title = $1, content = $2, target_audience = $3
       WHERE id = $4 RETURNING *`,
      [title, content, target_audience || 'all', id]
    );
    res.json({ announcement: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await query(
      `SELECT posted_by FROM announcements WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Announcement not found.' });
    if (existing.rows[0].posted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete announcements you posted.' });
    }
    await query(`UPDATE announcements SET is_active = FALSE WHERE id = $1`, [id]);
    res.json({ message: 'Announcement deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

// GET /api/notifications — Get user's notifications
//   A row whose sent_at is still ahead is not delivered yet: a scheduled
//   announcement writes its staff notifications at save time, stamped with the
//   go-live moment (see syncStaffNotifications in announcement.routes.js).
//   sent_at has no time zone, hence LOCALTIMESTAMP rather than NOW().
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND sent_at <= LOCALTIMESTAMP
        ORDER BY sent_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) { next(err); }
});

// PATCH /api/notifications/:id/read — Mark as read
router.patch('/:id/read', async (req, res, next) => {
  try {
    await query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND recipient_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Notification marked as read.' });
  } catch (err) { next(err); }
});

module.exports = router;
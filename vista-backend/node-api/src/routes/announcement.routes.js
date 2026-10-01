const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { query, withTransaction } = require('../config/database');
const { authenticate, authorizeAnyAdmin } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const {
  uploadAnnouncementImage,
  photoUrlFromPath,
  unlinkUploadedFile,
} = require('../middleware/upload.middleware');
const { processImage, discard } = require('../utils/imageProcess');
const { isAnyAdmin, isSuperAdmin, ROLES } = require('../utils/roles');
const pushService = require('../services/push.service');

router.use(authenticate);

const AUDIENCES  = ['all', 'admins', 'teachers', 'parents'];
const CATEGORIES = ['General', 'Enrollment', 'Event', 'Academic', 'Holiday', 'Suspension'];
// Only these audiences include parents — and so only these may be public or
// notify anyone. The table's announcements_public_audience_check says the same.
const PARENT_AUDIENCES = ['all', 'parents'];

// Map the caller's role to the target_audience values they are allowed to see.
function audiencesForRole(role) {
  if (isAnyAdmin(role))       return AUDIENCES;
  if (role === ROLES.TEACHER) return ['all', 'teachers'];
  if (role === ROLES.PARENT)  return ['all', 'parents'];
  return ['all'];
}

// Derived, never stored: a stored state would disagree with the clock the
// moment a scheduled post came due or a live one expired.
const STATE_SQL = `CASE
    WHEN a.published_at IS NULL THEN 'draft'
    WHEN a.published_at > NOW() THEN 'scheduled'
    WHEN a.expires_at IS NOT NULL AND a.expires_at <= NOW() THEN 'expired'
    ELSE 'published' END`;

const LIVE_SQL = `(a.published_at IS NOT NULL AND a.published_at <= NOW()
    AND (a.expires_at IS NULL OR a.expires_at > NOW()))`;

const SELECT_SQL = `
  SELECT a.id, a.title, a.content, a.category, a.target_audience,
         a.is_public, a.is_pinned, a.published_at, a.expires_at, a.notified_at,
         a.image_path, a.posted_by, a.created_at, a.updated_at,
         u.full_name AS posted_by_name, ${STATE_SQL} AS state
    FROM announcements a
    LEFT JOIN users u ON u.id = a.posted_by`;

function present(req, row) {
  const { image_path, ...rest } = row;
  return { ...rest, image_url: photoUrlFromPath(req, image_path) };
}

// Multipart bodies arrive as strings; Joi's default convert turns "true" and
// ISO strings into booleans and dates. An empty string from a cleared field
// means "not set", which Joi would otherwise reject as an invalid date.
const OPTIONAL_FIELDS = ['publish_at', 'expires_at'];
function blanksToNull(body) {
  const out = { ...body };
  for (const k of OPTIONAL_FIELDS) if (out[k] === '') out[k] = null;
  return out;
}

const schema = Joi.object({
  title:           Joi.string().trim().min(1).max(255).required(),
  content:         Joi.string().trim().min(1).max(20000).required(),
  category:        Joi.string().valid(...CATEGORIES).default('General'),
  target_audience: Joi.string().valid(...AUDIENCES).default('all'),
  is_public:       Joi.boolean().default(false),
  is_pinned:       Joi.boolean().default(false),
  // draft: not visible anywhere. publish: live now. schedule: live at publish_at.
  status:          Joi.string().valid('draft', 'publish', 'schedule').default('publish'),
  publish_at:      Joi.date().iso().allow(null),
  expires_at:      Joi.date().iso().allow(null),
  notify_parents:  Joi.boolean().default(false),
  image_consent:   Joi.boolean().default(false),
  remove_image:    Joi.boolean().default(false),
});

function validate(req) {
  const { error, value } = schema.validate(blanksToNull(req.body), { stripUnknown: true });
  if (error) throw new AppError(error.details[0].message, 422);

  if (value.is_public && !isSuperAdmin(req.user.role)) {
    throw new AppError('Only the super admin can publish to the public website.', 403);
  }
  if (value.is_public && !PARENT_AUDIENCES.includes(value.target_audience)) {
    throw new AppError('A post for staff only cannot be shown on the public website. Choose "Everyone" or "Parents".', 422);
  }
  if (value.status === 'schedule') {
    if (!value.publish_at) throw new AppError('Choose when the announcement should go live.', 422);
    if (value.publish_at <= new Date()) throw new AppError('The scheduled time must be in the future. Use "Publish now" instead.', 422);
  }
  if (value.expires_at && value.expires_at <= (value.status === 'schedule' ? value.publish_at : new Date())) {
    throw new AppError('The expiry must be after the announcement goes live.', 422);
  }
  if (req.file && !value.image_consent) {
    throw new AppError('Confirm the photo shows no identifiable learners, or that parental consent is on file.', 422);
  }
  return value;
}

// The super admin can correct or withdraw any post — including one left behind
// by an admin who has since gone. Scoped admins keep the old rule, their own
// posts only, and never a public one: the public website is the super admin's.
function assertCanEdit(user, row) {
  if (isSuperAdmin(user.role)) return;
  if (row.posted_by !== user.id) {
    throw new AppError('You can only change announcements you posted.', 403);
  }
  if (row.is_public) {
    throw new AppError('This announcement is on the public website, so only the super admin can change it.', 403);
  }
}

// published_at for a save. Re-saving a live post must not bump it to "now",
// or every typo fix would float it back to the top as though it were new.
function resolvePublishedAt(value, existing) {
  if (value.status === 'draft') return null;
  if (value.status === 'schedule') return value.publish_at;
  const current = existing?.published_at;
  return current && new Date(current) <= new Date() ? current : new Date();
}

// The notification and push body: the start of the post, cut at a word rather
// than mid-word. The full text is one tap away in the app.
const PREVIEW_LENGTH = 180;
function previewOf(content) {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= PREVIEW_LENGTH) return text;
  const cut = text.slice(0, PREVIEW_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${(space > PREVIEW_LENGTH / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

async function loadRow(id, db = { query }) {
  const r = await db.query(`${SELECT_SQL} WHERE a.id = $1 AND a.is_active = TRUE`, [id]);
  if (!r.rowCount) throw new AppError('Announcement not found.', 404);
  return r.rows[0];
}

/**
 * Write one notification row per active parent account, and stamp the post so
 * it can never do so twice. Only for a post that reaches parents and is live
 * now: a scheduled post has no moment at which this could run, and notifying
 * before it is visible would send parents to something they cannot open.
 * Returns the recipients for the push that follows the commit.
 */
async function notifyParents(client, row) {
  if (row.notified_at) return [];
  if (!PARENT_AUDIENCES.includes(row.target_audience) || row.state !== 'published') return [];

  const body = previewOf(row.content);
  const r = await client.query(
    `INSERT INTO notifications (recipient_id, title, body, type, reference_id)
     SELECT u.id, $1, $2, 'announcement', $3
       FROM users u
      WHERE u.role = 'parent' AND u.account_status = 'active' AND u.is_active = TRUE
     RETURNING recipient_id`,
    [row.title, body, row.id]
  );
  await client.query(`UPDATE announcements SET notified_at = NOW() WHERE id = $1`, [row.id]);
  return r.rows.map(x => x.recipient_id);
}

function pushAfterCommit(recipients, row) {
  if (!recipients.length) return;
  pushService.sendAnnouncement(recipients, {
    id: row.id,
    title: row.title,
    body: previewOf(row.content),
  });
}

// GET /api/announcements
//   Admins manage from this list, so they see every live post plus drafts and
//   scheduled ones — their own, or everyone's for the super admin. Teachers and
//   parents see only what is live for their audience.
router.get('/', async (req, res, next) => {
  try {
    const params = [audiencesForRole(req.user.role)];
    let visibility;
    if (isSuperAdmin(req.user.role)) {
      visibility = 'TRUE';
    } else if (isAnyAdmin(req.user.role)) {
      params.push(req.user.id);
      visibility = `(${LIVE_SQL} OR a.posted_by = $2)`;
    } else {
      visibility = LIVE_SQL;
    }

    const result = await query(
      `${SELECT_SQL}
        WHERE a.is_active = TRUE AND a.target_audience = ANY($1::text[]) AND ${visibility}
        ORDER BY (${LIVE_SQL} AND a.is_pinned) DESC,
                 COALESCE(a.published_at, a.created_at) DESC`,
      params
    );
    res.json({ announcements: result.rows.map(r => present(req, r)) });
  } catch (err) { next(err); }
});

router.post('/', authorizeAnyAdmin, uploadAnnouncementImage, async (req, res, next) => {
  let image = null;
  try {
    const value = validate(req);
    if (req.file) image = await processImage(req.file, 'announcements', { maxWidth: 1600 });

    const { row, recipients } = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO announcements
           (title, content, category, target_audience, is_public, is_pinned,
            published_at, expires_at, image_path, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [value.title, value.content, value.category, value.target_audience,
         value.is_public, value.is_pinned, resolvePublishedAt(value, null), value.expires_at,
         image?.image_path || null, req.user.id]
      );
      let row = await loadRow(ins.rows[0].id, client);
      const recipients = value.notify_parents ? await notifyParents(client, row) : [];
      if (recipients.length) row = await loadRow(row.id, client);
      return { row, recipients };
    });

    pushAfterCommit(recipients, row);
    res.status(201).json({
      announcement: present(req, row),
      notified: recipients.length,
      message: messageFor(row, recipients.length, 'posted'),
    });
  } catch (err) {
    discard(req.file);
    if (image) unlinkUploadedFile(image.image_path);
    next(err);
  }
});

router.put('/:id', authorizeAnyAdmin, uploadAnnouncementImage, async (req, res, next) => {
  let image = null;
  try {
    const existing = await loadRow(req.params.id);
    assertCanEdit(req.user, existing);
    const value = validate(req);
    if (req.file) image = await processImage(req.file, 'announcements', { maxWidth: 1600 });

    const imagePath = image ? image.image_path
      : value.remove_image ? null
      : existing.image_path;

    const { row, recipients } = await withTransaction(async (client) => {
      await client.query(
        `UPDATE announcements
            SET title=$1, content=$2, category=$3, target_audience=$4,
                is_public=$5, is_pinned=$6, published_at=$7, expires_at=$8,
                image_path=$9, updated_at=NOW(), updated_by=$10
          WHERE id=$11`,
        [value.title, value.content, value.category, value.target_audience,
         value.is_public, value.is_pinned, resolvePublishedAt(value, existing), value.expires_at,
         imagePath, req.user.id, existing.id]
      );
      let row = await loadRow(existing.id, client);
      const recipients = value.notify_parents ? await notifyParents(client, row) : [];
      if (recipients.length) row = await loadRow(row.id, client);
      return { row, recipients };
    });

    if (existing.image_path && existing.image_path !== imagePath) {
      unlinkUploadedFile(existing.image_path);
    }
    pushAfterCommit(recipients, row);
    res.json({
      announcement: present(req, row),
      notified: recipients.length,
      message: messageFor(row, recipients.length, 'updated'),
    });
  } catch (err) {
    discard(req.file);
    if (image) unlinkUploadedFile(image.image_path);
    next(err);
  }
});

router.delete('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const existing = await loadRow(req.params.id);
    assertCanEdit(req.user, existing);
    // Soft delete: notification rows reference the post, and a parent tapping
    // an old one should find nothing rather than an error.
    await query(`UPDATE announcements SET is_active = FALSE, updated_at = NOW(), updated_by = $2 WHERE id = $1`,
      [existing.id, req.user.id]);
    res.json({ message: 'Announcement deleted.' });
  } catch (err) { next(err); }
});

function messageFor(row, notified, verb) {
  const base = row.state === 'draft' ? 'Draft saved.'
    : row.state === 'scheduled' ? 'Announcement scheduled.'
    : `Announcement ${verb}.`;
  return notified ? `${base} ${notified} parent${notified === 1 ? '' : 's'} notified.` : base;
}

module.exports = router;

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
         a.in_vista, a.is_public, a.is_pinned, a.published_at, a.expires_at, a.notified_at,
         a.image_path, a.posted_by, a.created_at, a.updated_at, a.updated_by,
         u.full_name AS posted_by_name, ed.full_name AS updated_by_name, ${STATE_SQL} AS state,
         le.edited_by_name AS last_edit_by_name, le.edited_at AS last_edit_at,
         le.editors AS edit_editors
    FROM announcements a
    LEFT JOIN users u ON u.id = a.posted_by
    -- Who saved it last; covers edits made before announcement_edits existed.
    LEFT JOIN users ed ON ed.id = a.updated_by
    -- The latest edit by someone other than the author (announcement_edits only
    -- holds those), so "Edited by …" outlives the author re-saving afterwards,
    -- plus who has made one — present() turns that into can_view_edits and
    -- drops it. What changed is behind "View changes" for author and editor only.
    LEFT JOIN LATERAL (
      SELECT ue.full_name AS edited_by_name, e.edited_at,
             (SELECT array_agg(DISTINCT x.edited_by) FROM announcement_edits x
               WHERE x.announcement_id = a.id) AS editors
        FROM announcement_edits e
        LEFT JOIN users ue ON ue.id = e.edited_by
       WHERE e.announcement_id = a.id
       ORDER BY e.edited_at DESC
       LIMIT 1
    ) le ON TRUE`;

function present(req, row) {
  const { image_path, edit_editors, ...rest } = row;
  const editors = edit_editors || [];
  const can_view_edits = editors.length > 0
    && (rest.posted_by === req.user.id || editors.includes(req.user.id));
  return { ...rest, can_view_edits, image_url: photoUrlFromPath(req, image_path) };
}

// The post as an edit compares it. Dates go through JSON as ISO strings, so a
// before/after pair compares by value.
const EDIT_FIELDS = ['title', 'content', 'category', 'target_audience', 'in_vista', 'is_public',
  'is_pinned', 'state', 'published_at', 'expires_at', 'image_path'];
function snapshotOf(row) {
  return JSON.parse(JSON.stringify(Object.fromEntries(EDIT_FIELDS.map(k => [k, row[k] ?? null]))));
}

// Record a save by someone other than the author, if it changed anything.
// Returns the snapshot fields that changed ([] when nothing did, or when the
// author edited their own post), so the caller can tell the author what moved.
async function recordEdit(client, user, before, after) {
  if (before.posted_by === user.id) return [];
  const b = snapshotOf(before);
  const a = snapshotOf(after);
  const changed = EDIT_FIELDS.filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!changed.length) return [];
  await client.query(
    `INSERT INTO announcement_edits (announcement_id, edited_by, before, after) VALUES ($1, $2, $3, $4)`,
    [before.id, user.id, b, a]
  );
  return changed;
}

// What an edit touched, in the words the form uses. Several snapshot fields
// are one thing to a reader (status and its go-live time; audience and VISTA).
const CHANGE_LABELS = {
  title: 'the title', content: 'the message', category: 'the category',
  target_audience: 'the audience', in_vista: 'the audience', is_public: 'the website',
  is_pinned: 'the pin', state: 'the status', published_at: 'the status',
  expires_at: 'the take-down date', image_path: 'the photo',
};
function changeSummary(fields) {
  const labels = [...new Set(fields.map(f => CHANGE_LABELS[f]).filter(Boolean))];
  return labels.length ? `Changed: ${labels.join(', ')}.` : '';
}

// The author of a post is told when someone else edits or deletes it — their
// name stays on the post, so they must not find out from a reader. Written in
// the caller's transaction; the dashboard bell reads these rows. The types are
// distinct from 'announcement', which is what parents receive for a new post.
async function notifyAuthor(client, user, post, type, body) {
  if (!post.posted_by || post.posted_by === user.id) return;
  const me = await client.query(`SELECT full_name FROM users WHERE id = $1`, [user.id]);
  const who = me.rows[0]?.full_name || 'An administrator';
  const title = type === 'announcement_deleted'
    ? `${who} deleted your announcement`
    : `${who} edited your announcement`;
  await client.query(
    `INSERT INTO notifications (recipient_id, title, body, type, reference_id) VALUES ($1, $2, $3, $4, $5)`,
    [post.posted_by, title, body, type, post.id]
  );
}

// Staff a post reaches, by audience. Parents are deliberately absent: they are
// notified only by the opt-in "Notify parents" switch (notifyParents), which
// also pushes to their phones.
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM];
const STAFF_FOR_AUDIENCE = {
  all:      [ROLES.TEACHER, ...ADMIN_ROLES],
  teachers: [ROLES.TEACHER],
  admins:   ADMIN_ROLES,
  parents:  [],
};

/**
 * Tell the staff in a post's audience that it is out — once per post.
 *
 * Runs after every save in that save's transaction. A scheduled post has no
 * moment at which code could run, so its rows are written now with sent_at set
 * to the go-live time, and GET /api/notifications hides rows whose time has not
 * come. Rows still pending are therefore always rewritten from scratch: a
 * rescheduled post moves them, and one moved back to draft, taken out of VISTA
 * or narrowed to parents loses them. Once any have been delivered the post has
 * been announced, and later edits do not announce it again.
 *
 * sent_at is a TIMESTAMP without zone, so both sides of every comparison stay
 * in SQL (LOCALTIMESTAMP, ::timestamp) — a JS Date would be stored as UTC
 * wall-clock and compare hours off against the session's local time.
 */
async function syncStaffNotifications(client, row, actorId) {
  await client.query(
    `DELETE FROM notifications
      WHERE type = 'announcement_posted' AND reference_id = $1 AND sent_at > LOCALTIMESTAMP`,
    [row.id]
  );
  const sent = await client.query(
    `SELECT 1 FROM notifications WHERE type = 'announcement_posted' AND reference_id = $1 LIMIT 1`,
    [row.id]
  );
  if (sent.rowCount) return;

  const roles = STAFF_FOR_AUDIENCE[row.target_audience] || [];
  if (!row.in_vista || !roles.length || !['published', 'scheduled'].includes(row.state)) return;

  await client.query(
    `INSERT INTO notifications (recipient_id, title, body, type, reference_id, sent_at)
     SELECT u.id, $2, $3, 'announcement_posted', a.id,
            (CASE WHEN a.published_at > NOW() THEN a.published_at ELSE NOW() END)::timestamp
       FROM announcements a
       JOIN users u ON u.role = ANY($4::text[]) AND u.is_active = TRUE
      WHERE a.id = $1
        AND u.id <> $5
        AND u.id IS DISTINCT FROM a.posted_by`,
    [row.id, `New announcement: ${row.title}`.slice(0, 255), previewOf(row.content), roles, actorId]
  );
}

// "VISTA and the public website" — where a deleted post was removed from.
function placesOf(row) {
  const places = [];
  if (row.in_vista) places.push(PARENT_AUDIENCES.includes(row.target_audience) ? 'VISTA and the parent app' : 'VISTA');
  if (row.is_public) places.push('the public website');
  return places.join(' and ') || 'VISTA';
}

// An edit as the client sees it: the photo is reduced to whether there was
// one and whether it was swapped, since an old file is deleted when replaced.
function presentEdit(e) {
  const strip = ({ image_path, ...s }) => ({ ...s, has_photo: !!image_path });
  return {
    id: e.id, edited_by: e.edited_by, edited_by_name: e.edited_by_name, edited_at: e.edited_at,
    before: strip(e.before), after: strip(e.after),
    photo_replaced: !!e.before.image_path && !!e.after.image_path && e.before.image_path !== e.after.image_path,
  };
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
  // The two places a post can appear. Independent, but at least one is required
  // (announcements_reach_check). in_vista defaults on so an older client keeps
  // posting exactly what it posted before.
  in_vista:        Joi.boolean().default(true),
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

  if (!value.in_vista && !value.is_public) {
    throw new AppError('Choose where this announcement should appear: in VISTA, on the public website, or both.', 422);
  }
  // This also covers a website-only post, which is necessarily public.
  if (value.is_public && !isSuperAdmin(req.user.role)) {
    throw new AppError('Only the super admin can publish to the public website.', 403);
  }
  if (value.in_vista) {
    if (value.is_public && !PARENT_AUDIENCES.includes(value.target_audience)) {
      throw new AppError('A post for staff only cannot be shown on the public website. Choose "Everyone" or "Parents".', 422);
    }
  } else {
    // Not in VISTA: the audience is ignored and nobody inside VISTA is told.
    // Keep a parent-reaching audience so the public CHECK holds and switching
    // VISTA back on later restores what it was.
    if (!PARENT_AUDIENCES.includes(value.target_audience)) value.target_audience = 'all';
    value.notify_parents = false;
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

// The website speaks for the school in the super admin's own words, so a post
// goes public only by its author. The super admin may still correct an ECE or
// Elementary admin's post inside VISTA, but putting it on the internet would
// publish someone else's writing to the public under the school's name — the
// author never chose that audience. Only the false -> true move is refused: a
// post already public stays editable, and taking one off the website is fine.
function assertCanPublish(user, existing, value) {
  if (!value.is_public || existing.is_public) return;
  if (existing.posted_by !== user.id) {
    throw new AppError(
      'Only the author of this announcement can post it to the public website. Post your own announcement to the website instead.',
      403
    );
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
  // A website-only post is not in the parent app, so a notification would open nothing.
  if (!row.in_vista) return [];
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
//
//   Website-only posts (in_vista = FALSE): the super admin gets all of them —
//   the website is theirs. Scoped admins get the *live* ones, read-only, for
//   their Public Website tab: anyone on the internet can already read those, and
//   an admin who cannot see what the website says gets asked about it blind and
//   re-posts it in VISTA. The super admin's drafts and scheduled website posts
//   stay theirs. For teachers and parents, the parent app included, a post that
//   is not in VISTA does not exist.
router.get('/', async (req, res, next) => {
  try {
    const params = [audiencesForRole(req.user.role)];
    let visibility;
    if (isSuperAdmin(req.user.role)) {
      visibility = 'TRUE';
    } else if (isAnyAdmin(req.user.role)) {
      params.push(req.user.id);
      visibility = `((a.in_vista = TRUE AND (${LIVE_SQL} OR a.posted_by = $2))
                     OR (a.is_public = TRUE AND ${LIVE_SQL}))`;
    } else {
      visibility = `a.in_vista = TRUE AND ${LIVE_SQL}`;
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
           (title, content, category, target_audience, in_vista, is_public, is_pinned,
            published_at, expires_at, image_path, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [value.title, value.content, value.category, value.target_audience,
         value.in_vista, value.is_public, value.is_pinned, resolvePublishedAt(value, null),
         value.expires_at, image?.image_path || null, req.user.id]
      );
      let row = await loadRow(ins.rows[0].id, client);
      await syncStaffNotifications(client, row, req.user.id);
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
    assertCanPublish(req.user, existing, value);
    if (req.file) image = await processImage(req.file, 'announcements', { maxWidth: 1600 });

    const imagePath = image ? image.image_path
      : value.remove_image ? null
      : existing.image_path;

    const { row, recipients } = await withTransaction(async (client) => {
      await client.query(
        `UPDATE announcements
            SET title=$1, content=$2, category=$3, target_audience=$4, in_vista=$5,
                is_public=$6, is_pinned=$7, published_at=$8, expires_at=$9,
                image_path=$10, updated_at=NOW(), updated_by=$11
          WHERE id=$12`,
        [value.title, value.content, value.category, value.target_audience, value.in_vista,
         value.is_public, value.is_pinned, resolvePublishedAt(value, existing), value.expires_at,
         imagePath, req.user.id, existing.id]
      );
      let row = await loadRow(existing.id, client);
      await syncStaffNotifications(client, row, req.user.id);
      const changed = await recordEdit(client, req.user, existing, row);
      if (changed.length) {
        await notifyAuthor(client, req.user, existing, 'announcement_edited',
          `"${row.title}" — ${changeSummary(changed)}`);
      }
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

// GET /api/announcements/:id/edits
//   What other admins changed in this post, newest first. The post's author
//   sees every edit to it; an editor sees only the edits they made. Anyone
//   else gets an empty list rather than a 403, so the endpoint cannot be used
//   to learn whether a post was edited at all.
router.get('/:id/edits', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const post = await loadRow(req.params.id);
    const r = await query(
      `SELECT e.id, e.edited_by, u.full_name AS edited_by_name, e.edited_at, e.before, e.after
         FROM announcement_edits e
         LEFT JOIN users u ON u.id = e.edited_by
        WHERE e.announcement_id = $1 AND ($2::uuid = $3::uuid OR e.edited_by = $2)
        ORDER BY e.edited_at DESC`,
      [post.id, req.user.id, post.posted_by]
    );
    res.json({ edits: r.rows.map(presentEdit) });
  } catch (err) { next(err); }
});

router.delete('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const existing = await loadRow(req.params.id);
    assertCanEdit(req.user, existing);
    // Soft delete: notification rows reference the post, and a parent tapping
    // an old one should find nothing rather than an error.
    await withTransaction(async (client) => {
      await client.query(`UPDATE announcements SET is_active = FALSE, updated_at = NOW(), updated_by = $2 WHERE id = $1`,
        [existing.id, req.user.id]);
      // A scheduled post deleted before going live must not announce itself later.
      await client.query(
        `DELETE FROM notifications
          WHERE type = 'announcement_posted' AND reference_id = $1 AND sent_at > LOCALTIMESTAMP`,
        [existing.id]
      );
      await notifyAuthor(client, req.user, existing, 'announcement_deleted',
        `"${existing.title}" was removed from ${placesOf(existing)}.`);
    });
    res.json({ message: 'Announcement deleted.' });
  } catch (err) { next(err); }
});

// Names where the post went, since the form can send it to VISTA, the website or
// both. A draft is nowhere yet, so it says only that it was saved.
function messageFor(row, notified, verb) {
  const where = row.in_vista && row.is_public ? 'VISTA and the website'
    : row.is_public ? 'the website'
    : 'VISTA';
  const base = row.state === 'draft' ? 'Draft saved.'
    : row.state === 'scheduled' ? `Announcement scheduled for ${where}.`
    : `Announcement ${verb === 'posted' ? 'posted to' : 'updated on'} ${where}.`;
  return notified ? `${base} ${notified} parent${notified === 1 ? '' : 's'} notified.` : base;
}

module.exports = router;

// Authorized pickup persons (non-account fetchers) — CRUD scoped to the
// authenticated parent. The Pickup QR tab in vista_parent uses these rows to
// populate the "Who's fetching today?" selector and binds a chosen fetcher
// onto the SecurePass QR via /api/students/:id/generate-qr.

const express = require('express');
const router  = express.Router();
const Joi     = require('joi');
const path    = require('path');
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/roles');
const { AppError } = require('../middleware/error.middleware');
const { normaliseName } = require('../utils/nameHelper');
const {
  uploadAuthorizedPickupPhoto,
  photoUrlFromPath,
  unlinkUploadedFile,
} = require('../middleware/upload.middleware');

router.use(authenticate);
router.use(authorize(ROLES.PARENT));

const RELATIONSHIPS = ['Yaya', 'Lola', 'Lolo', 'Tito', 'Tita', 'Driver', 'Sibling', 'Relative', 'Other'];

const baseSchema = Joi.object({
  student_id:   Joi.string().uuid().required(),
  surname:      Joi.string().min(1).max(80).required(),
  first_name:   Joi.string().min(1).max(80).required(),
  middle_name:  Joi.string().max(80).allow('', null).optional(),
  relationship: Joi.string().valid(...RELATIONSHIPS).required(),
});

const updateSchema = baseSchema.fork(['student_id'], (s) => s.optional());

// Confirm the parent is authorized for pickup on this student.
async function assertParentLinkedToStudent(parentId, studentId) {
  const link = await query(
    `SELECT 1 FROM parent_student
      WHERE parent_id=$1 AND student_id=$2 AND is_authorized_pickup=TRUE
      LIMIT 1`,
    [parentId, studentId]
  );
  if (!link.rowCount) {
    throw new AppError('You are not an authorized guardian for this student.', 403);
  }
}

// Project a DB row into the JSON shape the mobile app expects.
function rowToDto(row, req) {
  if (!row) return null;
  const photoRel = row.photo_path ? `authorized-pickup/${path.basename(row.photo_path)}` : null;
  const middle = row.middle_name ? ` ${row.middle_name}` : '';
  return {
    id: row.id,
    student_id: row.student_id,
    surname: row.surname,
    first_name: row.first_name,
    middle_name: row.middle_name,
    relationship: row.relationship,
    full_name: `${row.first_name}${middle} ${row.surname}`.trim(),
    photo_url: photoUrlFromPath(req, photoRel),
  };
}

// GET /api/pickup-persons?student_id=<uuid>
router.get('/', async (req, res, next) => {
  try {
    const studentId = (req.query.student_id || '').toString().trim();
    if (!studentId) throw new AppError('student_id is required.', 400);
    await assertParentLinkedToStudent(req.user.id, studentId);

    const result = await query(
      `SELECT id, student_id, surname, first_name, middle_name, relationship, photo_path
         FROM authorized_pickup_persons
        WHERE parent_id=$1 AND student_id=$2
        ORDER BY surname, first_name`,
      [req.user.id, studentId]
    );

    res.json(result.rows.map((r) => rowToDto(r, req)));
  } catch (err) { next(err); }
});

// POST /api/pickup-persons (multipart, field "photo" required)
router.post('/', uploadAuthorizedPickupPhoto, async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('A photo is required.', 400);

    const { error, value } = baseSchema.validate(req.body);
    if (error) {
      unlinkUploadedFile(`authorized-pickup/${req.file.filename}`);
      throw new AppError(error.details[0].message, 422);
    }

    await assertParentLinkedToStudent(req.user.id, value.student_id);

    const { surname, first_name, middle_name } = normaliseName(value);
    const photoPath = `authorized-pickup/${req.file.filename}`;

    const result = await query(
      `INSERT INTO authorized_pickup_persons
         (parent_id, student_id, surname, first_name, middle_name, relationship, photo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, student_id, surname, first_name, middle_name, relationship, photo_path`,
      [req.user.id, value.student_id, surname, first_name, middle_name || null,
       value.relationship, photoPath]
    );

    res.status(201).json(rowToDto(result.rows[0], req));
  } catch (err) { next(err); }
});

// PUT /api/pickup-persons/:id (multipart, "photo" optional)
router.put('/:id', uploadAuthorizedPickupPhoto, async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) {
      if (req.file) unlinkUploadedFile(`authorized-pickup/${req.file.filename}`);
      throw new AppError(error.details[0].message, 422);
    }

    const existing = await query(
      `SELECT id, parent_id, student_id, photo_path
         FROM authorized_pickup_persons
        WHERE id=$1`,
      [req.params.id]
    );
    if (!existing.rowCount) {
      if (req.file) unlinkUploadedFile(`authorized-pickup/${req.file.filename}`);
      throw new AppError('Authorized person not found.', 404);
    }
    if (existing.rows[0].parent_id !== req.user.id) {
      if (req.file) unlinkUploadedFile(`authorized-pickup/${req.file.filename}`);
      throw new AppError('Not your authorized person.', 403);
    }

    const { surname, first_name, middle_name } = normaliseName(value);
    const newPhoto = req.file ? `authorized-pickup/${req.file.filename}` : null;

    const result = await query(
      `UPDATE authorized_pickup_persons
          SET surname=$1, first_name=$2, middle_name=$3, relationship=$4,
              photo_path=COALESCE($5, photo_path), updated_at=NOW()
        WHERE id=$6
       RETURNING id, student_id, surname, first_name, middle_name, relationship, photo_path`,
      [surname, first_name, middle_name || null, value.relationship,
       newPhoto, req.params.id]
    );

    if (newPhoto && existing.rows[0].photo_path) {
      unlinkUploadedFile(existing.rows[0].photo_path);
    }

    res.json(rowToDto(result.rows[0], req));
  } catch (err) { next(err); }
});

// DELETE /api/pickup-persons/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT parent_id, photo_path FROM authorized_pickup_persons WHERE id=$1`,
      [req.params.id]
    );
    if (!existing.rowCount) throw new AppError('Authorized person not found.', 404);
    if (existing.rows[0].parent_id !== req.user.id) {
      throw new AppError('Not your authorized person.', 403);
    }

    await query('DELETE FROM authorized_pickup_persons WHERE id=$1', [req.params.id]);
    unlinkUploadedFile(existing.rows[0].photo_path);

    res.json({ message: 'Authorized person removed.' });
  } catch (err) { next(err); }
});

module.exports = router;

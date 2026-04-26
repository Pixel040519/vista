const express = require('express')
const router  = express.Router()
const bcrypt  = require('bcryptjs')
const Joi     = require('joi')
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { normaliseName } = require('../utils/nameHelper')
const { gradeScopeForRole } = require('../utils/roles')
const {
  uploadProfilePhoto,
  photoUrlFromPath,
  unlinkUploadedFile,
} = require('../middleware/upload.middleware')

router.use(authenticate)

const updateSchema = Joi.object({
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow('', null),
  phone:       Joi.string().min(7).required(),
})

const passwordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword:     Joi.string().min(8).required(),
})

// PUT /api/profile/me — update own name parts + phone
router.put('/me', async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { phone, ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    const result = await query(
      `UPDATE users
         SET surname=$1, first_name=$2, middle_name=$3, phone=$4, updated_at=NOW()
         WHERE id=$5
         RETURNING id, email, full_name, surname, first_name, middle_name, role, phone, photo_path, created_at`,
      [surname, first_name, middle_name || null, phone, req.user.id]
    )
    if (!result.rows.length) throw new AppError('User not found.', 404)

    const user = result.rows[0]
    user.photo_url = photoUrlFromPath(req, user.photo_path)
    delete user.photo_path
    user.grade_scope = gradeScopeForRole(user.role)

    if (user.role === 'teacher') {
      const asgn = await query(
        `SELECT id, grade_level, section, subject, school_year
         FROM teacher_assignments WHERE teacher_id=$1
         ORDER BY grade_level, section, subject`,
        [user.id]
      )
      user.assignments = asgn.rows
    }

    const syRes = await query('SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1')
    user.active_school_year = syRes.rows[0]?.label || null

    res.json({ message: 'Profile updated.', user })
  } catch (err) { next(err) }
})

// POST /api/profile/me/photo — upload/replace own profile photo (multipart, field "photo")
router.post('/me/photo', uploadProfilePhoto, async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('A photo is required.', 400)

    const newPath = `profile/${req.file.filename}`

    const existing = await query('SELECT photo_path FROM users WHERE id=$1', [req.user.id])
    if (!existing.rows.length) {
      unlinkUploadedFile(newPath)
      throw new AppError('User not found.', 404)
    }

    const result = await query(
      `UPDATE users SET photo_path=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, email, full_name, surname, first_name, middle_name, role, phone, photo_path, created_at`,
      [newPath, req.user.id]
    )

    if (existing.rows[0].photo_path && existing.rows[0].photo_path !== newPath) {
      unlinkUploadedFile(existing.rows[0].photo_path)
    }

    const user = result.rows[0]
    user.photo_url = photoUrlFromPath(req, user.photo_path)
    delete user.photo_path
    user.grade_scope = gradeScopeForRole(user.role)

    res.json({ message: 'Profile photo updated.', user })
  } catch (err) { next(err) }
})

// PATCH /api/profile/me/password — change own password (requires current password)
router.patch('/me/password', async (req, res, next) => {
  try {
    const { error, value } = passwordSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { currentPassword, newPassword } = value

    const existing = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id])
    if (!existing.rows.length) throw new AppError('User not found.', 404)

    const ok = await bcrypt.compare(currentPassword, existing.rows[0].password_hash)
    if (!ok) throw new AppError('Current password is incorrect.', 401)

    const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(12))
    await query(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2',
      [hash, req.user.id]
    )

    res.json({ message: 'Password updated.' })
  } catch (err) { next(err) }
})

module.exports = router

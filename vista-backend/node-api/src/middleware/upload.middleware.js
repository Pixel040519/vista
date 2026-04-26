// Multer disk-storage helpers for image uploads. Files land under
// vista-backend/node-api/uploads/<bucket>/<uuid>.<ext> and are served back
// by the static handler mounted in server.js at /uploads.

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('./error.middleware');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

function buildUploader(bucket) {
  const dest = path.join(UPLOAD_ROOT, bucket);
  fs.mkdirSync(dest, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
      cb(new AppError('Photo must be JPEG, PNG, or WEBP.', 400));
    },
  });
}

const uploadAuthorizedPickupPhoto = buildUploader('authorized-pickup').single('photo');
const uploadProfilePhoto = buildUploader('profile').single('photo');

// Build a publicly-reachable URL from a stored relative path. The base URL is
// derived from the incoming request so the same file resolves correctly on
// localhost, the LAN IP, and the Android emulator loopback (10.0.2.2).
function photoUrlFromPath(req, relPath) {
  if (!relPath) return null;
  const proto = req.protocol;
  const host = req.get('host');
  const clean = relPath.startsWith('/') ? relPath : `/${relPath}`;
  return `${proto}://${host}/uploads${clean}`;
}

// Best-effort delete of an old file when replacing/removing a photo. Swallows
// ENOENT so a missing-on-disk record never blocks the user-facing operation.
function unlinkUploadedFile(relPath) {
  if (!relPath) return;
  const abs = path.join(UPLOAD_ROOT, relPath.replace(/^\/+/, ''));
  fs.unlink(abs, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[upload] failed to unlink', abs, err.message);
    }
  });
}

module.exports = {
  uploadAuthorizedPickupPhoto,
  uploadProfilePhoto,
  photoUrlFromPath,
  unlinkUploadedFile,
  UPLOAD_ROOT,
};

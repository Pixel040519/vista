// Re-encode an uploaded image before it is stored anywhere public.
//
// Three things the raw multer file cannot be trusted with:
//   - It is whatever bytes the client sent under whatever MIME type it claimed.
//     Decoding it with sharp is the real check; a renamed .txt fails here.
//   - Phone cameras store rotation as EXIF orientation rather than rotating the
//     pixels, so without .rotate() a portrait photo renders sideways (the
//     school's own facility set carries orientation 6).
//   - That same EXIF block can carry GPS coordinates. Re-encoding writes none of
//     it — sharp only keeps metadata when asked to with .withMetadata().

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../middleware/error.middleware');
const { UPLOAD_ROOT } = require('../middleware/upload.middleware');

function discard(file) {
  if (!file?.path) return;
  fs.unlink(file.path, () => {});
}

/**
 * @param file   a multer file (disk storage)
 * @param bucket folder under uploads/ to write into
 * @returns { image_path, thumb_path } relative to uploads/, thumb_path NULL
 *          when no thumbWidth is asked for
 */
async function processImage(file, bucket, { maxWidth = 1600, thumbWidth = null } = {}) {
  const dir = path.join(UPLOAD_ROOT, bucket);
  fs.mkdirSync(dir, { recursive: true });
  const id = uuidv4();
  const written = [];

  try {
    // failOn 'error' rejects truncated/corrupt files instead of rendering half
    // an image; limitInputPixels guards against a decompression bomb.
    const source = sharp(file.path, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();

    const main = `${id}.jpg`;
    await source.clone()
      .resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(dir, main));
    written.push(main);

    let thumb = null;
    if (thumbWidth) {
      thumb = `${id}-thumb.jpg`;
      await source.clone()
        .resize({ width: thumbWidth, height: Math.round(thumbWidth * 0.75), fit: 'cover' })
        .jpeg({ quality: 78, mozjpeg: true })
        .toFile(path.join(dir, thumb));
      written.push(thumb);
    }

    return {
      image_path: `${bucket}/${main}`,
      thumb_path: thumb ? `${bucket}/${thumb}` : null,
    };
  } catch (err) {
    for (const f of written) fs.unlink(path.join(dir, f), () => {});
    throw new AppError('That file could not be read as an image. Use a JPEG, PNG or WEBP photo.', 400);
  } finally {
    discard(file);
  }
}

module.exports = { processImage, discard };

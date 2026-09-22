// One-time import of the landing page's bundled facility gallery into VISTA.
//
//   cd vista-backend/node-api
//   node scripts/seedFacilities.js
//
// Reads the list from vista-landingpage/src/assets/data/facilities.js (the same
// file the site falls back to when the API is down) and the photos from
// vista-landingpage/public/facilities/gallery/<slug>-N.jpg. Each photo goes
// through utils/imageProcess.js exactly as an admin upload would, so what the
// site serves afterwards is re-encoded, upright and free of EXIF.
//
// Idempotent: a facility whose slug already exists is skipped whole, so running
// it again inserts nothing, and it never touches a facility an admin created or
// edited. Requires 2026_09_22_public_content.sql to have been applied.

const { envPath } = require('../src/config/env');
require('dotenv').config({ path: envPath });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { pool, withTransaction } = require('../src/config/database');
const { processImage } = require('../src/utils/imageProcess');
const { unlinkUploadedFile } = require('../src/middleware/upload.middleware');

const LANDING = path.resolve(__dirname, '..', '..', '..', 'vista-landingpage');
const GALLERY = path.join(LANDING, 'public', 'facilities', 'gallery');

async function main() {
  const { facilities } = await import(
    pathToFileURL(path.join(LANDING, 'src', 'assets', 'data', 'facilities.js')).href
  );

  let added = 0, skipped = 0, photos = 0;

  for (const [index, f] of facilities.entries()) {
    const exists = await pool.query(`SELECT 1 FROM facilities WHERE slug = $1`, [f.slug]);
    if (exists.rowCount) { skipped++; continue; }

    // processImage consumes (deletes) its input, so work from temp copies —
    // never from the landing page's own files.
    const processed = [];
    try {
      for (const [i, caption] of f.angles.entries()) {
        const src = path.join(GALLERY, `${f.slug}-${i + 1}.jpg`);
        if (!fs.existsSync(src)) { console.warn(`  missing ${src}, skipped`); continue; }
        const tmp = path.join(os.tmpdir(), `vista-seed-${f.slug}-${i + 1}.jpg`);
        fs.copyFileSync(src, tmp);
        const out = await processImage({ path: tmp }, 'facilities', { maxWidth: 1600, thumbWidth: 640 });
        processed.push({ ...out, caption });
      }

      await withTransaction(async (client) => {
        const r = await client.query(
          `INSERT INTO facilities (name, slug, sort_order) VALUES ($1, $2, $3) RETURNING id`,
          [f.name, f.slug, index]
        );
        for (const [i, p] of processed.entries()) {
          await client.query(
            `INSERT INTO facility_photos (facility_id, image_path, thumb_path, caption, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [r.rows[0].id, p.image_path, p.thumb_path, p.caption, i]
          );
        }
      });
    } catch (err) {
      for (const p of processed) { unlinkUploadedFile(p.image_path); unlinkUploadedFile(p.thumb_path); }
      throw err;
    }

    added++;
    photos += processed.length;
    console.log(`  + ${f.name} (${processed.length} photos)`);
  }

  console.log(`Facilities added: ${added}, photos: ${photos}, already present: ${skipped}.`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());

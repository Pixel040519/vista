// The facility gallery bundled with the site.
//
// It is two things at once. It is the FALLBACK the home page shows whenever the
// VISTA API is unset or unreachable — the site must render with the backend
// down, and an empty gallery would look broken. And it is the SOURCE the
// one-time seed script (vista-backend/node-api/scripts/seedFacilities.js) reads
// to put these same photos into VISTA, where admins manage them from then on.
//
// Each facility carries one caption per angle; the photo files are
// /facilities/gallery/<slug>-1.jpg … -N.jpg, with -1 doubling as the grid cover.
export const facilities = [
  {
    name: 'Gymnasium',
    slug: 'gymnasium',
    angles: [
      'From the upper gallery',
      'The full court and stage',
      'Along the sideline',
      'From the baseline',
    ],
  },
  {
    name: 'Library',
    slug: 'library',
    angles: [
      'Shelving down the main aisle',
      'Between the stacks',
      'The browsing island',
      'Reading tables',
    ],
  },
  {
    name: 'Science laboratory',
    slug: 'science-lab',
    angles: [
      'Preparation benches',
      'Benches from the back of the room',
      'Storage cabinets and displays',
      'Display shelves at the far wall',
    ],
  },
  {
    name: 'Computer laboratory',
    slug: 'computer-lab',
    angles: ['Workstations at the front', 'From the doorway', 'Rows from the back'],
  },
  {
    name: 'Auditorium',
    slug: 'auditorium',
    angles: ['The rake, seen from the stage', 'Toward the stage', 'From the rear seats'],
  },
  {
    name: 'Culinary center',
    slug: 'culinary',
    angles: [
      'Preparation tables',
      'The cooking stations',
      'Work surfaces along the wall',
      'The full room',
    ],
  },
  {
    name: 'Dance studio',
    slug: 'dance-studio',
    angles: ['Mirrors along the long wall', 'From the far corner', 'Toward the windows'],
  },
  {
    name: 'Tots play area',
    slug: 'play-area',
    angles: ['The climbing frame and slide', 'From the other side', 'The wider play room'],
  },
];

// The shape the home page renders, whichever source it came from:
//   { name, slug, cover, photos: [{ src, thumb, caption }] }
export const bundledFacilities = facilities.map((f) => ({
  name: f.name,
  slug: f.slug,
  cover: `/facilities/thumbs/${f.slug}.jpg`,
  photos: f.angles.map((caption, i) => ({
    src: `/facilities/gallery/${f.slug}-${i + 1}.jpg`,
    thumb: `/facilities/gallery/${f.slug}-${i + 1}.jpg`,
    caption,
  })),
}));

// The same shape from GET /api/public/facilities.
export function facilitiesFromApi(rows) {
  return rows
    .filter((f) => f.photos?.length)
    .map((f) => ({
      name: f.name,
      slug: f.slug,
      cover: f.photos[0].thumb_url,
      photos: f.photos.map((p) => ({ src: p.url, thumb: p.thumb_url, caption: p.caption || '' })),
    }));
}

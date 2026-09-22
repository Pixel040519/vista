// School announcements on the website.
//
// They come from VISTA: an admin posts one and ticks "Also show on the public
// website", and GET /api/public/announcements serves it (see
// src/assets/lib/publicContent.js). There is deliberately NO bundled fallback
// list — the one that used to live here was placeholder content with invented
// dates, and an announcement is only worth showing if it is real. When VISTA is
// unreachable the page says so and points to the Facebook page instead.
export const FACEBOOK_PAGE = 'https://www.facebook.com/NRYS1939';

const DATE = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

// A row from the API → what the Announcements page and NewsWidget render.
export function announcementFromApi(row) {
  return {
    id: row.id,
    date: row.published_at ? DATE.format(new Date(row.published_at)) : '',
    category: row.category,
    title: row.title,
    excerpt: row.summary || row.content,
    content: row.content,
    summary: row.summary,
    image: row.image_url,
    isPinned: row.is_pinned,
  };
}

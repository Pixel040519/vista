# VISTA Landing Page

The public website for **Northern Rizal Yorklin School** — 北黎刹育仁中學, Grace Park West,
Caloocan City, est. 1939.

React 19 + Vite 8 + Tailwind v4. It is a brochure site: no login and no database of its own.
It reaches VISTA in two ways — a link to the dashboard's login page, and, when `VITE_API_URL`
is set, **read-only** requests to `GET /api/public/*` for the three things admins publish from
VISTA: announcements, the facility gallery and the admissions calendar. Every one of those
reads fails soft, so the site still renders with the backend down.

## Running it

```bash
npm install
npm run dev       # http://localhost:5174
npm run build     # → dist/
npm run preview   # serve the production build
npm run lint
```

Port **5174** is pinned in `vite.config.js`. `vista-dashboard` owns 5173; before the pin both
apps defaulted to the same port and whichever started second silently moved.

## Configuration

```bash
cp .env.example .env.local
```

| Variable | Purpose | Default |
|---|---|---|
| `VITE_VISTA_URL` | Where the VISTA dashboard is served from. The LOGIN button and "Open the portal" link to `<VITE_VISTA_URL>/login`. | `http://localhost:5173` |
| `VITE_API_URL` | Where the Node API is served from, for the read-only `/api/public/*` calls. **Unset means a fully static site** — which is also exactly what it falls back to when the API is unreachable. | *(empty)* |

Vite inlines `import.meta.env` at build time, so set both **before** `npm run build` for
production — they cannot be changed in the built output.

Two things that bite locally: without `.env.local` the dev server is silently static, so
edits made on the dashboard's Facility Gallery, Announcements or Key Dates pages never appear
here and nothing errors. And the API's `ALLOWED_ORIGINS` must include this site's origin.

## Pages

| Route | Contents |
|---|---|
| `/` | Full-screen campus hero, quick facts, **news & announcements carousel** (newest 9; a card opens the post in a modal), programme table, **facilities mosaic** (four rooms at a time, arrows to the rest; a card opens the photo viewer), VISTA portal, enrolment CTA |
| `/about` | Preface, brief history, vision and mission, the Guiding Principles, school hymn |
| `/programs` | The four academic levels and the curriculum highlights |
| `/admissions` | Requirements by student type (accordion), key dates |
| `/announcements` | Every public post, six at a time with **Load more announcements**; cards start collapsed and expand in place with Read more / Show less. Links to the Facebook page |
| `/contact` | Location, phones, emails, Facebook |

There is no `/login` route here — LOGIN opens the dashboard in a new tab.

## Content

Copy comes from the school's own material, chiefly the **Students' Handbook**. The Guiding
Principles (智 Knowledge, 仁 Benevolence, 勇 Courage) and the four-stanza Vision are quoted from
it verbatim.

**Announcements, the facility gallery and the key dates come from VISTA**, not from this
repo. Admins manage them in the dashboard and the site reads them through `/api/public/*`
(`src/assets/lib/publicContent.js`). What is in `src/assets/data/` is only the mappers and,
for facilities, a bundled fallback set:

| File | Holds |
|---|---|
| `announcements.js` | `FACEBOOK_PAGE` + `announcementFromApi()`. **No bundled list** — the placeholder one had invented dates, and a fake notice is worse than none. |
| `facilities.js` | `bundledFacilities` (the photos the site ships with, used until VISTA answers) + `facilitiesFromApi()`. |
| `keyDates.js` | `keyDateFromApi()` + `formatKeyDate()`. **No bundled list**, same reasoning as announcements. |

**The school year the site names comes from VISTA too.** It is the year whose key dates are
published — not the active one and not the upcoming one, because during enrolment season the
site advertises the year *after* the one currently running. With nothing published the site
names no year at all and shows the registrar's details in place of the calendar.

There is deliberately no tuition or fee information on the site, and no claim about grading
policy. The admissions requirements are the standard Philippine set and should be confirmed
against the registrar's actual list.

## Images

`public/facilities/` holds the photographs the site ships with — the offline fallback, and
the set `vista-backend/node-api/scripts/seedFacilities.js` imports into VISTA once, after
which admins manage the gallery from the dashboard. Taken from the client's NRYS Facilities
set:

- `quadrangle-wide.jpg` — the home hero
- `thumbs/<slug>.jpg` — facility mosaic covers
- `gallery/<slug>-N.jpg` — the lightbox, 3–4 angles per room

Source photographs carry **EXIF orientation 6** and render sideways unless the rotation is
applied when re-exporting them.

## Project layout

```
src/
  App.jsx                    routes + ScrollManager
  config.js                  VITE_VISTA_URL → VISTA_LOGIN_URL, VITE_API_URL → API_URL
  style.css                  Tailwind, fonts, cursor/selection/drag rules, the mosaic's page-turn animation
  assets/
    components/  Navbar, Footer, PageHeader, ui.jsx (shared primitives),
                 NewsCarousel (Home's news band + its modal),
                 FacilityMosaic (Home's facilities section: four rooms per page),
                 AnnouncementMedia + announcementIcons (a post's picture, or its category tile),
                 AdmissionsTimeline (the key-dates block, on Admissions), EnrollCta (the yellow band)
    data/        announcements.js, facilities.js, keyDates.js  — API mappers
    lib/         publicContent.js  — the fail-soft reads and their hooks
    pages/       Home, About, Programs, Admissions, Announcements, Contact
```

`AdmissionsTimeline` and `EnrollCta` are each the **only** renderer of their block. Home and
Admissions used to hold separate copies of the key-dates list and had already drifted (five
rows against four), and the yellow CTA band was duplicated between Home and Programs with the
school year hardcoded in two different spellings. Home no longer shows the timeline at all —
its band became the news carousel — but still names the next key date in the yellow band.

`AnnouncementMedia` is shared the same way: the Home carousel, its modal and the
Announcements page all draw a post's picture — or, without one, a navy tile with its
category's icon — through it, so a post looks the same wherever it appears.

See `CLAUDE.md` in this directory for the design system and the non-obvious behaviour
(scroll handling, selection rules, why the port is pinned).

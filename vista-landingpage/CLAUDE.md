# VISTA Landing Page — CLAUDE.md

The school's **public marketing site** for Northern Rizal Yorklin School. React 19 + Vite 8 +
Tailwind v4, served on **port 5174**.

It is not part of the VISTA application. It has **no authentication and no hard backend
dependency** — it is a brochure site that links across to the dashboard for login, and
*optionally* reads two things admins publish from VISTA: public announcements and the
facility gallery (`GET /api/public/*`). The page must still render with the Node API down,
so every one of those reads fails soft. Adding any other API dependency is a deliberate
decision, not a small one.

```bash
cd vista-landingpage
npm install
npm run dev      # http://localhost:5174
npm run build
npm run lint
```

## Port 5174 is pinned on purpose

`vite.config.js` sets `server.port: 5174`. Both this app and `vista-dashboard` used to default
to 5173, so whichever started second silently moved — which meant the `VITE_VISTA_URL` fallback
could point the LOGIN button at *this* app instead of the dashboard. Do not remove the pin.

## Linking into the VISTA dashboard

The dashboard is a **separate app on its own origin**, so links into it are ordinary
cross-origin anchors, never react-router routes.

- `src/config.js` reads `VITE_VISTA_URL` (see `.env.example`) and exports `VISTA_LOGIN_URL`.
  The fallback is `http://localhost:5173`, the port the dashboard pins.
- Three places link there: the desktop LOGIN, the mobile-menu LOGIN, and Home's
  "Open the portal". All are `<a target="_blank" rel="noreferrer">`.
- `import.meta.env` is **inlined at build time**, so production needs `VITE_VISTA_URL` set
  before `npm run build`; it cannot be changed afterwards without rebuilding.

## Reading from VISTA (`src/assets/lib/publicContent.js`)

- `VITE_API_URL` (`src/config.js` → `API_URL`) points at the Node API. **Unset means fully
  static**, which is also exactly what the site falls back to when the API is unreachable.
  Like `VITE_VISTA_URL` it is inlined at build time. The API's `ALLOWED_ORIGINS` must include
  this site's origin, and `/uploads` sends `Cross-Origin-Resource-Policy: cross-origin` so
  the photos load here.
- **Locally it lives in `.env.local`** (gitignored by `*.local`): `VITE_API_URL=http://localhost:5000`.
  Without that file the dev server is silently static — edits made on the dashboard's
  Facility Gallery or public announcements never show here, and nothing errors, because
  the bundled fallback is indistinguishable from "the API has no changes". Check this first
  when dashboard edits "don't reflect". Vite restarts itself when an env file changes.
- `getPublic(path)` — 4 s `AbortController` timeout, returns `null` on any failure, never
  throws into a render.
- `useFacilities()` starts on `bundledFacilities` and swaps in VISTA's gallery only when it
  answers with at least one facility — the section is never empty and never waits.
- `useAnnouncements()` returns `{ status: 'loading' | 'ready' | 'unavailable', announcements }`.
  There is **no bundled fallback list**: the placeholder that lived in
  `data/announcements.js` had invented dates, and a fake notice is worse than none. On
  `unavailable` the page says so and points to Facebook. `NewsWidget` renders nothing then.
- The public API caches for 60 s (`Cache-Control`), so a browser keeps showing the last
  answer for up to a minute after the API goes down.

## Design system

The design is direction "B — Prospectus": information-first, institutional, navy and yellow.
`Home.jsx` is the reference implementation; every other page follows it.

| Element | Pattern |
|---|---|
| Fonts | IBM Plex Sans / IBM Plex Mono, set as `--font-sans` / `--font-mono` in `@theme` |
| Section band | `bg-white dark:bg-[#00152e]`, alternating with `bg-[#F0F4F8] dark:bg-[#001f44]` and navy `bg-[#001f3f] dark:bg-[#001024]` |
| Section inner | `mx-auto max-w-7xl px-6 py-16 sm:px-12 lg:px-24 lg:py-20` (exported as `SECTION`) |
| Headings | `HEADING` from `components/ui.jsx` |
| Eyebrows | the `Label` component — mono, 11px, uppercase, `tracking-[0.14em]` |
| Icons | inline stroke SVG on a 24 grid at `strokeWidth 2` — **never emoji** |
| Cards | `rounded-2xl border border-slate-200 dark:border-white/10` |
| Accent | `yellow-400`; navy pill for primary buttons, outlined pill for secondary |

`src/assets/components/ui.jsx` holds the shared primitives (`Label`, `CheckIcon`, `Icon`,
`Card`, `IconTile`, `SECTION`, `HEADING`). Import them; do not re-declare per page.
`components/PageHeader.jsx` is the navy header band every page except Home uses — Home has its
own full-screen photo hero.

The **previous** design (pastel gradient blobs, `rounded-b-[8rem]` hero curves, emoji icons,
`hover:-translate-y-2` cards, a "← Back to Home" pill on every page) has been removed
everywhere. Do not reintroduce any of it.

## Dark mode

`@variant dark (&:where(.dark, .dark *))` in `style.css`; the Navbar toggle writes
`localStorage.theme` and adds/removes `.dark` on `<html>`. Every surface needs a `dark:` pair.
The one exception is Home's hero, which sits on a photo and is white-on-dark in both themes.

## Scrolling — `ScrollManager` in `App.jsx`

React Router does not reset scroll on navigation and ignores `#hash` targets. `ScrollManager`
handles both. Three things there are load-bearing and all fail **silently** if removed:

1. **`behavior: 'auto'` is required.** `style.css` sets a global `scroll-behavior: smooth`,
   and that animated scroll gets cancelled mid-navigation, leaving the page where it was.
2. **The scroll waits two animation frames.** Scrolling in the same tick as a route change is
   a no-op: the incoming page has not been laid out yet, so the document is still
   viewport-height and there is nowhere to scroll to.
3. **A hash jump waits for `document.fonts.ready`.** Web fonts change text metrics and move
   the anchor; without this a cold load of `/about#vision` overshot by ~600px.

## Text selection and dragging

Deliberate, and easy to undo by accident:

- `body` sets `cursor: default` and `user-select: none` — no I-beam, and clicking a button or
  heading never leaves its label highlighted.
- Content a visitor may legitimately need to copy opts back in with **`.selectable`**: the
  address, every contact detail, the admission requirements, and About's preface, history,
  vision, mission, guiding principles and school hymn.
- Every `<img>` carries `draggable="false"` (the part that works in Firefox), plus a global
  `img { -webkit-user-drag: none }` rule for Chromium and for images added later.

## Content sources

Copy is the school's own, not invented. The **Students' Handbook** is authoritative:

- About's **Guiding Principles** (智 Knowledge / 仁 Benevolence / 勇 Courage) are Section 4,
  verbatim. They are also the site's spine — the home hero and the footer both carry the motto.
- About's **Vision** is Section 3 and has **four** stanzas: learner, person, advocate, and
  steward. An earlier version of this page dropped the steward stanza; keep all four.
- Contact details, programme levels and the school hymn come from the existing site.

**Announcements come from VISTA**, not from this repo. `src/assets/data/announcements.js`
now holds only `FACEBOOK_PAGE` and `announcementFromApi()`, the one mapper both the
Announcements page and `NewsWidget` use — they once held separate copies that drifted.

**`src/assets/data/facilities.js` is the bundled gallery** — the list of rooms and captions
that used to be inline in `Home.jsx`. It is both the offline fallback and the source the
backend's one-time `scripts/seedFacilities.js` imports into VISTA, after which admins manage
the gallery from the dashboard. `bundledFacilities` / `facilitiesFromApi()` produce the one
shape the page renders: `{ name, slug, cover, photos: [{ src, thumb, caption }] }`. The home
heading counts the rooms (`countWord`) rather than hardcoding "Eight".

Where a real figure is unknown it is either omitted or bracketed. There is deliberately **no
tuition or fee schedule** and **no grading-policy claim** anywhere on the site.

## Known gaps

- `NewsWidget.jsx` is no longer rendered by any page (Home's direction-B design has no
  announcements section). The component still exists and reads `useAnnouncements(3)`.
- The **bundled facility photos** live in `public/facilities/`: `thumbs/` for the grid, `gallery/`
  for the lightbox (`<slug>-1.jpg … -N.jpg`, with `-1` doubling as the cover), plus
  `quadrangle-wide.jpg` for the hero. Source images are the client's NRYS Facilities set and
  carry **EXIF orientation 6** — they render sideways unless the rotation is applied.
- Admissions requirements are the standard Philippine set and have **not** been confirmed
  against the registrar's actual list.

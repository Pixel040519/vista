# VISTA Landing Page — CLAUDE.md

The school's **public marketing site** for Northern Rizal Yorklin School. React 19 + Vite 8 +
Tailwind v4, served on **port 5174**.

It is not part of the VISTA application. It has **no authentication and no hard backend
dependency** — it is a brochure site that links across to the dashboard for login, and
*optionally* reads three things admins publish from VISTA: public announcements, the
facility gallery and the admissions calendar (`GET /api/public/*`). The page must still render with the Node API down,
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
  `unavailable` the page says so and points to Facebook, and so does Home's `NewsCarousel`.
  Home uses it (`useAnnouncements(9)`); the Announcements page uses
  **`useAnnouncementPages(6)`** instead — the same states plus `total`, `hasMore` and
  `loadMore()`, paging through the API's `offset` (see "Announcements page" below).
- `useKeyDates()` returns `{ status, schoolYear, dates }` — the admissions calendar **and the
  school year the whole site should name**. `schoolYear` is null whenever nothing is published
  or the API is unreachable, and that is the signal to drop the year everywhere rather than
  print one that may be wrong. The API decides *which* year it is (see
  `routes/public.routes.js`) precisely so this app does not have to choose between the active
  year and an upcoming one. A date that has passed never arrives, so nothing here ages it out.
- The public API caches for 60 s (`Cache-Control`), so a browser keeps showing the last
  answer for up to a minute after the API goes down.

## The admissions calendar and the school year — one renderer each

`AdmissionsTimeline.jsx` is the **only** thing that renders the key-dates block, and
`EnrollCta.jsx` the only thing that renders the yellow "Ready to enroll" band. Both exist
because the duplicates they replaced had already drifted:

- Home held five key dates and Admissions held four — the same list, minus "28 August ·
  Buwan ng Wika", which nobody noticed because the two are never on screen together.
- "SY 2026–2027" was written out five times across three pages, in two spellings (a literal
  en-dash on Home, `&ndash;` on Admissions and Programs), so a regex sweep would have missed
  half of them.

If another page needs either block it renders these components. Do not write a third list.

Two rules they encode:

1. **Every rendered date carries its year** (`data/keyDates.js`, `formatKeyDate`). The old
   rows said "15 May" and let one hardcoded heading do the dating for all of them, so a date
   that had passed did not *look* stale — it just quietly became wrong. A range drops what
   the two ends share: "October 13 – December 2, 2026".
2. **The year comes from `useKeyDates().schoolYear`, or is not printed.** The hero pill is
   the one element on the site that asserts a *status*, so it renders only while VISTA has a
   published calendar behind it; hardcoded, it read "Enrollment open" in every month of the
   year. The CTAs fall back to "Ready to enroll?", which is always true.

**The empty state is a panel, not a hidden section** — a visitor asking "when do I enroll?"
still deserves an answer. It says the schedule has not been announced yet and links to
`/contact`. It deliberately does **not** repeat the "registrar's office is open on weekdays"
sentence, which Admissions keeps directly under the section.

The timeline renders on **Admissions only** now. Home used to carry it (with the requirements
list) in the navy band under Quick Facts; that band became the news carousel below. Home still
names the next key date through `EnrollCta` and the year through the hero pill.

**The API sends plain `YYYY-MM-DD` strings** (it casts the DATE columns in SQL), and
`formatKeyDate` builds local dates from the parts. `new Date('2026-06-08')` parses as UTC
midnight and prints as the 7th anywhere west of Greenwich — the same class of bug the
dashboard's batch upload hit with Excel serial dates.

## News carousel on Home (`components/NewsCarousel.jsx`)

The band under Quick Facts: the newest public announcements (`useAnnouncements(9)`), side by
side, with Previous / Next and a "View all announcements" link. It replaced `NewsWidget.jsx`,
which no page rendered.

- **Native scroll + CSS scroll-snap, no slider library.** Swipe, trackpad and shift+wheel come
  free; the buttons `scrollBy` one card and disable at each end, and are hidden when every card
  already fits. ←/→ work while focus is inside the track. `.no-scrollbar` in `style.css` hides the bar.
- **Every card has a 16:9 media slot**, picture or not. A post without an image gets a navy tile
  with its category's stroke icon in that slot, so a mixed row lines up instead of alternating
  between two card heights. Titles reserve two lines and excerpts clamp to three for the same reason.
- **No autoplay.** A notice that moves while it is being read is the carousel failure, and an
  accessibility one.
- **A card opens the post in a modal on Home, not on `/announcements`** (`NewsDialog`). It has a
  **fixed height** — `min(40rem, 100dvh − margin)` — so a long post never grows it: only the
  text column scrolls, between a header (pinned, date, ×) and a footer (All announcements,
  Close) that stay put. The header gains its rule once the text has scrolled under it. The
  picture, or the category tile for a post without one, fills the left column (a band on top
  on phones), so the two kinds of post share one layout.
- It **grows from the card that opened it**: the dialog stays mounted but `invisible` + `inert`,
  so its box can be measured at click time and `transform-origin` set to the card's centre.
  Staying mounted is also what lets it fade out with the post still in it. Visibility is
  transitioned only on close — a transition *from* hidden starts hidden, which kept the ×
  from taking focus in the first frame.
- While open: the page behind does not scroll (the scrollbar's width is padded back so nothing
  shifts), Tab stays inside, focus starts on the × and returns to the card on close. Backdrop,
  ×, Close and Escape all close it; Escape is heard on `window` because Safari does not focus a
  clicked button. Every post opens scrolled to its top.
- Empty or unreachable → a slim panel pointing to Facebook, like the Announcements page, rather
  than a gap in the page.

`AnnouncementMedia.jsx` (the picture, or the category tile) and `announcementIcons.jsx` are
shared by the carousel, its modal and the Announcements page, so a post looks the same on all
three. The icons live in their own component-free module for react-refresh's sake.

## Announcements page (`pages/Announcements.jsx`)

Built to stay short however much the school posts:

- **Cards start collapsed, at one fixed height.** The text box is `COLLAPSED` (132px, about
  five lines) with its tail faded by a `mask-image` gradient (a mask, not a coloured overlay,
  so dark mode needs nothing). **Read more** animates `height` to the text's measured height
  (a `ResizeObserver` keeps it right through resizes and font loads); **Show less** animates
  back, and if the card's top has scrolled off screen it scrolls the card back under the
  header (`scroll-mt-28`). The button appears only when the text really overflows. The title
  unclamps while open.
- **Opening one never stretches its neighbour.** Each card holds its own state and the grid is
  `items-start` — grid's default `stretch` would drag the card beside an open one to its height.
- **Posts arrive six at a time** (`useAnnouncementPages(PAGE_SIZE)` in `lib/publicContent.js`),
  using the API's `offset` + `total`. **Load more announcements** fetches the next six; it
  never loads the archive at once. The pager shows "Showing 12 of 23" with a progress bar,
  a spinner while loading, **Try again** if a page fails (what is shown stays), and "You're all
  caught up" at the end. It is hidden when everything fits on one page. After a load, focus
  moves to the first new card's title so keyboard users carry on from there.
- The hook de-duplicates by id (a post published between clicks shifts every offset), treats
  an empty page as the end even if `total` disagrees (a post unpublished between clicks), and
  falls back to "the last page came back full" against an API without `total`.
- `announcementFromApi()` trims `content` and `summary`: they render with
  `whitespace-pre-line`, so a trailing Enter showed as blank lines at the end of a post.

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

**Key dates come from VISTA** and are never in this repo. `src/assets/data/keyDates.js` holds
only `keyDateFromApi()` and `formatKeyDate()` — there is no bundled list, for the same reason
`announcements.js` has none: the five that used to be inline were placeholders nobody had
confirmed. A super admin enters them on VISTA's Key Dates page.

**Announcements come from VISTA**, not from this repo. `src/assets/data/announcements.js`
now holds only `FACEBOOK_PAGE` and `announcementFromApi()`, the one mapper both the
Announcements page and `NewsCarousel` use — they once held separate copies that drifted.

**`src/assets/data/facilities.js` is the bundled gallery** — the list of rooms and captions
that used to be inline in `Home.jsx`. It is both the offline fallback and the source the
backend's one-time `scripts/seedFacilities.js` imports into VISTA, after which admins manage
the gallery from the dashboard. `bundledFacilities` / `facilitiesFromApi()` produce the one
shape the page renders: `{ name, slug, cover, photos: [{ src, thumb, caption }] }`.

`components/FacilityMosaic.jsx` renders the section on Home: **four rooms at a time** in a
mosaic (one feature card, one wide, two small), with Previous / More arrows and an
"01–04 / 08" counter to reach the rest. The gallery is admin-managed, so nothing in it may
assume a count — the heading names no number, the pager appears only past four rooms, and
`LAYOUTS` holds one arrangement per page size (1, 2, 3 or 4) so a short last page still
fills both rows. A card carries its photo count and name, and the feature card its first
caption; cards are deliberately **not** numbered, and there are no per-room tabs under the
grid. Turning the page slides the incoming cards in from the side the arrow points to,
staggered (`.mosaic-next` / `.mosaic-prev` in `style.css`, off under
`prefers-reduced-motion`); the first page does not animate on load. Covers are the 640px
thumbnails, which a single-room page stretches past — a known softness.
Opening a card hands the room's index back to Home, which still owns the photo viewer.

Where a real figure is unknown it is either omitted or bracketed. There is deliberately **no
tuition or fee schedule** and **no grading-policy claim** anywhere on the site.

## Known gaps

- The **bundled facility photos** live in `public/facilities/`: `thumbs/` for the mosaic covers, `gallery/`
  for the lightbox (`<slug>-1.jpg … -N.jpg`, with `-1` doubling as the cover), plus
  `quadrangle-wide.jpg` for the hero. Source images are the client's NRYS Facilities set and
  carry **EXIF orientation 6** — they render sideways unless the rotation is applied.
- Admissions requirements are the standard Philippine set and have **not** been confirmed
  against the registrar's actual list.
- **No key dates exist yet**, so Admissions renders the registrar panel in place of the
  timeline, the yellow band falls back to its registrar sentence, and the site names no
  school year. That is the intended starting state — the five dates that
  used to be hardcoded were unconfirmed placeholders, so nothing was seeded — but it means
  the timeline and the year-bearing headings stay unseen until a super admin enters and
  publishes real dates on VISTA's Key Dates page.

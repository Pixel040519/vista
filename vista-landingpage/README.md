# VISTA Landing Page

The public website for **Northern Rizal Yorklin School** — 北黎刹育仁中學, Grace Park West,
Caloocan City, est. 1939.

React 19 + Vite 8 + Tailwind v4. It is a static brochure site: no login, no database, no API
calls. It reaches the VISTA system only by linking to the dashboard's login page.

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

One variable, used only to build the link into the dashboard:

```bash
cp .env.example .env.local
```

| Variable | Purpose | Default |
|---|---|---|
| `VITE_VISTA_URL` | Where the VISTA dashboard is served from. The LOGIN button and "Open the portal" link to `<VITE_VISTA_URL>/login`. | `http://localhost:5173` |

Vite inlines `import.meta.env` at build time, so set this **before** `npm run build` for
production — it cannot be changed in the built output.

## Pages

| Route | Contents |
|---|---|
| `/` | Full-screen campus hero, quick facts, admissions band, programme table, facilities gallery, VISTA portal, enrolment CTA |
| `/about` | Preface, brief history, vision and mission, the Guiding Principles, school hymn |
| `/programs` | The four academic levels and the curriculum highlights |
| `/admissions` | Requirements by student type (accordion), key dates |
| `/announcements` | School updates, linking to the Facebook page |
| `/contact` | Location, phones, emails, Facebook |

There is no `/login` route here — LOGIN opens the dashboard in a new tab.

## Content

Copy comes from the school's own material, chiefly the **Students' Handbook**. The Guiding
Principles (智 Knowledge, 仁 Benevolence, 勇 Courage) and the four-stanza Vision are quoted from
it verbatim.

`src/assets/data/announcements.js` is **placeholder content** with invented dates, marked as
such on the page — replace it with real posts (or a feed) before launch. It is the single
source for both the Announcements page and `NewsWidget`.

There is deliberately no tuition or fee information on the site, and no claim about grading
policy. The admissions requirements are the standard Philippine set and should be confirmed
against the registrar's actual list.

## Images

`public/facilities/` holds photographs of the campus taken from the client's NRYS Facilities
set:

- `quadrangle-wide.jpg` — the home hero
- `thumbs/<slug>.jpg` — facility grid covers
- `gallery/<slug>-N.jpg` — the lightbox, 3–4 angles per room

Source photographs carry **EXIF orientation 6** and render sideways unless the rotation is
applied when re-exporting them.

## Project layout

```
src/
  App.jsx                    routes + ScrollManager
  config.js                  VITE_VISTA_URL → VISTA_LOGIN_URL
  style.css                  Tailwind, fonts, cursor/selection/drag rules
  assets/
    components/  Navbar, Footer, PageHeader, NewsWidget, ui.jsx (shared primitives)
    data/        announcements.js
    pages/       Home, About, Programs, Admissions, Announcements, Contact
```

See `CLAUDE.md` in this directory for the design system and the non-obvious behaviour
(scroll handling, selection rules, why the port is pinned).

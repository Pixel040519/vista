# VISTA React Dashboard — Setup Guide

## Quick Start

### 1. Install dependencies
```bash
cd vista-dashboard
npm install
```

### 2. Start the dev server
```bash
npm run dev
# → http://localhost:5173
```
> Make sure the Node.js API (port 5000) and FastAPI (port 8000) are running first.
> The dev server proxies `/api` to `http://localhost:5000` (`vite.config.js`).

---

## Pages & Features

| Route | Page | Access |
|-------|------|--------|
| `/login` | Sign in, with **Forgot password?** and **Activate your account** | Public |
| `/activate` | First sign-in for an invited teacher or admin: email → 6-digit code → own password | Public |
| `/forgot-password` | Reset a password with a code sent by email | Public |
| `/` | Dashboard | All roles |
| `/students` | Student list + add | All (edit: admin/teacher) |
| `/students/:id` | Student profile + AI insights | All |
| `/attendance` | Daily attendance marking | All (save: admin/teacher) |
| `/grades` | Grade viewer | All |
| `/behavior` | Teachers: class roster + per-learner observation timeline, log with live tone preview. Admins: school-wide read-only log | Admin, Teacher (log: teacher) |
| `/score-entry` | Score items + raw score entry per subject | Teacher |
| `/my-class` | An adviser's read-only view of the section they advise | Teacher (adviser) |
| `/ece-competency` | Competency tracker for descriptively-assessed levels | Admin (read-only), Teacher |
| `/risk` | AI risk overview | Admin, Teacher |
| `/announcements` | Announcements — a **VISTA Portal** tab (staff, parents in the app) and a **Public Website** tab | All (post: admin; website: super admin, read-only for scoped admins) |
| `/facilities` | Facility Gallery — the photos the website shows | Super admin |
| `/accounts` | Teacher, admin and parent accounts — invited by email; no admin ever sets a password | Admin (Admins tab: super admin) |
| `/curriculum` | School years, subjects, sections, advisers, assessment mode. An archived year is read-only until a super admin unlocks it | Admin |
| `/enrollment` | One school year's roster | Admin |
| `/enrollment/promotion` | Year-End Promotion wizard | Admin |
| `/profile` | Own profile + password change | All roles |

Every form that sets a password — `/activate`, `/forgot-password` and `/profile` — shows
`components/PasswordChecklist.jsx`, which ticks off the strength rule as you type: 8–72
characters with an uppercase letter, a lowercase letter, a number and a symbol. The rule is
`src/utils/passwordPolicy.js`, a mirror of the API's; the API is what enforces it.

---

## Project Structure

```
src/
├── api/
│   └── client.js          ← Axios + all API calls
├── context/
│   └── AuthContext.jsx     ← JWT auth state
├── components/
│   ├── Layout/
│   │   ├── Layout.jsx
│   │   ├── Sidebar.jsx
│   │   └── Topbar.jsx
│   ├── AccountRoster.jsx   ← shared pieces of the three Account Management tabs
│   ├── ParentAccounts.jsx  ← the Parents tab
│   ├── PasswordChecklist.jsx ← live password-strength rules
│   └── UI/
│       └── index.jsx       ← StatCard, RiskBadge, Modal, etc.
└── pages/
    ├── Login.jsx
    ├── AccountAccess.jsx   ← /activate and /forgot-password
    ├── Dashboard.jsx       ← AI charts + risk alerts
    ├── Students.jsx        ← List + search + add
    ├── StudentDetail.jsx   ← Full profile + 5 tabs
    ├── Attendance.jsx
    ├── Grades.jsx
    ├── Behavior.jsx        ← re-exports Behavior from pages.jsx (teacher roster / admin log)
    ├── RiskOverview.jsx    ← Risk distribution
    ├── Announcements.jsx
    ├── FacilityGallery.jsx ← the website's facility photos (super admin)
    ├── Enrollment.jsx      ← one school year's roster
    ├── PromotionWizard.jsx ← Year-End Promotion
    ├── CurriculumManagement.jsx
    ├── AccountManagement.jsx
    ├── ScoreEntry.jsx
    ├── EceCompetency.jsx
    ├── MyClass.jsx
    └── Profile.jsx
```

Two pages write what the **public website** shows, and both are super-admin only:
Announcements — its **Public Website** tab posts to the website alone, or to the website and
VISTA together; a public post appears in the site's Home news carousel and on its
Announcements page — and Facility Gallery. ECE and Elementary admins can read the website's
live posts on that tab but not post or edit there; teachers never see website-only posts.

---

## Build for Production
```bash
npm run build
# Output in dist/ — deploy to any static host (Nginx, Vercel, Netlify)
```

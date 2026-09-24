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
| `/login` | Login | Public |
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
| `/announcements` | Announcements — staff, parents and the public website | All (post: admin) |
| `/facilities` | Facility Gallery — the photos the website shows | Super admin |
| `/key-dates` | Key Dates — the website's admissions calendar, and the school year it names | Super admin |
| `/accounts` | Teacher, admin and parent accounts | Admin |
| `/curriculum` | School years, subjects, sections, advisers, assessment mode | Admin |
| `/enrollment` | One school year's roster | Admin |
| `/enrollment/promotion` | Year-End Promotion wizard | Admin |
| `/profile` | Own profile + password change | All roles |

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
│   └── UI/
│       └── index.jsx       ← StatCard, RiskBadge, Modal, etc.
└── pages/
    ├── Login.jsx
    ├── Dashboard.jsx       ← AI charts + risk alerts
    ├── Students.jsx        ← List + search + add
    ├── StudentDetail.jsx   ← Full profile + 5 tabs
    ├── Attendance.jsx
    ├── Grades.jsx
    ├── Behavior.jsx        ← re-exports Behavior from pages.jsx (teacher roster / admin log)
    ├── RiskOverview.jsx    ← Risk distribution
    ├── Announcements.jsx
    ├── FacilityGallery.jsx ← the website's facility photos (super admin)
    ├── KeyDates.jsx        ← the website's admissions calendar (super admin)
    ├── Enrollment.jsx      ← one school year's roster
    ├── PromotionWizard.jsx ← Year-End Promotion
    ├── CurriculumManagement.jsx
    ├── AccountManagement.jsx
    ├── ScoreEntry.jsx
    ├── EceCompetency.jsx
    ├── MyClass.jsx
    └── Profile.jsx
```

Three pages write what the **public website** shows, and all three are super-admin only:
Announcements (the "Also show on the public website" toggle — a public post appears in the
site's Home news carousel and on its Announcements page), Facility Gallery, and Key
Dates — whose published dates also decide which school year the site names.

---

## Build for Production
```bash
npm run build
# Output in dist/ — deploy to any static host (Nginx, Vercel, Netlify)
```

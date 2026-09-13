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
> Make sure the Node.js API (port 3000) and FastAPI (port 8000) are running first.

---

## Pages & Features

| Route | Page | Access |
|-------|------|--------|
| `/login` | Login | Public |
| `/` | Dashboard | All roles |
| `/students` | Student list + add | All (edit: admin/teacher) |
| `/students/:id` | Student profile + QR + AI insights | All |
| `/attendance` | Daily attendance marking | All (save: admin/teacher) |
| `/grades` | Grade viewer | All |
| `/behavior` | Teachers: class roster + per-learner observation timeline, log with live tone preview. Admins: school-wide read-only log | Admin, Teacher (log: teacher) |
| `/securepass` | QR dismissal verifier | Admin, Teacher |
| `/risk` | AI risk overview | Admin |
| `/announcements` | Announcements | All (post: admin) |

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
    ├── SecurePass.jsx      ← QR verifier + dismissal log
    ├── RiskOverview.jsx    ← Risk distribution
    └── Announcements.jsx
```

---

## Build for Production
```bash
npm run build
# Output in dist/ — deploy to any static host (Nginx, Vercel, Netlify)
```

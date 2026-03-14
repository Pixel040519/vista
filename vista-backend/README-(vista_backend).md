# VISTA Backend — Setup Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  React.js (Web)                  │
│               Flutter (Mobile App)               │
└───────────────────┬─────────────────────────────┘
                    │ HTTP / REST
          ┌─────────▼──────────┐
          │  Node.js API :3000 │  ← Auth, CRUD, QR, Notifications
          │  (Express.js)      │
          └─────────┬──────────┘
                    │ Internal HTTP
          ┌─────────▼──────────┐
          │  FastAPI AI :8000  │  ← Sentiment, Predictions, Risk
          │  (Python)          │
          └─────────┬──────────┘
                    │
          ┌─────────▼──────────┐
          │  PostgreSQL        │  ← Shared database
          └────────────────────┘
```

## Quick Start

### 1. Setup PostgreSQL
```bash
createdb vista_db
psql vista_db < database/schema.sql
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your DB credentials and JWT secrets
```

### 3. Start Node.js API
```bash
cd node-api
npm install
npm run dev
# → Running on http://localhost:3000
```

### 4. Start FastAPI AI Service
```bash
cd fastapi-ai
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# → Running on http://localhost:8000
# → Docs at http://localhost:8000/docs
```

---

## API Reference

### Auth Endpoints (Node.js)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/auth/register | Register user | None |
| POST | /api/auth/login | Login | None |
| POST | /api/auth/refresh | Refresh token | None |
| GET | /api/auth/me | Get current user | Bearer |

### Student Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/students | List students | All |
| GET | /api/students/:id | Get student detail | All |
| POST | /api/students | Create student | Admin/Teacher |
| PUT | /api/students/:id | Update student | Admin/Teacher |
| DELETE | /api/students/:id | Deactivate student | Admin |
| POST | /api/students/:id/generate-qr | Generate SecurePass QR | Admin/Teacher |

### Attendance Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/attendance?student_id= | Get attendance records | All |
| POST | /api/attendance | Log attendance (batch) | Admin/Teacher |

### Grade Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/grades?student_id= | Get grades | All |
| POST | /api/grades | Submit grades (batch) | Admin/Teacher |

### Behavior Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/behavior?student_id= | Get behavior logs | All |
| POST | /api/behavior | Log observation (auto-sentiment) | Admin/Teacher |

### Dismissal Endpoints (SecurePass)
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | /api/dismissal/verify | Verify QR and release student | Admin/Teacher |
| GET | /api/dismissal/logs | View dismissal history | Admin |

### AI Endpoints (via Node.js proxy → FastAPI)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/ai/predict-performance | Academic grade prediction |
| POST | /api/ai/risk-assessment | Student risk classification |
| POST | /api/ai/sentiment | Behavior text analysis |
| GET | /api/ai/dashboard-summary | Full admin dashboard data |

---

## Project Structure

```
vista-backend/
├── database/
│   └── schema.sql              ← PostgreSQL schema
├── node-api/
│   ├── package.json
│   └── src/
│       ├── server.js           ← Entry point
│       ├── config/
│       │   └── database.js     ← PG connection pool
│       ├── middleware/
│       │   ├── auth.middleware.js
│       │   └── error.middleware.js
│       └── routes/
│           ├── auth.routes.js
│           ├── student.routes.js
│           ├── crud.routes.js  ← Attendance, Grades, Behavior, Dismissal
│           └── ai.routes.js    ← Proxy to FastAPI
└── fastapi-ai/
    ├── main.py                 ← Entry point
    ├── requirements.txt
    ├── services/
    │   └── db.py               ← SQLAlchemy async session
    └── routers/
        ├── sentiment.py        ← VADER sentiment analysis
        ├── prediction.py       ← Linear Regression grade forecast
        ├── risk.py             ← Risk classification
        └── dashboard.py        ← Admin dashboard aggregation
```

---

## Next Steps
1. ✅ Backend & API — **Done**
2. ⬜ React.js Web Dashboard
3. ⬜ Flutter Mobile App
4. ⬜ Firebase Push Notifications
5. ⬜ Cloud Deployment (AWS/GCP)

//for development, use .env in root. For production, use environment variables directly or .env in node-api folder
const { envPath } = require('./config/env');
require('dotenv').config({ path: envPath });


const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// Route Imports
const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/student.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const gradeRoutes = require('./routes/grade.routes');
const behaviorRoutes = require('./routes/behavior.routes');
const dismissalRoutes = require('./routes/dismissal.routes');
const notificationRoutes = require('./routes/notification.routes');
const announcementRoutes = require('./routes/announcement.routes');
const aiRoutes = require('./routes/ai.routes');
const accountRoutes = require('./routes/account.routes');
const curriculumRoutes = require('./routes/curriculum.routes');
const scoreRoutes = require('./routes/score.routes');
const eceRoutes = require('./routes/ece.routes');
const profileRoutes = require('./routes/profile.routes');
const deviceRoutes = require('./routes/device.routes');
const pickupRoutes = require('./routes/pickup.routes');
const enrollmentRoutes = require('./routes/enrollment.routes');

const { errorHandler } = require('./middleware/error.middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Middleware ───────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate Limiting ─────────────────────────────────────────────
if(process.env.NODE_ENV === 'production'){ //we have to change the value of NODE_ENV to "production" in .env file to enable this
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
  });
  app.use('/api/', limiter); // we can use this: "app.use('/api/auth/login', limiter)" to only limit login route
}

// ─── General Middleware ────────────────────────────────────────
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Static uploads ────────────────────────────────────────────
// Profile + authorized-pickup photos uploaded via multer land here. Served
// publicly so the parent and guard mobile apps can render them with NetworkImage.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'VISTA Node API',
    timestamp: new Date().toISOString()
  });
});

// ─── API Routes ────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/behavior', behaviorRoutes);
app.use('/api/dismissal', dismissalRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/ai', aiRoutes);  // Proxy to FastAPI AI service
app.use('/api/accounts', accountRoutes);   // Admin: teacher account management
app.use('/api/curriculum', curriculumRoutes); // Subjects & sections management
app.use('/api/scores', scoreRoutes);         // Score items & student scores
app.use('/api/ece', eceRoutes);              // ECE competency catalog & records
app.use('/api/profile', profileRoutes);      // Self-service profile (any role)
app.use('/api/devices', deviceRoutes);       // FCM device-token registry
app.use('/api/pickup-persons', pickupRoutes); // Parent: authorized non-account fetchers
app.use('/api/enrollment', enrollmentRoutes); // Admin: per-school-year student enrollment

// ─── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 VISTA Node API listening on 0.0.0.0:${PORT} (all interfaces)`);
  console.log(`📡 Local:    http://localhost:${PORT}/health`);
  console.log(`📡 LAN:      http://<your-host-ip>:${PORT}/health`);
  console.log(`📡 Emulator: http://10.0.2.2:${PORT}/health\n`);
});

module.exports = app;
import axios from 'axios'
import toast from 'react-hot-toast'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

// ── Request interceptor: attach JWT ──────────────────────────
api.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Response interceptor: handle 401, errors ─────────────────
api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config

    // Auto-refresh on 401 — but only if we're not already on the login page
    // and not retrying, to avoid infinite redirect loops
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true

      // Don't redirect if the failed request WAS the login or refresh call itself
      const isAuthCall = original.url?.includes('/auth/login') ||
                         original.url?.includes('/auth/refresh')
      if (isAuthCall) return Promise.reject(err)

      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refreshToken })
          localStorage.setItem('accessToken', data.accessToken)
          original.headers.Authorization = `Bearer ${data.accessToken}`
          return api(original)    // Retry original request with new token
        } catch {
          // Refresh failed — session truly expired, log out cleanly
          localStorage.clear()
          if (window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
        }
      } else {
        // No refresh token at all — only redirect if not already on login
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      }
    }

    const msg = err.response?.data?.error || 'Something went wrong.'
    // Only show toast for non-401 errors (401 is handled silently above)
    if (err.response?.status !== 401) toast.error(msg)
    return Promise.reject(err)
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  login: (data) => api.post('/auth/login', data),
  me:    ()     => api.get('/auth/me'),
}

// ── Students ──────────────────────────────────────────────────
export const studentApi = {
  list:           (params) => api.get('/students', { params }),
  get:            (id)     => api.get(`/students/${id}`),
  create:         (data)   => api.post('/students', data),
  update:         (id, d)  => api.put(`/students/${id}`, d),
  remove:         (id)     => api.delete(`/students/${id}`),
  generateQR:     (id, m)  => api.post(`/students/${id}/generate-qr`, { expiresInMinutes: m }),
  searchParents:  (q)       => api.get('/students/parents/search', { params: { q } }),
  addGuardian:    (id, d)   => api.post(`/students/${id}/guardians`, d),
  updateGuardian: (id, gid, d) => api.put(`/students/${id}/guardians/${gid}`, d),
  removeGuardian: (id, gid) => api.delete(`/students/${id}/guardians/${gid}`),
}

// ── Attendance ────────────────────────────────────────────────
export const attendanceApi = {
  get:         (params)  => api.get('/attendance', { params }),
  bulk:        (params)  => api.get('/attendance/bulk', { params }),
  dailyDetail: (date)    => api.get('/attendance/daily-detail', { params: { date } }),
  submit:      (records) => api.post('/attendance', { records }),
}

// ── Grades ────────────────────────────────────────────────────
export const gradesApi = {
  get:         (params)  => api.get('/grades', { params }),
  getBySubject:(params)  => api.get('/grades/by-subject', { params }),
  submit:      (records) => api.post('/grades', { records }),
}

// ── Behavior ──────────────────────────────────────────────────
export const behaviorApi = {
  get:     (params)    => api.get('/behavior', { params }),
  summary: (params)    => api.get('/behavior/summary', { params }),
  log:     (data)      => api.post('/behavior', data),
  update:  (id, data)  => api.put(`/behavior/${id}`, data),
  delete:  (id)        => api.delete(`/behavior/${id}`),
}

// ── Dismissal ─────────────────────────────────────────────────
export const dismissalApi = {
  verify: (data) => api.post('/dismissal/verify', data),
  logs:   (date) => api.get('/dismissal/logs', { params: { date } }),
}

// ── Announcements ─────────────────────────────────────────────
export const announcementApi = {
  list:   ()     => api.get('/announcements'),
  create: (data) => api.post('/announcements', data),
}

// ── Notifications ─────────────────────────────────────────────
export const notificationApi = {
  list:   ()   => api.get('/notifications'),
  read:   (id) => api.patch(`/notifications/${id}/read`),
}

// ── AI ────────────────────────────────────────────────────────
export const aiApi = {
  dashboard:        ()    => api.get('/ai/dashboard-summary'),
  teacherDashboard: ()    => api.get('/ai/teacher-dashboard'),
  predict:     (data)    => api.post('/ai/predict-performance', data),
  risk:        (data)    => api.post('/ai/risk-assessment', data),
  riskAll:     ()        => api.get('/ai/risk-all'),
  sentiment:   (text)    => api.post('/ai/sentiment', { text }),
  classHealth: (id)      => api.get('/ai/class-health', { params: { student_id: id } }),
  classHealthAll: ()     => api.get('/ai/class-health/all'),
}

// ── ECE Competency (Tots School) ─────────────────────────────
export const eceApi = {
  getDomains:     ()        => api.get('/ece/domains'),
  createDomain:   (data)    => api.post('/ece/domains', data),
  updateDomain:   (id, d)   => api.put(`/ece/domains/${id}`, d),
  deleteDomain:   (id)      => api.delete(`/ece/domains/${id}`),
  getSkills:      (params)  => api.get('/ece/skills', { params }),
  createSkill:    (data)    => api.post('/ece/skills', data),
  updateSkill:    (id, d)   => api.put(`/ece/skills/${id}`, d),
  deleteSkill:    (id)      => api.delete(`/ece/skills/${id}`),
  getRecords:     (params)  => api.get('/ece/records', { params }),
  saveRecords:    (data)    => api.post('/ece/records', data),
}

// ── Account Management (Admin only) ──────────────────────────
export const accountApi = {
  getAssignments: ()       => api.get('/accounts/assignments'),
  listTeachers:   (params) => api.get('/accounts/teachers', { params }),
  getTeacher:     (id)     => api.get(`/accounts/teachers/${id}`),
  createTeacher:  (data)   => api.post('/accounts/teachers', data),
  updateTeacher:  (id, d)  => api.put(`/accounts/teachers/${id}`, d),
  deactivate:     (id)     => api.delete(`/accounts/teachers/${id}`),
  deletePermanent:(id)     => api.delete(`/accounts/teachers/${id}/permanent`),
  assignmentHistory: (id)  => api.get(`/accounts/teachers/${id}/assignment-history`),
}

// ── Scores (Score Items & Student Scores) ────────────────────
export const scoreApi = {
  getItems:     (params) => api.get('/scores/items', { params }),
  saveItems:    (data)   => api.post('/scores/items', data),
  deleteItem:   (id)     => api.delete(`/scores/items/${id}`),
  getScores:    (params) => api.get('/scores', { params }),
  saveScores:   (data)   => api.post('/scores', data),
  getBreakdown: (params) => api.get('/scores/breakdown', { params }),
}

// ── Curriculum (Subjects & Sections) ─────────────────────────
export const curriculumApi = {
  // School Years
  getSchoolYears:     ()          => api.get('/curriculum/school-years'),
  createSchoolYear:   (data)      => api.post('/curriculum/school-years', data),
  updateSchoolYear:   (id, d)     => api.put(`/curriculum/school-years/${id}`, d),
  deleteSchoolYear:   (id)        => api.delete(`/curriculum/school-years/${id}`),
  // Subjects (sy_id filters by school year)
  getSubjects:        (params)    => api.get('/curriculum/subjects', { params }),
  getSubjectsGrouped: (sy_id)     => api.get('/curriculum/subjects/grouped', { params: { sy_id } }),
  createSubject:      (data)      => api.post('/curriculum/subjects', data),
  updateSubject:      (id, d)     => api.put(`/curriculum/subjects/${id}`, d),
  deleteSubject:      (id)        => api.delete(`/curriculum/subjects/${id}`),
  // Sections (sy_id filters by school year)
  getSections:        (params)    => api.get('/curriculum/sections', { params }),
  getSectionsGrouped: (sy_id)     => api.get('/curriculum/sections/grouped', { params: { sy_id } }),
  createSection:      (data)      => api.post('/curriculum/sections', data),
  updateSection:      (id, d)     => api.put(`/curriculum/sections/${id}`, d),
  deleteSection:      (id)        => api.delete(`/curriculum/sections/${id}`),
  // Grading Structure (per subject)
  getGrading:         (subjectId) => api.get(`/curriculum/subjects/${subjectId}/grading`),
  saveGrading:        (subjectId, data) => api.put(`/curriculum/subjects/${subjectId}/grading`, data),
  clearGrading:       (subjectId) => api.delete(`/curriculum/subjects/${subjectId}/grading`),
  checkGradingScores: (subjectId) => api.get(`/curriculum/subjects/${subjectId}/grading/scores-check`),
}
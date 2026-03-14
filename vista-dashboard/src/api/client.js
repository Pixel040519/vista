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

    // Auto-refresh on 401
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refreshToken })
          localStorage.setItem('accessToken', data.accessToken)
          original.headers.Authorization = `Bearer ${data.accessToken}`
          return api(original)
        } catch {
          localStorage.clear()
          window.location.href = '/login'
        }
      } else {
        window.location.href = '/login'
      }
    }

    const msg = err.response?.data?.error || 'Something went wrong.'
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
  addGuardian:    (id, d)   => api.post(`/students/${id}/guardians`, d),
  updateGuardian: (id, gid, d) => api.put(`/students/${id}/guardians/${gid}`, d),
  removeGuardian: (id, gid) => api.delete(`/students/${id}/guardians/${gid}`),
}

// ── Attendance ────────────────────────────────────────────────
export const attendanceApi = {
  get:    (params)  => api.get('/attendance', { params }),
  submit: (records) => api.post('/attendance', { records }),
}

// ── Grades ────────────────────────────────────────────────────
export const gradesApi = {
  get:    (params)  => api.get('/grades', { params }),
  submit: (records) => api.post('/grades', { records }),
}

// ── Behavior ──────────────────────────────────────────────────
export const behaviorApi = {
  get:  (params) => api.get('/behavior', { params }),
  log:  (data)   => api.post('/behavior', data),
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
  dashboard:   ()        => api.get('/ai/dashboard-summary'),
  predict:     (data)    => api.post('/ai/predict-performance', data),
  risk:        (data)    => api.post('/ai/risk-assessment', data),
  sentiment:   (text)    => api.post('/ai/sentiment', { text }),
}

// ── Account Management (Admin only) ──────────────────────────
export const accountApi = {
  listTeachers:   (params) => api.get('/accounts/teachers', { params }),
  getTeacher:     (id)     => api.get(`/accounts/teachers/${id}`),
  createTeacher:  (data)   => api.post('/accounts/teachers', data),
  updateTeacher:  (id, d)  => api.put(`/accounts/teachers/${id}`, d),
  deactivate:     (id)     => api.delete(`/accounts/teachers/${id}`),
  deletePermanent:(id)     => api.delete(`/accounts/teachers/${id}/permanent`),
}

// ── Curriculum (Subjects & Sections) ─────────────────────────
export const curriculumApi = {
  // Subjects
  getSubjects:        (params) => api.get('/curriculum/subjects', { params }),
  getSubjectsGrouped: ()       => api.get('/curriculum/subjects/grouped'),
  createSubject:      (data)   => api.post('/curriculum/subjects', data),
  updateSubject:      (id, d)  => api.put(`/curriculum/subjects/${id}`, d),
  deleteSubject:      (id)     => api.delete(`/curriculum/subjects/${id}`),
  // Sections
  getSections:        (params) => api.get('/curriculum/sections', { params }),
  getSectionsGrouped: ()       => api.get('/curriculum/sections/grouped'),
  createSection:      (data)   => api.post('/curriculum/sections', data),
  updateSection:      (id, d)  => api.put(`/curriculum/sections/${id}`, d),
  deleteSection:      (id)     => api.delete(`/curriculum/sections/${id}`),
}
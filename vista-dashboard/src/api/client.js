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
    // Only show toast for non-401 errors (401 is handled silently above).
    // `silent: true` opts a request out entirely — for endpoints whose failure
    // is an expected state the caller already renders inline, so a toast would
    // report an error where the page is working correctly.
    if (err.response?.status !== 401 && !original?.silent) toast.error(msg)
    return Promise.reject(err)
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  login: (data) => api.post('/auth/login', data),
  me:    ()     => api.get('/auth/me'),

  // Activation and password reset — unauthenticated, and `silent` because the
  // pages show every refusal inline; a toast on top would say it twice.
  requestActivation:  (email)                   => api.post('/auth/activation/request', { email }, { silent: true }),
  verifyActivation:   (email, code)             => api.post('/auth/activation/verify', { email, code }, { silent: true }),
  completeActivation: (activation_token, password) => api.post('/auth/activation/complete', { activation_token, password }, { silent: true }),
  requestReset:       (email)                   => api.post('/auth/password-reset/request', { email }, { silent: true }),
  verifyReset:        (email, code)             => api.post('/auth/password-reset/verify', { email, code }, { silent: true }),
  completeReset:      (reset_token, password)   => api.post('/auth/password-reset/complete', { reset_token, password }, { silent: true }),
}

// ── Profile (self-service, any role) ─────────────────────────
export const profileApi = {
  updateMe:       (data) => api.put('/profile/me', data),
  changePassword: (data) => api.patch('/profile/me/password', data),
}

// ── Students ──────────────────────────────────────────────────
export const studentApi = {
  list:           (params) => api.get('/students', { params }),
  get:            (id)     => api.get(`/students/${id}`),
  create:         (data)   => api.post('/students', data),
  bulk:           (students) => api.post('/students/bulk', { students }),
  checkLrns:      (lrns)    => api.post('/students/check-lrns', { lrns }),
  checkParentEmails: (emails) => api.post('/students/check-parent-emails', { emails }),
  update:         (id, d)  => api.put(`/students/${id}`, d),
  // Archiving takes a learner off the active roll; restoring puts them back. The
  // record, its grades and its history survive either way — there is no delete.
  setArchived:    (id, archived, reason) =>
    api.patch(`/students/${id}/archive`, { archived, ...(reason ? { reason } : {}) }),
  // `studentId` (optional) marks parents who already look after that learner.
  searchParents:  (q, studentId) =>
    api.get('/students/parents/search', { params: { q, ...(studentId ? { student_id: studentId } : {}) } }),
  // The Parents tab in Account Management. `searchParents` above is a picker —
  // it needs a query and caps at 10; this is the roster, with each account's
  // children and its derived access state.
  listParents:    (params) => api.get('/students/parents', { params }),
  // Creates the account AND its children in one request. `children` is never
  // empty: a parent account with no learner is a state nothing else can express.
  createParent:   (data)   => api.post('/students/parents', data),
  addGuardian:    (id, d)   => api.post(`/students/${id}/guardians`, d),
  // What saving a guardian with this email would do. Silent: it runs on blur,
  // and a failure only means no early warning — the save still enforces it.
  checkGuardianEmail: (d) => api.post('/students/guardian-email-check', d, { silent: true }),
  updateGuardian: (id, gid, d) => api.put(`/students/${id}/guardians/${gid}`, d),
  removeGuardian: (id, gid) => api.delete(`/students/${id}/guardians/${gid}`),
  // Parent/Guardian Account Access. Separate from updateGuardian on purpose:
  // re-issuing or revoking an invitation is an access decision, not an edit to
  // the person, and the two must not travel together.
  inviteGuardian: (id, gid, email) =>
    api.post(`/students/${id}/guardians/${gid}/invitation`, email ? { email } : {}),
  revokeGuardianAccess: (id, gid) => api.delete(`/students/${id}/guardians/${gid}/invitation`),
  setAcademicAccess: (id, data) => api.patch(`/students/${id}/academic-access`, data),
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
  // Every learning area for one class (admin-only) — the "All subjects" view.
  // Silent: a refusal (e.g. a descriptively-assessed grade level) is rendered
  // inline by the page, so a toast would only repeat it.
  getClassRecord:(params) => api.get('/grades/class-record', { params, silent: true }),
  submit:      (records) => api.post('/grades', { records }),
}

// ── Behavior ──────────────────────────────────────────────────
export const behaviorApi = {
  get:     (params)    => api.get('/behavior', { params }),
  summary: (params)    => api.get('/behavior/summary', { params }),
  classRoster: (params) => api.get('/behavior/class-roster', { params }),
  log:     (data)      => api.post('/behavior', data),
  update:  (id, data)  => api.put(`/behavior/${id}`, data),
  delete:  (id)        => api.delete(`/behavior/${id}`),
}

// ── Announcements ─────────────────────────────────────────────
// Create and update are multipart because a post may carry an image; `data` is
// a FormData built by the page.
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

export const announcementApi = {
  list:   ()         => api.get('/announcements'),
  create: (data)     => api.post('/announcements', data, MULTIPART),
  update: (id, data) => api.put(`/announcements/${id}`, data, MULTIPART),
  remove: (id)       => api.delete(`/announcements/${id}`),
  // What another admin changed — served only to the author and that editor.
  edits:  (id)       => api.get(`/announcements/${id}/edits`),
}

// ── Facility gallery (super admin; shown on the public website) ─
export const facilityApi = {
  list:         ()             => api.get('/facilities'),
  create:       (data)         => api.post('/facilities', data),
  update:       (id, data)     => api.put(`/facilities/${id}`, data),
  reorder:      (ids)          => api.put('/facilities/order', { ids }),
  remove:       (id)           => api.delete(`/facilities/${id}`),
  addPhotos:    (id, formData) => api.post(`/facilities/${id}/photos`, formData, MULTIPART),
  reorderPhotos:(id, ids)      => api.put(`/facilities/${id}/photos/order`, { ids }),
  captionPhoto: (photoId, caption) => api.put(`/facilities/photos/${photoId}`, { caption }),
  removePhoto:  (photoId)      => api.delete(`/facilities/photos/${photoId}`),
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
  // Both silent: Student Detail is their only caller and renders each outcome
  // inline. The forecast answers 404 for a learner with no grades yet — an
  // ordinary state that page shows as "nothing to forecast", not a failure.
  predict:     (data)    => api.post('/ai/predict-performance', data, { silent: true }),
  risk:        (data)    => api.post('/ai/risk-assessment', data, { silent: true }),
  riskAll:     ()        => api.get('/ai/risk-all'),
  // Silent: Behavior's live tone preview fires while a teacher types, and says
  // so inline when the analyzer is unavailable rather than toasting each pause.
  sentiment:   (text)    => api.post('/ai/sentiment', { text }, { silent: true }),
  // 404 here means "you teach this learner no subject", which is a normal state
  // rather than a failure — routine for a class adviser, who opens advisory
  // learners they teach nothing to. Student Detail renders it as an inline card,
  // so the toast would be duplicate noise on a page that is working.
  classHealth: (id)      => api.get('/ai/class-health', { params: { student_id: id }, silent: true }),
  classHealthAll: ()     => api.get('/ai/class-health/all'),
  eceClassHealth: (id)   => api.get('/ai/ece-class-health', { params: { student_id: id } }),
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
  getSummary:     (params)  => api.get('/ece/summary', { params }),
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
  reissueTeacherInvitation: (id) => api.post(`/accounts/teachers/${id}/invitation`),
  cancelTeacherInvitation:  (id) => api.delete(`/accounts/teachers/${id}/invitation`),

  // Admin accounts (super_admin only). Creating a Super Admin is refused
  // inline when the confirming password is wrong, so that call is silent.
  listAdmins:    (params)  => api.get('/accounts/admins', { params }),
  createAdmin:   (data)    => api.post('/accounts/admins', data, { silent: true }),
  updateAdmin:   (id, d)   => api.put(`/accounts/admins/${id}`, d),
  deleteAdmin:   (id)      => api.delete(`/accounts/admins/${id}`),
  reissueAdminInvitation: (id) => api.post(`/accounts/admins/${id}/invitation`),
  cancelAdminInvitation:  (id) => api.delete(`/accounts/admins/${id}/invitation`),
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

// ── Enrollment (per school year, admin only) ─────────────────
export const enrollmentApi = {
  // params: { sy_id, grade_level, section, status, outcome, include_left, q }
  roster:   (params)     => api.get('/enrollment', { params }),
  history:  (studentId)  => api.get(`/enrollment/student/${studentId}`),
  // `allow_archived` is the Enrollment page saying the admin unlocked a closed
  // year on purpose; without it the API refuses to rewrite one.
  save:     (sy_id, entries, allow_archived = false) =>
    api.put('/enrollment', { sy_id, entries, allow_archived }),
  remove:   (sy_id, student_id, allow_archived = false) =>
    api.delete('/enrollment', { params: { sy_id, student_id, allow_archived } }),

  // Year-end promotion
  promotionReview: (sy_id, target_sy_id) =>
    api.get('/enrollment/promotion-review', { params: { sy_id, target_sy_id } }),
  // `allow_archived` is the wizard saying the admin unlocked a closed handover
  // year on purpose; without it the API refuses to rewrite one.
  promote: (sy_id, target_sy_id, decisions, allow_archived = false) =>
    api.post('/enrollment/promotion', { sy_id, target_sy_id, decisions, allow_archived }),
}

// ── Curriculum (Subjects & Sections) ─────────────────────────
// The class adviser's read-only view of the section they advise. Deliberately
// has no write methods — the API exposes none, because entering grades, marking
// attendance and recording scores stay with the subject teacher.
export const advisoryApi = {
  classList:  (params) => api.get('/advisory/class-list',  { params }),
  grades:     (params) => api.get('/advisory/grades',     { params }),
  competency: (params) => api.get('/advisory/competency', { params }),
  attendance: (params) => api.get('/advisory/attendance', { params }),
  behavior:   (params) => api.get('/advisory/behavior',   { params }),
}

export const curriculumApi = {
  // School Years
  getSchoolYears:     ()          => api.get('/curriculum/school-years'),
  createSchoolYear:   (data)      => api.post('/curriculum/school-years', data),
  updateSchoolYear:   (id, d)     => api.put(`/curriculum/school-years/${id}`, d),
  deleteSchoolYear:   (id)        => api.delete(`/curriculum/school-years/${id}`),
  enrollmentReadiness:(id)        => api.get(`/curriculum/school-years/${id}/enrollment-readiness`),
  // Writes take an optional `params`: `{ allow_archived: true }` once a super
  // admin has unlocked an archived school year on the Curriculum page.
  // Subjects (sy_id filters by school year)
  getSubjects:        (params)    => api.get('/curriculum/subjects', { params }),
  getSubjectsGrouped: (sy_id)     => api.get('/curriculum/subjects/grouped', { params: { sy_id } }),
  createSubject:      (data, params) => api.post('/curriculum/subjects', data, { params }),
  updateSubject:      (id, d, params) => api.put(`/curriculum/subjects/${id}`, d, { params }),
  deleteSubject:      (id, params) => api.delete(`/curriculum/subjects/${id}`, { params }),
  getSubjectUsage:    (id)        => api.get(`/curriculum/subjects/${id}/usage`),
  // Sections (sy_id filters by school year)
  getSections:        (params)    => api.get('/curriculum/sections', { params }),
  getSectionsGrouped: (sy_id)     => api.get('/curriculum/sections/grouped', { params: { sy_id } }),
  createSection:      (data, params) => api.post('/curriculum/sections', data, { params }),
  updateSection:      (id, d, params) => api.put(`/curriculum/sections/${id}`, d, { params }),
  deleteSection:      (id, params) => api.delete(`/curriculum/sections/${id}`, { params }),
  getSectionUsage:    (id)        => api.get(`/curriculum/sections/${id}/usage`),
  // Class adviser — the teacher responsible for a section as a whole, as
  // opposed to the per-subject rows in teacher_assignments. `teacher_id: null`
  // clears it.
  adviserCandidates:  (id)        => api.get(`/curriculum/sections/${id}/adviser-candidates`),
  setSectionAdviser:  (id, d, params) => api.put(`/curriculum/sections/${id}/adviser`, d, { params }),
  // Grading Structure (per subject)
  getGrading:         (subjectId) => api.get(`/curriculum/subjects/${subjectId}/grading`),
  saveGrading:        (subjectId, data, params) => api.put(`/curriculum/subjects/${subjectId}/grading`, data, { params }),
  clearGrading:       (subjectId, params) => api.delete(`/curriculum/subjects/${subjectId}/grading`, { params }),
  checkGradingScores: (subjectId) => api.get(`/curriculum/subjects/${subjectId}/grading/scores-check`),
  // Assessment mode per (school year, grade level) — numeric vs descriptive
  // and which rating scale a descriptive level uses.
  getAssessmentConfig:  (params) => api.get('/curriculum/assessment-config', { params }),
  saveAssessmentConfig: (data, params) => api.put('/curriculum/assessment-config', data, { params }),
  resetAssessmentConfig: (gradeLevel, params) =>
    api.delete(`/curriculum/assessment-config/${encodeURIComponent(gradeLevel)}`, { params }),
}
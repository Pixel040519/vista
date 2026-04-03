// ============================================================
// ATTENDANCE PAGE
// ============================================================
import { formatName, nameInitial } from '../utils/nameHelper'
import { useState, useEffect, useMemo } from 'react'
import { attendanceApi, studentApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState } from '../components/UI'
import { useAuth } from '../context/AuthContext'
import { ClipboardCheck, Search } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export function Attendance() {
  const { activeAssignments } = useAuth()
  const assignments = activeAssignments

  // Derive unique grade_level + section pairs from assignments
  const sections = useMemo(() => {
    const map = new Map()
    for (const a of assignments) {
      const key = `${a.grade_level}|||${a.section}`
      if (!map.has(key)) map.set(key, { grade_level: a.grade_level, section: a.section, subjects: [] })
      const entry = map.get(key)
      if (!entry.subjects.includes(a.subject)) entry.subjects.push(a.subject)
    }
    return [...map.values()].sort((a, b) => a.grade_level.localeCompare(b.grade_level) || a.section.localeCompare(b.section))
  }, [assignments])

  const [selectedSection, setSelectedSection] = useState('')
  const [students, setStudents] = useState([])
  const [records, setRecords]   = useState({})
  const [date, setDate]         = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [subjects, setSubjects]           = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')

  // Auto-select first section
  useEffect(() => {
    if (sections.length > 0 && !selectedSection) {
      setSelectedSection(`${sections[0].grade_level}|||${sections[0].section}`)
    }
  }, [sections])

  // Load students and subjects when section changes
  useEffect(() => {
    if (!selectedSection) { setStudents([]); setSubjects([]); setSelectedSubject(''); return }
    const [grade_level, section] = selectedSection.split('|||')
    setLoading(true)
    setRecords({})
    studentApi.list({ grade_level, section, limit: 200 })
      .then(res => setStudents(res.data.students))
      .catch(() => setStudents([]))
      .finally(() => setLoading(false))

    const allowedSubjects = sections.find(s => s.grade_level === grade_level && s.section === section)?.subjects || []
    curriculumApi.getSubjects({ grade_level })
      .then(res => {
        const list = res.data.subjects || []
        const filtered = list.filter(s => allowedSubjects.includes(s.name))
        setSubjects(filtered)
        setSelectedSubject(filtered.length === 1 ? filtered[0].id : '')
      })
      .catch(() => { setSubjects([]); setSelectedSubject('') })
  }, [selectedSection])

  // Load existing attendance records when date, section, or subject changes
  useEffect(() => {
    if (!selectedSection || !date || !selectedSubject) { setRecords({}); return }
    const [grade_level, section] = selectedSection.split('|||')
    attendanceApi.bulk({ date, grade_level, section, subject_id: selectedSubject })
      .then(res => setRecords(res.data.records || {}))
      .catch(() => setRecords({}))
  }, [selectedSection, date, selectedSubject])

  const filtered = students.filter(s =>
    formatName(s).toLowerCase().includes(search.toLowerCase()) ||
    (s.lrn || '').toLowerCase().includes(search.toLowerCase())
  )

  const setStatus = (id, status) => setRecords(p => {
    if (p[id] === status) { const { [id]: _, ...rest } = p; return rest }
    return { ...p, [id]: status }
  })

  const handleSave = async () => {
    const toSubmit = Object.entries(records).map(([student_id, status]) => ({
      student_id, date, status, subject_id: selectedSubject
    }))
    if (toSubmit.length === 0) return toast.error('No attendance marked yet.')
    setSaving(true)
    try {
      await attendanceApi.submit(toSubmit)
      toast.success(`Attendance saved for ${toSubmit.length} students.`)
    } catch {}
    setSaving(false)
  }

  const STATUS_OPTIONS = [
    { val: 'Present', color: 'bg-emerald-500 text-white border-emerald-500' },
    { val: 'Absent',  color: 'bg-red-500 text-white border-red-500' },
    { val: 'Late',    color: 'bg-amber-500 text-white border-amber-500' },
    { val: 'Excused', color: 'bg-blue-500 text-white border-blue-500' },
  ]

  const currentSection = selectedSection ? selectedSection.split('|||') : []

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Mark and track daily attendance</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} />
          <button onClick={handleSave} disabled={saving || !selectedSection || !selectedSubject} className="btn-primary">
            {saving ? 'Saving...' : 'Save Attendance'}
          </button>
        </div>
      </div>

      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="sm:w-56 min-w-0 flex-shrink-0">
          <label className="block text-xs font-medium text-slate-500 mb-1">Class</label>
          <select className="input truncate" value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
            {sections.length === 0 && <option value="">No assigned sections</option>}
            {sections.map(s => (
              <option key={`${s.grade_level}|||${s.section}`} value={`${s.grade_level}|||${s.section}`}>
                {s.grade_level} — {s.section}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:w-48 min-w-0 flex-shrink-0">
          <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
          <select className="input truncate" value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)}>
            {subjects.length === 0 && <option value="">No subjects</option>}
            {subjects.length > 1 && <option value="">Select subject...</option>}
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10" placeholder="Search student..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {!selectedSection ? (
        <div className="card">
          <EmptyState icon={ClipboardCheck} title="No sections assigned" description="Contact your admin to assign sections to your account." />
        </div>
      ) : (
      <div className="card overflow-hidden">
        {!selectedSubject ? (
          <EmptyState icon={ClipboardCheck} title="Select a subject" description="Choose a subject from the dropdown above to mark attendance." />
        ) : loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No students found"
            description={search ? 'No students match your search.' : `No students in ${currentSection[0]} — ${currentSection[1]}.`} />
        ) : (
          <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                <th>Mark Attendance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700">
                        {nameInitial(s)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{formatName(s)}</p>
                        <p className="text-xs font-mono text-slate-400">{s.lrn}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex gap-1.5 flex-wrap">
                      {STATUS_OPTIONS.map(opt => (
                        <button
                          key={opt.val}
                          onClick={() => setStatus(s.id, opt.val)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border-2 transition-all ${
                            records[s.id] === opt.val
                              ? opt.color
                              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {opt.val}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      )}
    </div>
  )
}


// ============================================================
// GRADES PAGE
// ============================================================
import { gradesApi } from '../api/client'
import { GradeChip } from '../components/UI'
import { BookOpen } from 'lucide-react'

export function Grades() {
  const [studentId, setStudentId] = useState('')
  const [students, setStudentsG]  = useState([])
  const [gradeData, setGradeData] = useState(null)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    studentApi.list({ limit: 200 })
      .then(res => setStudentsG(res.data.students))
      .catch(() => {})
  }, [])

  const fetchGrades = async (sid) => {
    setStudentId(sid)
    if (!sid) return setGradeData(null)
    setLoading(true)
    try {
      const res = await gradesApi.get({ student_id: sid })
      setGradeData(res.data)
    } catch {}
    setLoading(false)
  }

  const grouped = gradeData?.byQuarter || {}

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">Grades</h1>
        <p className="page-subtitle">View academic performance records</p>
      </div>

      <div className="card p-4">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Select Student</label>
        <select className="input" value={studentId} onChange={e => fetchGrades(e.target.value)}>
          <option value="">— Choose a student —</option>
          {students.map(s => (
            <option key={s.id} value={s.id}>{formatName(s)} ({s.lrn})</option>
          ))}
        </select>
      </div>

      {loading ? <LoadingSpinner /> : gradeData && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Grade Records</h3>
          </div>
          {gradeData.grades.length === 0 ? (
            <EmptyState icon={BookOpen} title="No grades recorded" description="Grades will appear here once submitted by teachers." />
          ) : (
            <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Subject</th><th>Quarter</th><th>Grade</th><th>Score</th><th>School Year</th></tr>
              </thead>
              <tbody>
                {gradeData.grades.map(g => (
                  <tr key={g.id}>
                    <td className="font-medium">{g.subject_name}</td>
                    <td className="text-slate-500">Q{g.quarter}</td>
                    <td><GradeChip grade={g.grade} /></td>
                    <td className="font-mono text-xs text-slate-400">{g.score || '—'}</td>
                    <td className="text-slate-400 text-xs">{g.school_year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {!studentId && !loading && (
        <div className="card">
          <EmptyState icon={BookOpen} title="Select a student" description="Choose a student above to view their grade records." />
        </div>
      )}
    </div>
  )
}


// ============================================================
// BEHAVIOR PAGE
// ============================================================
import { behaviorApi, aiApi } from '../api/client'
import { SentimentBadge, Modal } from '../components/UI'
import { Heart, Plus as PlusIcon, Pencil, Trash2 } from 'lucide-react'

export function Behavior() {
  const [students, setStudentsB]  = useState([])
  const [studentId, setStudentIdB]= useState('')
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [showLog, setShowLog]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm]           = useState({ observation: '', category: 'Social', observed_at: '' })
  const [aiResult, setAiResult]   = useState(null)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    studentApi.list({ limit: 200 })
      .then(res => setStudentsB(res.data.students))
      .catch(() => {})
  }, [])

  const fetchLogs = async (sid) => {
    setStudentIdB(sid)
    if (!sid) return setLogs([])
    setLoading(true)
    try {
      const res = await behaviorApi.get({ student_id: sid })
      setLogs(res.data.logs || [])
    } catch {}
    setLoading(false)
  }

  const previewSentiment = async () => {
    if (!form.observation.trim()) return
    try {
      const res = await aiApi.sentiment(form.observation)
      setAiResult(res.data)
    } catch {}
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (editingId) {
        await behaviorApi.update(editingId, { observation: form.observation, category: form.category })
        toast.success('Behavior log updated!')
      } else {
        await behaviorApi.log({ student_id: studentId, ...form })
        toast.success('Behavior logged successfully!')
      }
      setShowLog(false)
      setEditingId(null)
      setForm({ observation: '', category: 'Social', observed_at: '' })
      setAiResult(null)
      fetchLogs(studentId)
    } catch {}
    setSubmitting(false)
  }

  const handleEdit = (b) => {
    setForm({ observation: b.observation, category: b.category, observed_at: '' })
    setEditingId(b.id)
    setAiResult(null)
    setShowLog(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this behavior log?')) return
    try {
      await behaviorApi.delete(id)
      toast.success('Behavior log deleted.')
      fetchLogs(studentId)
    } catch {}
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Behavior Monitoring</h1>
          <p className="page-subtitle">Log and track student behavioral observations</p>
        </div>
        {studentId && (
          <button onClick={() => setShowLog(true)} className="btn-primary">
            <PlusIcon size={16} /> Log Observation
          </button>
        )}
      </div>

      <div className="card p-4">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Select Student</label>
        <select className="input" value={studentId} onChange={e => fetchLogs(e.target.value)}>
          <option value="">— Choose a student —</option>
          {students.map(s => (
            <option key={s.id} value={s.id}>{formatName(s)} ({s.grade_level})</option>
          ))}
        </select>
      </div>

      {loading ? <LoadingSpinner /> : logs.length > 0 ? (
        <div className="space-y-3">
          {logs.map(b => (
            <div key={b.id} className="card p-4 flex gap-4">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500 flex-shrink-0">
                {b.teacher_name?.[0] || 'T'}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-800">{b.teacher_name}</p>
                  <div className="flex items-center gap-2">
                    <SentimentBadge sentiment={b.sentiment} />
                    <span className="text-xs text-slate-400">{b.category}</span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-1.5">{b.observation}</p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-slate-400">{format(new Date(b.observed_at), 'MMM d, yyyy · h:mm a')}</p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleEdit(b)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                      <Pencil size={13}/>
                    </button>
                    <button onClick={() => handleDelete(b.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : studentId ? (
        <div className="card">
          <EmptyState icon={Heart} title="No behavior logs" description="Start logging observations for this student." />
        </div>
      ) : (
        <div className="card">
          <EmptyState icon={Heart} title="Select a student" description="Choose a student to view their behavior logs." />
        </div>
      )}

      <Modal open={showLog} onClose={() => { setShowLog(false); setEditingId(null); setAiResult(null) }} title={editingId ? 'Edit Behavior Observation' : 'Log Behavior Observation'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Observation *</label>
            <textarea
              className="input min-h-24 resize-none"
              placeholder="Describe the observed behavior... e.g. 'Shared materials with classmates during group work'"
              value={form.observation}
              onChange={e => { setForm(p => ({ ...p, observation: e.target.value })); setAiResult(null) }}
              required
            />
            <button type="button" onClick={previewSentiment} className="mt-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium">
              ✨ Analyze sentiment preview
            </button>
            {aiResult && (
              <div className="mt-2 p-3 bg-slate-50 rounded-xl flex items-center gap-3">
                <SentimentBadge sentiment={aiResult.sentiment} />
                <div className="text-xs text-slate-500">
                  Score: <span className="font-mono font-semibold">{aiResult.score}</span>
                  {aiResult.tags?.length > 0 && <span className="ml-2">{aiResult.tags.slice(0, 3).join(' · ')}</span>}
                </div>
              </div>
            )}
          </div>
          <div className={editingId ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-4'}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
              <select className="input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                <option>Social</option><option>Emotional</option><option>Academic</option><option>Physical</option>
              </select>
            </div>
            {!editingId && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Date & Time</label>
                <input type="datetime-local" className="input" value={form.observed_at}
                  onChange={e => setForm(p => ({ ...p, observed_at: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setShowLog(false); setEditingId(null) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? 'Saving...' : editingId ? 'Update Observation' : 'Save Observation'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}


// ============================================================
// SECUREPASS QR PAGE
// ============================================================
import { dismissalApi } from '../api/client'
import { QrCode, CheckCircle, XCircle, Clock } from 'lucide-react'
import { format as fmt } from 'date-fns'

export function SecurePass() {
  const [qrInput, setQrInput]   = useState('')
  const [result, setResult]     = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [logs, setLogs]         = useState([])

  useEffect(() => {
    dismissalApi.logs(format(new Date(), 'yyyy-MM-dd'))
      .then(res => setLogs(res.data.logs || []))
      .catch(() => {})
  }, [])

  const handleVerify = async e => {
    e.preventDefault()
    setVerifying(true)
    setResult(null)
    try {
      const res = await dismissalApi.verify({ qrPayload: qrInput })
      setResult({ success: true, ...res.data })
      toast.success('Student dismissed successfully!')
      setQrInput('')
      dismissalApi.logs(format(new Date(), 'yyyy-MM-dd'))
        .then(res => setLogs(res.data.logs || []))
        .catch(() => {})
    } catch (err) {
      setResult({ success: false, message: err.response?.data?.error || 'Verification failed.' })
    }
    setVerifying(false)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">SecurePass QR</h1>
        <p className="page-subtitle">Verify student dismissal via QR code</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* QR Verifier */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
              <QrCode size={20} className="text-teal-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Verify QR Code</h3>
              <p className="text-xs text-slate-400">Paste QR payload or use scanner</p>
            </div>
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">QR Payload</label>
              <textarea
                className="input min-h-28 resize-none font-mono text-xs"
                placeholder='{"studentId":"...","token":"...","expiresAt":"...","type":"VISTA_SECUREPASS"}'
                value={qrInput}
                onChange={e => setQrInput(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={verifying} className="btn-primary w-full justify-center">
              {verifying ? 'Verifying...' : 'Verify & Release Student'}
            </button>
          </form>

          {result && (
            <div className={`mt-4 p-4 rounded-xl flex items-start gap-3 ${result.success ? 'bg-emerald-50' : 'bg-red-50'}`}>
              {result.success
                ? <CheckCircle size={20} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                : <XCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              }
              <div>
                {result.success ? (
                  <>
                    <p className="text-sm font-semibold text-emerald-800">Student Released</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      {result.student} → Released to {result.authorizedGuardian}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-red-800">Verification Failed</p>
                    <p className="text-xs text-red-700 mt-0.5">{result.message}</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Today's Dismissal Log */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Clock size={15} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800">Today's Dismissal Log</h3>
          </div>
          {logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No dismissals recorded today.</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Student</th><th>Guardian</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="font-medium text-sm">{l.student_name}</td>
                    <td className="text-sm text-slate-500">{l.guardian_name}</td>
                    <td>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        l.status === 'Success' ? 'bg-emerald-50 text-emerald-700' :
                        l.status === 'Expired' ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>{l.status}</span>
                    </td>
                    <td className="text-xs text-slate-400 font-mono">{fmt(new Date(l.scanned_at), 'h:mm a')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


// ============================================================
// RISK OVERVIEW PAGE
// ============================================================
import { AlertTriangle, RefreshCw } from 'lucide-react'

export function RiskOverview() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all')

  const fetchRisk = async () => {
    setLoading(true)
    try {
      const res = await aiApi.riskAll()
      setData(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchRisk() }, [])

  const summary  = data?.summary || {}
  const students = data?.students || []
  const highRisk = students.filter(s => s.risk_level === 'High Risk')

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Risk Overview</h1>
          <p className="page-subtitle">AI-generated student risk assessment</p>
        </div>
        <button onClick={fetchRisk} className="btn-secondary">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Stable',         count: summary.stable,   color: 'text-emerald-700 bg-emerald-50', dot: 'bg-emerald-500' },
          { label: 'Moderate Risk',  count: summary.moderate, color: 'text-amber-700 bg-amber-50',     dot: 'bg-amber-500'   },
          { label: 'High Risk',      count: summary.high,     color: 'text-red-700 bg-red-50',         dot: 'bg-red-500'     },
        ].map(r => (
          <div key={r.label} className={`card p-5 ${r.color}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${r.dot}`} />
              <span className="text-sm font-semibold">{r.label}</span>
            </div>
            <p className="text-3xl font-bold">{r.count || 0}</p>
            <p className="text-xs mt-0.5 opacity-70">students</p>
          </div>
        ))}
      </div>

      {/* High risk table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <AlertTriangle size={15} className="text-red-500" />
          <h3 className="text-sm font-semibold text-slate-800">High Risk Students</h3>
        </div>
        {loading ? <LoadingSpinner /> : highRisk.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No high-risk students" description="All students are currently stable." />
        ) : (
          <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Student</th><th>Grade &amp; Section</th><th>Risk Score</th><th>Last Assessed</th></tr></thead>
            <tbody>
              {highRisk.map(s => (
                <tr key={s.student_id}>
                  <td className="font-medium">{s.full_name}</td>
                  <td className="text-slate-500">{s.grade_level} – {s.section}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-slate-100 rounded-full">
                        <div className="h-full bg-red-500 rounded-full" style={{ width: `${s.risk_score * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono font-semibold text-red-600">{(s.risk_score * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="text-xs text-slate-400">{s.assessed_at ? fmt(new Date(s.assessed_at), 'MMM d, h:mm a') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}


// ============================================================
// ANNOUNCEMENTS PAGE
// ============================================================
import { announcementApi } from '../api/client'
import { Megaphone } from 'lucide-react'

export function Announcements() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading]             = useState(true)
  const [showNew, setShowNew]             = useState(false)
  const [saving, setSaving]               = useState(false)
  const [form, setForm]                   = useState({ title: '', content: '', target_audience: 'all' })

  const fetch_ = () => {
    announcementApi.list()
      .then(res => setAnnouncements(res.data.announcements || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { fetch_() }, [])

  const handlePost = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      await announcementApi.create(form)
      toast.success('Announcement posted!')
      setShowNew(false)
      setForm({ title: '', content: '', target_audience: 'all' })
      fetch_()
    } catch {}
    setSaving(false)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">School-wide notices and updates</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowNew(true)} className="btn-primary">
            <PlusIcon size={16} /> Post Announcement
          </button>
        )}
      </div>

      {loading ? <LoadingSpinner /> : announcements.length === 0 ? (
        <div className="card">
          <EmptyState icon={Megaphone} title="No announcements yet" description="Check back later for school updates." />
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.map(a => (
            <div key={a.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
                    <Megaphone size={18} className="text-teal-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900">{a.title}</h3>
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{a.content}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-xs text-slate-400">By {a.posted_by_name}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{fmt(new Date(a.created_at), 'MMM d, yyyy')}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        a.target_audience === 'all' ? 'bg-teal-50 text-teal-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {a.target_audience === 'all' ? 'Everyone' : a.target_audience}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Post Announcement">
        <form onSubmit={handlePost} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Title *</label>
            <input className="input" placeholder="Announcement title" value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Content *</label>
            <textarea className="input min-h-28 resize-none" placeholder="Write the announcement..."
              value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Audience</label>
            <select className="input" value={form.target_audience}
              onChange={e => setForm(p => ({ ...p, target_audience: e.target.value }))}>
              <option value="all">Everyone</option>
              <option value="parents">Parents Only</option>
              <option value="teachers">Teachers Only</option>
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setShowNew(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? 'Posting...' : 'Post Announcement'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
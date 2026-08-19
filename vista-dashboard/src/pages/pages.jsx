// ============================================================
// ATTENDANCE PAGE
// ============================================================
import { formatName, nameInitial } from '../utils/nameHelper'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
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

  // Deep-link via React Router location state (set by the dashboard's
  // "Take attendance" / "Review" buttons). Re-applied on every navigation
  // so clicking a different row always updates the filters, even if the
  // Attendance component stays mounted across route visits.
  const location = useLocation()
  const initialDeepLink = location.state?.deepLink

  const [selectedSection, setSelectedSection] = useState(initialDeepLink?.selectedSection || '')
  const [students, setStudents] = useState([])
  const [records, setRecords]   = useState({})
  const [date, setDate]         = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [subjects, setSubjects]           = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const pendingDeepLinkSubject = useRef(initialDeepLink?.selectedSubject || '')
  const appliedDeepLinkTs = useRef(initialDeepLink?.ts || 0)

  // Apply a fresh deep-link when the dashboard navigates in with new state.
  // The `ts` check ensures we only apply each deep-link once, even if React
  // re-runs this effect for unrelated reasons.
  useEffect(() => {
    const dl = location.state?.deepLink
    if (!dl || dl.ts === appliedDeepLinkTs.current) return
    appliedDeepLinkTs.current = dl.ts
    setSelectedSection(dl.selectedSection || '')
    pendingDeepLinkSubject.current = dl.selectedSubject || ''
  }, [location.state])

  // Auto-select first section (skipped when a deep-link already set one)
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
        // Prefer a pending deep-link subject (from dashboard Take attendance).
        // Only applied once, then cleared so subsequent manual section changes
        // fall back to the single-subject auto-select.
        const pending = pendingDeepLinkSubject.current
        const match = pending && filtered.find(s => s.id === pending)
        if (match) {
          setSelectedSubject(match.id)
          pendingDeepLinkSubject.current = ''
        } else {
          setSelectedSubject(filtered.length === 1 ? filtered[0].id : '')
        }
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
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700">
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
import { gradesApi, scoreApi } from '../api/client'
import { resolveGradingPolicy, finalGradeFrom } from '../utils/grading'
import { BookOpen, Filter } from 'lucide-react'
import { Fragment } from 'react'
import clsx from 'clsx'

export function Grades() {
  const { user, activeAssignments } = useAuth()
  const isTeacher = user?.role === 'teacher'
  const assignments = activeAssignments || []

  // ── Tab state ──────────────────────────────────────────────
  const [activeTab, setActiveTab]           = useState('grading')

  // ── Filter state ──────────────────────────────────────────
  const [syId, setSyId]                     = useState('')
  const [schoolYears, setSchoolYears]       = useState([])
  const [selectedClass, setSelectedClass]   = useState('')
  const [subjectId, setSubjectId]           = useState('')
  const [subjects, setSubjects]             = useState([])
  const [sectionsGrouped, setSectionsGrouped] = useState({})
  const [loading, setLoading]               = useState(false)
  const [data, setData]                     = useState(null)

  // ── Class Record state ────────────────────────────────────
  const [classQuarter, setClassQuarter]     = useState(1)
  const [breakdownData, setBreakdownData]   = useState(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)

  // Derived from selectedClass for admin ("gradeLevel|||section") or teacher same pattern
  const [gradeLevel, section] = selectedClass ? selectedClass.split('|||') : ['', '']

  // ── Teacher: derive class options from assignments ────────
  const classOptions = useMemo(() => {
    if (!isTeacher) return []
    const map = new Map()
    for (const a of assignments) {
      const key = `${a.grade_level}|||${a.section}`
      if (!map.has(key)) map.set(key, { grade_level: a.grade_level, section: a.section, subjects: [] })
      const entry = map.get(key)
      if (!entry.subjects.includes(a.subject)) entry.subjects.push(a.subject)
    }
    return [...map.values()].sort((a, b) => a.grade_level.localeCompare(b.grade_level) || a.section.localeCompare(b.section))
  }, [isTeacher, assignments])

  const allowedSubjects = useMemo(() => {
    if (!isTeacher || !selectedClass) return []
    return classOptions.find(c => `${c.grade_level}|||${c.section}` === selectedClass)?.subjects || []
  }, [isTeacher, classOptions, selectedClass])

  // ── Admin: derive grade levels and sections from sectionsGrouped ──
  const adminGradeLevels = useMemo(() => Object.keys(sectionsGrouped).filter(k => sectionsGrouped[k].length > 0), [sectionsGrouped])
  const adminSections = useMemo(() => {
    if (isTeacher || !gradeLevel) return []
    return sectionsGrouped[gradeLevel] || []
  }, [isTeacher, sectionsGrouped, gradeLevel])

  // ── Load school years on mount ────────────────────────────
  useEffect(() => {
    curriculumApi.getSchoolYears().then(res => {
      const syList = res.data.school_years || res.data
      setSchoolYears(syList)
      const active = syList.find(sy => sy.is_active)
      if (active) setSyId(active.id)
    }).catch(() => {})
  }, [])

  // ── Admin: load sections grouped when SY changes ──────────
  useEffect(() => {
    if (isTeacher || !syId) return
    setSectionsGrouped({})
    setSelectedClass('')
    setSubjectId('')
    setSubjects([])
    setData(null)
    curriculumApi.getSectionsGrouped(syId).then(res => setSectionsGrouped(res.data.grouped || {})).catch(() => {})
  }, [isTeacher, syId])

  // ── Admin: load subjects when grade level changes ─────────
  useEffect(() => {
    if (isTeacher || !syId || !gradeLevel) return
    setSubjectId('')
    setSubjects([])
    setData(null)
    curriculumApi.getSubjects({ sy_id: syId, grade_level: gradeLevel }).then(res => {
      setSubjects(res.data.subjects || res.data)
    }).catch(() => {})
  }, [isTeacher, syId, gradeLevel])

  // ── Teacher: load subjects matching allowed names ─────────
  useEffect(() => {
    if (!isTeacher || !syId || !gradeLevel) return
    setSubjectId('')
    setSubjects([])
    setData(null)
    curriculumApi.getSubjects({ sy_id: syId, grade_level: gradeLevel }).then(res => {
      const all = res.data.subjects || res.data
      setSubjects(all.filter(s => allowedSubjects.includes(s.name)))
    }).catch(() => {})
  }, [isTeacher, syId, gradeLevel, allowedSubjects])

  // Reset downstream when class changes
  useEffect(() => { setSubjectId(''); setData(null) }, [selectedClass])

  // ── Resolve SY label ──────────────────────────────────────
  const selectedSY = schoolYears.find(sy => sy.id === syId)
  const syLabel = selectedSY?.label || ''

  // Period count and grading policy come from the school year itself, so an
  // archived four-quarter year and a current three-term one both render right.
  const grading = resolveGradingPolicy(selectedSY || null, gradeLevel)
  const syStatusChip = selectedSY
    ? (selectedSY.is_active
        ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">active</span>
        : selectedSY.is_upcoming
          ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">upcoming</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">archived</span>)
    : null

  // ── Fetch grading sheet data ──────────────────────────────
  const filtersReady = syId && gradeLevel && section && subjectId
  useEffect(() => {
    if (!filtersReady) { setData(null); return }
    setLoading(true)
    gradesApi.getBySubject({ subject_id: subjectId, grade_level: gradeLevel, section, school_year: syLabel })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [subjectId, gradeLevel, section, syLabel])

  // Reset the selected period when the school year's period model changes.
  useEffect(() => {
    if (!grading.periods.includes(classQuarter)) setClassQuarter(grading.periods[0])
  }, [grading.periodModel])

  // ── Fetch breakdown for Class Record tab ───────────────────
  useEffect(() => {
    if (activeTab !== 'class' || !filtersReady) { setBreakdownData(null); return }
    setBreakdownLoading(true)
    scoreApi.getBreakdown({ subject_id: subjectId, quarter: classQuarter, grade_level: gradeLevel, section })
      .then(res => setBreakdownData(res.data))
      .catch(() => setBreakdownData(null))
      .finally(() => setBreakdownLoading(false))
  }, [activeTab, classQuarter, subjectId, gradeLevel, section])

  // ── Breakdown gender groups ───────────────────────────────
  const breakdownGroups = useMemo(() => {
    if (!breakdownData?.breakdown?.length) return []
    const groups = []
    for (const g of ['Male', 'Female', 'Other']) {
      const list = breakdownData.breakdown.filter(b => (b.student.gender || 'Other') === g)
      if (list.length) groups.push({ label: g.toUpperCase(), students: list })
    }
    return groups
  }, [breakdownData])

  // Category headers from first student's breakdown
  const breakdownCategories = useMemo(() => {
    if (!breakdownData?.breakdown?.length) return []
    return breakdownData.breakdown[0].categories.map(c => ({ id: c.id, name: c.name, weight: c.weight }))
  }, [breakdownData])

  // ── Gender groups for rendering ───────────────────────────
  const genderGroups = useMemo(() => {
    if (!data?.students) return []
    const groups = []
    for (const g of ['Male', 'Female', 'Other']) {
      const list = data.students.filter(s => (s.gender || 'Other') === g)
      if (list.length) groups.push({ label: g.toUpperCase(), students: list })
    }
    return groups
  }, [data])

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">Grades</h1>
        <p className="page-subtitle">View academic performance records</p>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={15} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* School Year */}
          {isTeacher ? (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1.5">
                School Year {syStatusChip}
              </label>
              <div className="input bg-slate-50 text-slate-500 cursor-default">SY {syLabel || '—'}</div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1.5">
                School Year {syStatusChip}
              </label>
              <select className="input" value={syId} onChange={e => setSyId(e.target.value)}>
                <option value="">— Select —</option>
                {schoolYears.map(sy => <option key={sy.id} value={sy.id}>{sy.label}</option>)}
              </select>
            </div>
          )}

          {/* Class (teacher) OR Grade Level + Section (admin) */}
          {isTeacher ? (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Class</label>
              <select className="input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
                <option value="">— Select —</option>
                {classOptions.map(c => (
                  <option key={`${c.grade_level}|||${c.section}`} value={`${c.grade_level}|||${c.section}`}>
                    {c.grade_level} - {c.section}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Grade Level</label>
                <select className="input" value={gradeLevel} onChange={e => setSelectedClass(e.target.value ? `${e.target.value}|||` : '')}>
                  <option value="">— Select —</option>
                  {adminGradeLevels.map(gl => <option key={gl} value={gl}>{gl}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Section</label>
                <select className="input" value={section} onChange={e => setSelectedClass(gradeLevel ? `${gradeLevel}|||${e.target.value}` : '')} disabled={!gradeLevel}>
                  <option value="">— Select —</option>
                  {adminSections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
            <select className="input" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={!gradeLevel || !section}>
              <option value="">— Select —</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────── */}
      {loading ? <LoadingSpinner /> : data ? (
        <div className="card overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-slate-200">
            {[{ key: 'grading', label: 'Grading Sheet' }, { key: 'class', label: 'Grade Summary' }].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={clsx('px-5 py-3 text-sm font-medium transition-colors relative',
                  activeTab === tab.key
                    ? 'text-brand-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500'
                    : 'text-slate-400 hover:text-slate-600'
                )}>
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'grading' ? (
            <>
              {/* Sheet header */}
              <div className="px-5 pt-4 pb-3 border-b border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-y-2 text-[11px] text-slate-500 uppercase tracking-wider">
                  <span><span className="font-semibold">Learning Area:</span> <span className="normal-case text-slate-700 text-xs font-medium">{data.subject_name}</span></span>
                  <span><span className="font-semibold">Grade & Section:</span> <span className="normal-case text-slate-700 text-xs font-medium">{gradeLevel} - {section}</span></span>
                  <span><span className="font-semibold">Subject Teacher:</span> <span className="normal-case text-slate-700 text-xs font-medium">{data.teacher_name || '—'}</span></span>
                </div>
              </div>

              {data.students.length === 0 ? (
                <EmptyState icon={BookOpen} title="No students enrolled" description="No students found in this class." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="whitespace-nowrap w-10 text-center">#</th>
                        <th className="whitespace-nowrap">Name of Students</th>
                        {grading.ordinals.map(o => (
                          <th key={o} className="whitespace-nowrap text-center">{o}</th>
                        ))}
                        <th className="whitespace-nowrap text-center">AVE</th>
                        <th className="whitespace-nowrap text-center">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {genderGroups.map(group => (
                        <Fragment key={group.label}>
                          <tr>
                            <td colSpan={grading.periodCount + 4} className="bg-slate-50 px-5 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-y border-slate-200">
                              {group.label}
                            </td>
                          </tr>
                          {group.students.map((student, idx) => {
                            const sg = data.grades[student.id] || {}
                            const quarters = grading.periods.map(q => sg[q]?.grade != null ? Number(sg[q].grade) : null)
                            const avg = finalGradeFrom(quarters)
                            const passed = avg !== null && avg >= grading.passingGrade
                            return (
                              <tr key={student.id} className="hover:bg-slate-50/60">
                                <td className="text-xs text-slate-400 text-center">{idx + 1}</td>
                                <td className="font-medium text-sm whitespace-nowrap">{formatName(student)}</td>
                                {quarters.map((g, qi) => (
                                  <td key={qi} className="text-left font-mono text-sm" style={{ color: g !== null && g < 75 ? '#ef4444' : g !== null ? '#0d9488' : '#cbd5e1' }}>
                                    {g !== null ? <span className={g < 75 ? 'font-semibold' : ''}>{g}</span> : '—'}
                                  </td>
                                ))}
                                <td className="text-left font-mono text-sm font-bold" style={{ color: avg !== null && avg < 75 ? '#ef4444' : avg !== null ? '#0d9488' : '#cbd5e1' }}>
                                  {avg !== null ? avg : '—'}
                                </td>
                                <td className="text-left">
                                  {avg !== null ? (
                                    <span className={clsx('inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
                                      passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                                    )}>
                                      {passed ? 'PASSED' : 'FAILED'}
                                    </span>
                                  ) : <span className="text-slate-300 text-xs">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Quarter selector */}
              <div className="px-5 pt-4 pb-3 border-b border-slate-200 flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 mr-1">{grading.periodNoun}:</span>
                {grading.periods.map(q => (
                  <button key={q} onClick={() => setClassQuarter(q)}
                    className={clsx('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      classQuarter === q
                        ? 'bg-brand-500 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    )}>
                    Q{q}
                  </button>
                ))}
              </div>

              {breakdownLoading ? <div className="py-8"><LoadingSpinner /></div> : breakdownGroups.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="whitespace-nowrap w-10 text-center">#</th>
                        <th className="whitespace-nowrap">Name of Students</th>
                        {breakdownCategories.map(cat => (
                          <th key={cat.id} className="text-center">
                            <div className="whitespace-nowrap text-center">{cat.name}</div>
                            <div className="font-normal text-slate-400 text-center">({cat.weight}%)</div>
                          </th>
                        ))}
                        <th className="whitespace-nowrap text-center">Initial</th>
                        <th className="whitespace-nowrap text-center">Final</th>
                        <th className="whitespace-nowrap text-center">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownGroups.map(group => (
                        <Fragment key={group.label}>
                          <tr>
                            <td colSpan={breakdownCategories.length + 5} className="bg-slate-50 px-5 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-y border-slate-200">
                              {group.label}
                            </td>
                          </tr>
                          {group.students.map((entry, idx) => {
                            const fg = entry.final_grade != null ? Number(entry.final_grade) : null
                            const passed = fg !== null && fg >= 75
                            return (
                              <tr key={entry.student.id} className="hover:bg-slate-50/60">
                                <td className="text-xs text-slate-400 text-center">{idx + 1}</td>
                                <td className="font-medium text-sm whitespace-nowrap">{formatName(entry.student)}</td>
                                {entry.categories.map(cat => (
                                  <td key={cat.id} className="text-center font-mono text-sm" style={{ color: cat.ws > 0 ? '#334155' : '#cbd5e1' }}>
                                    {cat.ws != null ? Number(cat.ws).toFixed(2) : '—'}
                                  </td>
                                ))}
                                <td className="text-center font-mono text-sm" style={{ color: entry.initial_grade > 0 ? '#334155' : '#cbd5e1' }}>
                                  {entry.initial_grade != null ? Number(entry.initial_grade).toFixed(2) : '—'}
                                </td>
                                <td className="text-center font-mono text-sm font-bold" style={{ color: fg !== null && fg < 75 ? '#ef4444' : fg !== null ? '#0d9488' : '#cbd5e1' }}>
                                  {fg !== null ? fg : '—'}
                                </td>
                                <td className="text-center">
                                  {fg !== null ? (
                                    <span className={clsx('inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
                                      passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                                    )}>
                                      {passed ? 'PASSED' : 'FAILED'}
                                    </span>
                                  ) : <span className="text-slate-300 text-xs">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-8">
                  <EmptyState icon={BookOpen} title="No scores recorded" description="No score data found for this quarter." />
                </div>
              )}
            </>
          )}
        </div>
      ) : !loading && (
        <div className="card">
          <EmptyState icon={BookOpen} title="Select filters" description="Choose school year, class, and subject to view the grading sheet." />
        </div>
      )}
    </div>
  )
}


// ============================================================
// BEHAVIOR PAGE
// ============================================================
import { behaviorApi, aiApi } from '../api/client'
import { SentimentBadge, Modal, StatCard } from '../components/UI'
import { Heart, Plus as PlusIcon, Pencil, Trash2, Smile, Meh, Frown, X as XIcon } from 'lucide-react'
import { Link as RouterLink } from 'react-router-dom'

export function Behavior() {
  const { user } = useAuth()
  return user?.role === 'teacher' ? <TeacherBehavior /> : <AdminBehavior />
}

// ─── Teacher view — class-scoped logging ─────────────────────
function TeacherBehavior() {
  const { activeAssignments } = useAuth()

  const sections = useMemo(() => {
    const map = new Map()
    for (const a of activeAssignments || []) {
      const key = `${a.grade_level}|||${a.section}`
      if (!map.has(key)) map.set(key, { grade_level: a.grade_level, section: a.section })
    }
    return [...map.values()].sort(
      (a, b) => a.grade_level.localeCompare(b.grade_level) || a.section.localeCompare(b.section)
    )
  }, [activeAssignments])

  const [selectedSection, setSelectedSection] = useState('')
  const [studentId, setStudentIdB]= useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [studentResults, setStudentResults] = useState([])
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [showLog, setShowLog]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm]           = useState({ observation: '', category: 'Social', observed_at: '' })
  const [aiResult, setAiResult]   = useState(null)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    if (sections.length > 0 && !selectedSection) {
      setSelectedSection(`${sections[0].grade_level}|||${sections[0].section}`)
    }
  }, [sections])

  useEffect(() => {
    setStudentIdB('')
    setStudentSearch('')
    setStudentResults([])
    setLogs([])
  }, [selectedSection])

  useEffect(() => {
    const handle = setTimeout(() => {
      const q = studentSearch.trim()
      if (!q || studentId) return setStudentResults([])
      if (!selectedSection) return setStudentResults([])
      const [grade_level, section] = selectedSection.split('|||')
      studentApi.list({ grade_level, section, search: q, limit: 20 })
        .then(res => setStudentResults(res.data.students || []))
        .catch(() => setStudentResults([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [studentSearch, studentId, selectedSection])

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
          <p className="page-subtitle">Log observations for students in your classes</p>
        </div>
        {studentId && (
          <button onClick={() => setShowLog(true)} className="btn-primary">
            <PlusIcon size={16} /> Log Observation
          </button>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="card">
          <EmptyState icon={Heart} title="No assigned classes"
            description="You have no teaching assignments for the active school year." />
        </div>
      ) : (
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Class</label>
            <select className="input" value={selectedSection}
              onChange={e => setSelectedSection(e.target.value)}>
              {sections.map(s => (
                <option key={`${s.grade_level}|||${s.section}`} value={`${s.grade_level}|||${s.section}`}>
                  {s.grade_level} — {s.section}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Student</label>
            <input className="input" placeholder="Search by name or LRN…"
              value={studentSearch}
              onChange={e => {
                setStudentSearch(e.target.value)
                if (studentId) { setStudentIdB(''); setLogs([]) }
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            {studentResults.length > 0 && !studentId && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                {studentResults.map(s => (
                  <button key={s.id} type="button"
                    onClick={() => {
                      setStudentResults([])
                      setStudentSearch(formatName(s))
                      fetchLogs(s.id)
                    }}
                    className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50">
                    <span className="font-medium text-slate-700">{formatName(s)}</span>
                    {s.lrn && <span className="text-slate-400"> · LRN {s.lrn}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? <LoadingSpinner /> : logs.length > 0 ? (
        <div className="space-y-3">
          {logs.map(b => (
            <div key={b.id} className="card p-4 flex gap-4">
              <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 flex-shrink-0">
                <Pencil size={14}/>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-800">Logged by you</p>
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
            <button type="button" onClick={previewSentiment} className="mt-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium">
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

// ─── Admin view — school-wide read-only browser ──────────────
const EMPTY_BEHAVIOR_FILTERS = {
  student_id: '', grade_level: '', section: '', category: '', sentiment: '',
}
const BEHAVIOR_PAGE_SIZE = 50

function AdminBehavior() {
  const [filters, setFilters] = useState(EMPTY_BEHAVIOR_FILTERS)
  const [offset, setOffset]   = useState(0)
  const [logs, setLogs]       = useState([])
  const [total, setTotal]     = useState(0)
  const [summary, setSummary] = useState({ total: 0, positive: 0, neutral: 0, negative: 0 })
  const [loading, setLoading] = useState(false)
  const [studentResults, setStudentResults] = useState([])
  const [sections, setSections] = useState([])
  const [studentSearch, setStudentSearch] = useState('')
  const [detailLog, setDetailLog] = useState(null)

  useEffect(() => {
    curriculumApi.getSections()
      .then(res => setSections(res.data.sections || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => {
      const q = studentSearch.trim()
      if (!q || filters.student_id) return setStudentResults([])
      studentApi.list({ search: q, limit: 20 })
        .then(res => setStudentResults(res.data.students || []))
        .catch(() => setStudentResults([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [studentSearch, filters.student_id])

  const cleanParams = useMemo(() => {
    const out = {}
    for (const [k, v] of Object.entries(filters)) if (v) out[k] = v
    return out
  }, [filters])

  useEffect(() => { setOffset(0) }, [cleanParams])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      behaviorApi.get({ ...cleanParams, limit: BEHAVIOR_PAGE_SIZE, offset }),
      behaviorApi.summary(cleanParams),
    ]).then(([listRes, sumRes]) => {
      if (cancelled) return
      setLogs(listRes.data.logs || [])
      setTotal(listRes.data.total || 0)
      setSummary(sumRes.data || {})
    }).catch(() => {
      if (!cancelled) { setLogs([]); setTotal(0) }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cleanParams, offset])

  const patch = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const clearFilters = () => {
    setFilters(EMPTY_BEHAVIOR_FILTERS)
    setStudentSearch('')
    setStudentResults([])
  }
  const page = Math.floor(offset / BEHAVIOR_PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / BEHAVIOR_PAGE_SIZE))

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">Behavior Monitoring</h1>
        <p className="page-subtitle">School-wide observation logs — read-only oversight</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total logs" value={summary.total    ?? 0} icon={Heart} color="brand" />
        <StatCard title="Positive"   value={summary.positive ?? 0} icon={Smile} color="emerald" />
        <StatCard title="Neutral"    value={summary.neutral  ?? 0} icon={Meh}   color="blue" />
        <StatCard title="Negative"   value={summary.negative ?? 0} icon={Frown} color="red" />
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Filters</h3>
          <button onClick={clearFilters}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <XIcon size={12}/> Clear
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Student</label>
            <input className="input" placeholder="Search by name or LRN…"
              value={studentSearch}
              onChange={e => {
                setStudentSearch(e.target.value)
                if (filters.student_id) {
                  setFilters(f => ({ ...f, student_id: '', grade_level: '', section: '' }))
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            {studentResults.length > 0 && !filters.student_id && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                {studentResults.map(s => (
                  <button key={s.id} type="button"
                    onClick={() => {
                      setFilters(f => ({
                        ...f,
                        student_id: s.id,
                        grade_level: s.grade_level || '',
                        section: s.section || '',
                      }))
                      setStudentSearch(formatName(s))
                      setStudentResults([])
                    }}
                    className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50">
                    <span className="font-medium text-slate-700">{formatName(s)}</span>
                    {s.lrn && <span className="text-slate-400"> · LRN {s.lrn}</span>}
                    <span className="text-slate-400"> — {s.grade_level} {s.section}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
            <select className="input disabled:bg-slate-50 disabled:cursor-not-allowed"
              disabled={!!filters.student_id}
              value={filters.grade_level && filters.section ? `${filters.grade_level}|||${filters.section}` : ''}
              onChange={e => {
                const v = e.target.value
                if (!v) { patch('grade_level', ''); patch('section', ''); return }
                const [gl, sec] = v.split('|||')
                setFilters(f => ({ ...f, grade_level: gl, section: sec }))
              }}>
              <option value="">All classes</option>
              {sections.map(s => (
                <option key={s.id} value={`${s.grade_level}|||${s.name}`}>
                  {s.grade_level} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <select className="input" value={filters.category} onChange={e => patch('category', e.target.value)}>
              <option value="">All categories</option>
              <option>Social</option><option>Emotional</option><option>Academic</option><option>Physical</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sentiment</label>
            <select className="input" value={filters.sentiment} onChange={e => patch('sentiment', e.target.value)}>
              <option value="">All</option>
              <option>Positive</option><option>Neutral</option><option>Negative</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? <LoadingSpinner /> : logs.length === 0 ? (
          <EmptyState icon={Heart} title="No behavior logs"
            description="No logs match the current filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">Student</th>
                  <th className="whitespace-nowrap">Class</th>
                  <th className="whitespace-nowrap">Category</th>
                  <th className="whitespace-nowrap">Sentiment</th>
                  <th className="whitespace-nowrap">Teacher</th>
                  <th className="whitespace-nowrap text-center">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(b => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap">
                      <RouterLink to={`/students/${b.student_id}`}
                        className="text-brand-600 hover:text-brand-700 font-medium">
                        {formatName(b)}
                      </RouterLink>
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{b.grade_level} — {b.section}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{b.category}</td>
                    <td className="whitespace-nowrap"><SentimentBadge sentiment={b.sentiment} /></td>
                    <td className="whitespace-nowrap text-sm text-slate-600">{b.teacher_name}</td>
                    <td className="whitespace-nowrap text-left">
                      <button onClick={() => setDetailLog(b)}
                        className="btn-secondary px-3 py-1 text-xs">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > BEHAVIOR_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {page} of {pageCount} · {total} logs</span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - BEHAVIOR_PAGE_SIZE))}>Prev</button>
            <button className="btn-secondary" disabled={offset + BEHAVIOR_PAGE_SIZE >= total}
              onClick={() => setOffset(offset + BEHAVIOR_PAGE_SIZE)}>Next</button>
          </div>
        </div>
      )}

      <Modal open={!!detailLog} onClose={() => setDetailLog(null)} title="Behavior Observation">
        {detailLog && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-500">Student</p>
                <RouterLink to={`/students/${detailLog.student_id}`}
                  className="text-brand-600 hover:text-brand-700 font-medium">
                  {formatName(detailLog)}
                </RouterLink>
                <p className="text-xs text-slate-400">{detailLog.grade_level} — {detailLog.section}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Teacher</p>
                <p className="text-slate-700">{detailLog.teacher_name}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Date &amp; Time</p>
                <p className="text-slate-700">{format(new Date(detailLog.observed_at), 'MMM d, yyyy · h:mm a')}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Subject</p>
                <p className="text-slate-700">{detailLog.subject || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Category</p>
                <p className="text-slate-700">{detailLog.category}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Sentiment</p>
                <div className="flex items-center gap-2">
                  <SentimentBadge sentiment={detailLog.sentiment} />
                  {detailLog.sentiment_score != null && (
                    <span className="text-xs text-slate-500">
                      Score: <span className="font-mono font-semibold">{Number(detailLog.sentiment_score).toFixed(3)}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Observation</p>
              <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-700 whitespace-pre-wrap">
                {detailLog.observation}
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setDetailLog(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}


// ============================================================
// SECUREPASS QR PAGE
// ============================================================
import { dismissalApi } from '../api/client'
import { Clock } from 'lucide-react'
import { format as fmt } from 'date-fns'

export function SecurePass() {
  const [logs, setLogs]         = useState([])
  const [loading, setLoading]   = useState(true)

  const loadLogs = () => {
    setLoading(true)
    dismissalApi.logs(format(new Date(), 'yyyy-MM-dd'))
      .then(res => setLogs(res.data.logs || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadLogs() }, [])

  // Daily counts
  const successCount = logs.filter(l => l.status === 'Success').length
  const failedCount = logs.filter(l => l.status === 'Failed' || l.status === 'Expired').length

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">SecurePass Oversight</h1>
        <p className="page-subtitle">Monitor today's dismissal activity</p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-slate-400">Dismissed today</p>
          <p className="text-2xl font-bold text-brand-600 mt-1">{successCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400">Failed / Expired</p>
          <p className={`text-2xl font-bold mt-1 ${failedCount > 0 ? 'text-amber-600' : 'text-slate-700'}`}>{failedCount}</p>
        </div>
        <div className="card p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-400">Total scans</p>
          <p className="text-2xl font-bold text-slate-700 mt-1">{logs.length}</p>
        </div>
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
  )
}


// ============================================================
// RISK OVERVIEW PAGE
// ============================================================
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

const RISK_FILTERS = [
  { key: 'all',      label: 'All',           match: () => true },
  { key: 'high',     label: 'High Risk',     match: s => s.risk_level === 'High Risk'     },
  { key: 'moderate', label: 'Moderate Risk', match: s => s.risk_level === 'Moderate Risk' },
  { key: 'stable',   label: 'Stable',        match: s => s.risk_level === 'Stable'        },
]

const FACTOR_LABELS = {
  attendance: 'Attendance',
  academic:   'Academic',
  behavioral: 'Behavioral',
  competency: 'ECE Competency',
}

const CLASS_FILTERS = [
  { key: 'all',          label: 'All',             match: () => true },
  { key: 'urgent',       label: 'Urgent',          match: s => s.overall_band === 'urgent' },
  { key: 'watch',        label: 'Watch',           match: s => s.overall_band === 'watch' },
  { key: 'ok',           label: 'On track',        match: s => s.overall_band === 'ok' },
  { key: 'insufficient', label: 'Not enough data', match: s => s.overall_band === 'insufficient' },
]

const BAND_STYLES = {
  urgent:       { pill: 'bg-red-50 text-red-700',         dot: 'bg-red-500',     label: 'Urgent' },
  watch:        { pill: 'bg-amber-50 text-amber-700',     dot: 'bg-amber-500',   label: 'Watch' },
  ok:           { pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', label: 'On track' },
  insufficient: { pill: 'bg-slate-50 text-slate-500',     dot: 'bg-slate-400',   label: 'Not enough data' },
}

const TOP_CONCERN_LABELS = {
  academic:   'Academic',
  competency: 'Competency',
  attendance: 'Attendance',
  behavior:   'Behavior',
}

function riskRowColor(level) {
  if (level === 'High Risk')     return { bar: 'bg-red-500',     text: 'text-red-600'    }
  if (level === 'Moderate Risk') return { bar: 'bg-amber-500',   text: 'text-amber-600'  }
  return                                { bar: 'bg-emerald-500', text: 'text-emerald-600' }
}

function TeacherRiskOverview({ data, loading, filter, setFilter, onRefresh }) {
  const summary  = data?.summary || { total: 0, ok: 0, watch: 0, urgent: 0, insufficient: 0 }
  const students = data?.students || []

  const activeFilter = CLASS_FILTERS.find(f => f.key === filter) || CLASS_FILTERS[0]
  const visible = students.filter(activeFilter.match)

  const renderChip = (band, text) => {
    const style = BAND_STYLES[band] || BAND_STYLES.insufficient
    return (
      <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold', style.pill)}>
        {band === 'insufficient' ? '—' : text}
      </span>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Risk Overview</h1>
          <p className="page-subtitle">
            Computed from your subjects, your attendance sessions, and your behavior logs
          </p>
        </div>
        <button onClick={onRefresh} className="btn-secondary">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { key: 'urgent',       label: 'Urgent',          color: 'text-red-700 bg-red-50',         dot: 'bg-red-500'     },
          { key: 'watch',        label: 'Watch',           color: 'text-amber-700 bg-amber-50',     dot: 'bg-amber-500'   },
          { key: 'ok',           label: 'On track',        color: 'text-emerald-700 bg-emerald-50', dot: 'bg-emerald-500' },
          { key: 'insufficient', label: 'Not enough data', color: 'text-slate-600 bg-slate-50',     dot: 'bg-slate-400'   },
        ].map(r => (
          <div key={r.key} className={`card p-5 ${r.color}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${r.dot}`} />
              <span className="text-sm font-semibold">{r.label}</span>
            </div>
            <p className="text-3xl font-bold">{summary[r.key] || 0}</p>
            <p className="text-xs mt-0.5 opacity-70">students</p>
          </div>
        ))}
      </div>

      {/* Students table with filter tabs */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            <h3 className="text-sm font-semibold text-slate-800">Students</h3>
            <span className="text-xs text-slate-400">({visible.length})</span>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
            {CLASS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  filter === f.key
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {loading ? <LoadingSpinner /> : visible.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={
              students.length === 0
                ? 'No students in your classes yet'
                : 'No students in this category'
            }
            description={
              students.length === 0
                ? 'Once students are assigned to your classes and you record scores, attendance, or behavior logs, their class band will appear here.'
                : 'Try a different filter above.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                <th>Grade &amp; Section</th>
                <th>Class Band</th>
                <th>Top Concern</th>
                <th>Academic / Competency</th>
                <th>Attendance</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => {
                const bandStyle = BAND_STYLES[s.overall_band] || BAND_STYLES.insufficient
                const ac = s.metrics.academic
                const cp = s.metrics.competency
                const at = s.metrics.attendance
                const bh = s.metrics.behavior
                const sentimentText = bh.avg_sentiment !== null
                  ? (bh.avg_sentiment >= 0 ? `+${bh.avg_sentiment.toFixed(2)}` : bh.avg_sentiment.toFixed(2))
                  : '—'
                // ECE learners get a competency chip here instead of academic —
                // the server leaves ac.band = 'insufficient' for ECE rows.
                const primary = s.is_ece && cp
                  ? { band: cp.band, text: cp.total_skills > 0 ? `${Math.round(cp.completion * 100)}%` : '—' }
                  : { band: ac.band, text: ac.avg_grade !== null ? ac.avg_grade.toFixed(1) : '—' }
                return (
                  <tr
                    key={s.student_id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => { window.location.href = `/students/${s.student_id}` }}
                  >
                    <td className="font-medium">
                      <Link
                        to={`/students/${s.student_id}`}
                        className="text-slate-800 hover:text-brand-600"
                        onClick={e => e.stopPropagation()}
                      >
                        {s.full_name}
                      </Link>
                    </td>
                    <td className="text-slate-500">{s.grade_level} – {s.section}</td>
                    <td>
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                        bandStyle.pill
                      )}>
                        <span className={clsx('w-1.5 h-1.5 rounded-full', bandStyle.dot)} />
                        {bandStyle.label}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">
                      {s.top_concern
                        ? TOP_CONCERN_LABELS[s.top_concern]
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td>{renderChip(primary.band, primary.text)}</td>
                    <td>{renderChip(at.band, at.rate !== null ? `${Math.round(at.rate * 100)}%` : '—')}</td>
                    <td>{renderChip(bh.band, sentimentText)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

export function RiskOverview() {
  const { user } = useAuth()
  const isTeacher = user?.role === 'teacher'

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')

  const fetchRisk = async () => {
    setLoading(true)
    try {
      const res = isTeacher ? await aiApi.classHealthAll() : await aiApi.riskAll()
      setData(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchRisk() }, [isTeacher])

  if (isTeacher) {
    return <TeacherRiskOverview data={data} loading={loading} filter={filter} setFilter={setFilter} onRefresh={fetchRisk} />
  }

  const summary  = data?.summary || {}
  const students = data?.students || []

  const activeFilter = RISK_FILTERS.find(f => f.key === filter) || RISK_FILTERS[0]
  const visible = students
    .filter(activeFilter.match)
    .slice()
    .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Risk Overview</h1>
          <p className="page-subtitle">
            {isTeacher
              ? 'AI risk assessment for students in your assigned classes'
              : 'AI-generated student risk assessment'}
          </p>
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

      {/* Students table with filter tabs */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            <h3 className="text-sm font-semibold text-slate-800">Students</h3>
            <span className="text-xs text-slate-400">({visible.length})</span>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {RISK_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  filter === f.key
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {loading ? <LoadingSpinner /> : visible.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={
              students.length === 0
                ? (isTeacher ? 'No risk data for your classes' : 'No risk assessments yet')
                : `No students in this category`
            }
            description={
              students.length === 0
                ? (isTeacher
                    ? 'Once risk assessments run for students in your sections, they will appear here.'
                    : 'Run risk assessments to populate this page.')
                : 'Try a different filter above.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                <th>Grade &amp; Section</th>
                <th>Risk Level</th>
                <th>Risk Score</th>
                <th>Top Factor</th>
                <th>Last Assessed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => {
                const c = riskRowColor(s.risk_level)
                return (
                  <tr
                    key={s.student_id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => { window.location.href = `/students/${s.student_id}` }}
                  >
                    <td className="font-medium">
                      <Link
                        to={`/students/${s.student_id}`}
                        className="text-slate-800 hover:text-brand-600"
                        onClick={e => e.stopPropagation()}
                      >
                        {s.full_name}
                      </Link>
                    </td>
                    <td className="text-slate-500">{s.grade_level} – {s.section}</td>
                    <td>
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                        s.risk_level === 'High Risk'     && 'bg-red-50 text-red-700',
                        s.risk_level === 'Moderate Risk' && 'bg-amber-50 text-amber-700',
                        s.risk_level === 'Stable'        && 'bg-emerald-50 text-emerald-700',
                      )}>
                        <span className={clsx('w-1.5 h-1.5 rounded-full', c.bar)} />
                        {s.risk_level}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-100 rounded-full">
                          <div className={clsx('h-full rounded-full', c.bar)} style={{ width: `${(s.risk_score || 0) * 100}%` }} />
                        </div>
                        <span className={clsx('text-xs font-mono font-semibold', c.text)}>
                          {((s.risk_score || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="text-xs text-slate-500">
                      {s.top_factor ? FACTOR_LABELS[s.top_factor] : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-xs text-slate-400">{s.assessed_at ? fmt(new Date(s.assessed_at), 'MMM d, h:mm a') : '—'}</td>
                  </tr>
                )
              })}
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
  const { user, isAnyAdmin } = useAuth()
  const isAdmin = isAnyAdmin
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading]             = useState(true)
  const [showNew, setShowNew]             = useState(false)
  const [saving, setSaving]               = useState(false)
  const [editing, setEditing]             = useState(null) // announcement being edited, or null for new
  const [form, setForm]                   = useState({ title: '', content: '', target_audience: 'all' })
  const [deleting, setDeleting]           = useState(null) // announcement pending delete
  const [scope, setScope]                 = useState('all') // 'all' | 'mine'

  const fetch_ = () => {
    announcementApi.list()
      .then(res => setAnnouncements(res.data.announcements || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { fetch_() }, [])

  const openNew = () => {
    setEditing(null)
    setForm({ title: '', content: '', target_audience: 'all' })
    setShowNew(true)
  }

  const openEdit = (a) => {
    setEditing(a)
    setForm({ title: a.title, content: a.content, target_audience: a.target_audience || 'all' })
    setShowNew(true)
  }

  const handlePost = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await announcementApi.update(editing.id, form)
        toast.success('Announcement updated!')
      } else {
        await announcementApi.create(form)
        toast.success('Announcement posted!')
      }
      setShowNew(false)
      setEditing(null)
      setForm({ title: '', content: '', target_audience: 'all' })
      fetch_()
    } catch {}
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!deleting) return
    setSaving(true)
    try {
      await announcementApi.remove(deleting.id)
      toast.success('Announcement deleted.')
      setDeleting(null)
      fetch_()
    } catch {}
    setSaving(false)
  }

  const visible = scope === 'mine'
    ? announcements.filter(a => a.posted_by === user?.id)
    : announcements

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">School-wide notices and updates</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                onClick={() => setScope('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  scope === 'all' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setScope('mine')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  scope === 'mine' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                My Posts
              </button>
            </div>
          )}
          {isAdmin && (
            <button onClick={openNew} className="btn-primary">
              <PlusIcon size={16} /> Post Announcement
            </button>
          )}
        </div>
      </div>

      {loading ? <LoadingSpinner /> : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Megaphone}
            title={scope === 'mine' ? "You haven't posted anything yet" : 'No announcements yet'}
            description={scope === 'mine' ? 'Posts you create will appear here.' : 'Check back later for school updates.'}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(a => {
            const canManage = a.posted_by === user?.id
            return (
            <div key={a.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                    <Megaphone size={18} className="text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900">{a.title}</h3>
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap">{a.content}</p>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <span className="text-xs text-slate-400">By {a.posted_by_name}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{fmt(new Date(a.created_at), 'MMM d, yyyy')}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        a.target_audience === 'all'    ? 'bg-brand-50 text-brand-700'
                        : a.target_audience === 'admins' ? 'bg-amber-50 text-amber-700'
                        :                                  'bg-blue-50 text-blue-700'
                      }`}>
                        {a.target_audience === 'all'    ? 'Everyone'
                        : a.target_audience === 'admins' ? 'Admins Only'
                        : a.target_audience === 'parents' ? 'Parents Only'
                        : a.target_audience === 'teachers' ? 'Teachers Only'
                        : a.target_audience}
                      </span>
                    </div>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(a)}
                      className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50"
                      title="Edit announcement"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleting(a)}
                      className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"
                      title="Delete announcement"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )})}
        </div>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); setEditing(null) }} title={editing ? 'Edit Announcement' : 'Post Announcement'}>
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
              <option value="admins">Admins Only</option>
              <option value="parents">Parents Only</option>
              <option value="teachers">Teachers Only</option>
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setShowNew(false); setEditing(null) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? (editing ? 'Saving...' : 'Posting...') : (editing ? 'Save Changes' : 'Post Announcement')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete announcement?" size="sm">
        <p className="text-sm text-slate-600">
          This will remove "{deleting?.title}" from the list. This action cannot be undone.
        </p>
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => setDeleting(null)} className="btn-secondary flex-1">Cancel</button>
          <button type="button" onClick={handleDelete} disabled={saving}
            className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700">
            {saving ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
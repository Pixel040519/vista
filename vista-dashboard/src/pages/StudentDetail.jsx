import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, ClipboardCheck, Heart, Brain, TrendingUp, TrendingDown, MapPin, ChevronDown, ChevronRight, Pencil, Baby, Lock, Unlock, CalendarDays, Archive, ArchiveRestore, GraduationCap } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { studentApi, gradesApi, attendanceApi, behaviorApi, aiApi, eceApi, curriculumApi, enrollmentApi } from '../api/client'
import { resolveGradingPolicy } from '../utils/grading'
import { RiskBadge, SentimentBadge, LoadingSpinner, GradeChip } from '../components/UI'
import { format } from 'date-fns'
import { formatName, nameInitial } from '../utils/nameHelper'
import { statusLabel, statusClasses } from '../utils/enrollment'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

const calcAge = (dob) => {
  if (!dob) return null
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

const TABS = ['Overview', 'Grades', 'Attendance', 'Behavior', 'AI Insights']

const ECE_GRADES = ['Kinder']
const ECE_RATINGS = [
  { value: 'E',  label: 'Excellent',        color: 'bg-emerald-500 text-white border-emerald-600' },
  { value: 'G',  label: 'Good',             color: 'bg-brand-500 text-white border-brand-600' },
  { value: 'F',  label: 'Fair',             color: 'bg-amber-500 text-white border-amber-600' },
  { value: 'NA', label: 'Needs Assistance', color: 'bg-red-500 text-white border-red-600' },
]
const ECE_RATING_BY_VALUE = Object.fromEntries(ECE_RATINGS.map(r => [r.value, r]))

// Attendance records whose school year the backfill could not resolve — no
// subject to derive it from and no sibling row that had one.
const UNASSIGNED_SY = 'No school year recorded'

// Present / Late / Excused / Absent tallies, shown on both the school year and
// the month header so a year can be read without opening it.
function AttendanceCounts({ summary }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">P {summary.Present || 0}</span>
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">L {summary.Late || 0}</span>
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">E {summary.Excused || 0}</span>
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">A {summary.Absent || 0}</span>
    </div>
  )
}

export default function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAnyAdmin, advisory } = useAuth()
  const isTeacher = user?.role === 'teacher'
  const [student, setStudent]   = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [grades, setGrades]     = useState([])
  const [attendance, setAttendance] = useState([])
  const [behavior, setBehavior] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [risk, setRisk]         = useState(null)
  const [classHealth, setClassHealth] = useState(null)
  const [classHealthError, setClassHealthError] = useState(null)
  const [eceHealth, setEceHealth] = useState(null)
  const [eceHealthError, setEceHealthError] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('Overview')
  const [expandedSYs, setExpandedSYs] = useState(() => new Set())
  const [expandedAttSYs, setExpandedAttSYs] = useState(() => new Set())
  const [expandedAttMonths, setExpandedAttMonths] = useState(() => new Set())
  const [expandedBehSYs, setExpandedBehSYs] = useState(() => new Set())
  const [expandedBehMonths, setExpandedBehMonths] = useState(() => new Set())
  const [behaviorFilter, setBehaviorFilter] = useState('All')

  // ECE competency (Kinder) — replaces the numeric grades view
  // for ECE learners and feeds the AI Insights tab so ECE teachers see
  // competency-aware signals instead of grade-based ones.
  const [eceSkills, setEceSkills]       = useState([])
  const [eceSubjects, setEceSubjects]   = useState([])
  const [eceRecords, setEceRecords]     = useState([])   // records for selected quarter + this student
  const [eceSchoolYear, setEceSchoolYear] = useState(null)
  const [eceQuarter, setEceQuarter]     = useState(1)
  const [schoolYears, setSchoolYears]   = useState([])
  const [eceLoading, setEceLoading]     = useState(false)
  const [eceAccessError, setEceAccessError] = useState(null)
  const [expandedEceSY, setExpandedEceSY] = useState(true)
  const [expandedEceSubjects, setExpandedEceSubjects] = useState(() => new Set())
  const [expandedEceInsightsOk, setExpandedEceInsightsOk] = useState(false)
  const [expandedEceInsightsInsufficient, setExpandedEceInsightsInsufficient] = useState(false)

  // The Academics tab renders one table per school year and each year can use a
  // different grading model, so resolve the policy per year rather than globally.
  useEffect(() => {
    curriculumApi.getSchoolYears()
      .then(res => setSchoolYears(res.data.school_years || res.data || []))
      .catch(() => setSchoolYears([]))
  }, [])

  // Year-by-year enrolment. Admin-only: the endpoint is admin-scoped, and a
  // teacher has no business reading a learner's placement in other years.
  const [enrollments, setEnrollments] = useState(null)
  useEffect(() => {
    if (isTeacher || !id) return
    enrollmentApi.history(id)
      .then(res => setEnrollments(res.data.enrollments || []))
      .catch(() => setEnrollments([]))
  }, [id, isTeacher])

  const gradingForSY = (label) =>
    resolveGradingPolicy(schoolYears.find(sy => sy.label === label) || null, student?.grade_level)

  const activeGrading = resolveGradingPolicy(
    schoolYears.find(sy => sy.is_active) || null,
    student?.grade_level
  )

  useEffect(() => {
    if (!activeGrading.periods.includes(eceQuarter)) setEceQuarter(activeGrading.periods[0])
  }, [activeGrading.periodModel])

  const isECE = !!student && ECE_GRADES.includes(student.grade_level)

  // Is this learner in a section the viewer advises? Answered from the auth
  // payload — `advisory` is already scoped to the active school year — so it
  // costs no request.
  const isAdvisee = !!student && (advisory || []).some(
    v => v.grade_level === student.grade_level && v.section === student.section
  )

  const toggleInSet = (setter) => (key) => {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleSY           = toggleInSet(setExpandedSYs)
  const toggleAttSY        = toggleInSet(setExpandedAttSYs)
  const toggleAttMonth     = toggleInSet(setExpandedAttMonths)
  const toggleBehSY        = toggleInSet(setExpandedBehSYs)
  const toggleBehMonth     = toggleInSet(setExpandedBehMonths)
  const toggleEceSubject   = toggleInSet(setExpandedEceSubjects)

  useEffect(() => {
    Promise.all([
      studentApi.get(id),
      gradesApi.get({ student_id: id }),
      attendanceApi.get({ student_id: id }),
      behaviorApi.get({ student_id: id }),
    ]).then(([s, g, a, b]) => {
      setStudent(s.data.student)
      setGrades(g.data.grades || [])
      setAttendance(a.data.attendance || [])
      setBehavior(b.data.logs || [])
    }).catch(() => {})
    .finally(() => setLoading(false))
  }, [id])

  const fetchAI = async () => {
    // An archived learner is off the roll, and every AI endpoint here computes a
    // **live** signal — risk, class health, predictions — from rosters that
    // deliberately exclude them. There is nothing to compute, so asking produces a
    // 404 and a toast on a page that has already loaded the student. Say so instead
    // of firing the request. The recorded tabs (Grades, Attendance, Behaviour,
    // Competencies, Enrolment History) are unaffected: those are history, which the
    // archive exists to keep.
    if (student?.is_active === false) {
      const msg = 'This learner is archived, so live insights are not computed. Restore them to see these.'
      setEceHealthError(msg)
      setClassHealthError(msg)
      return
    }

    // ECE learners: call the ECE-specific endpoint (Competency + Attendance +
    // Behavior) for both roles. Skip grade-based predictions / FastAPI risk.
    if (isECE) {
      if (eceHealth || eceHealthError) return
      try {
        const res = await aiApi.eceClassHealth(id)
        setEceHealth(res.data)
      } catch (err) {
        const status = err?.response?.status
        setEceHealthError(
          status === 404
            ? 'You are not assigned to this student in the current school year.'
            : 'AI service unavailable.'
        )
      }
      return
    }
    if (prediction) return // Already loaded
    try {
      if (isTeacher) {
        const [predRes, chRes] = await Promise.allSettled([
          aiApi.predict({ student_id: id }),
          aiApi.classHealth(id),
        ])
        if (predRes.status === 'fulfilled') setPrediction(predRes.value.data)
        if (chRes.status === 'fulfilled') {
          setClassHealth(chRes.value.data)
        } else {
          const status = chRes.reason?.response?.status
          setClassHealthError(
            status === 404
              ? 'You are not assigned to this student in the current school year.'
              : 'Could not load class health.'
          )
        }
        if (predRes.status === 'rejected' && chRes.status === 'rejected') {
          toast.error('AI service unavailable.')
        }
      } else {
        const [pred, riskRes] = await Promise.all([
          aiApi.predict({ student_id: id }),
          aiApi.risk({ student_id: id }),
        ])
        setPrediction(pred.data)
        setRisk(riskRes.data)
      }
    } catch {
      toast.error('AI service unavailable.')
    }
  }

  // Load the ECE skill catalog + subjects for this student's grade level once.
  useEffect(() => {
    if (!isECE || !student?.grade_level) return
    let cancelled = false
    Promise.all([
      eceApi.getSkills({ grade_level: student.grade_level }),
      curriculumApi.getSubjects({ grade_level: student.grade_level }),
    ]).then(([sk, sj]) => {
      if (cancelled) return
      setEceSkills(sk.data.skills || sk.data || [])
      setEceSubjects(sj.data.subjects || sj.data || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isECE, student?.grade_level])

  // Load this student's records for the selected quarter. eceApi.getRecords
  // returns the whole class — we filter to this student client-side. Admins
  // bypass verifyEceAssignment on the backend; teachers not assigned get a 403.
  useEffect(() => {
    if (!isECE || !student?.grade_level || !student?.section) return
    let cancelled = false
    setEceLoading(true)
    setEceAccessError(null)
    eceApi.getRecords({
      grade_level: student.grade_level,
      section: student.section,
      quarter: eceQuarter,
    }).then(res => {
      if (cancelled) return
      const all = res.data.records || []
      setEceRecords(all.filter(r => r.student_id === id))
      if (res.data.school_year) setEceSchoolYear(res.data.school_year)
    }).catch(err => {
      if (cancelled) return
      setEceRecords([])
      if (err?.response?.status === 403) {
        setEceAccessError('You are not assigned to this class.')
      }
    }).finally(() => {
      if (!cancelled) setEceLoading(false)
    })
    return () => { cancelled = true }
  }, [isECE, student?.grade_level, student?.section, eceQuarter, id])

  const handleTabChange = t => {
    setTab(t)
    if (t === 'AI Insights') fetchAI()
  }

  // DSS deep-link dispatcher — mirrors the patterns used by TeacherDashboard
  // (sessionStorage for Score Entry, React Router location state for Attendance).
  const runSuggestionAction = (action) => {
    if (!action) return
    if (action.type === 'ece') {
      navigate('/ece-competency')
      return
    }
    const scope = classHealth?.scope || eceHealth?.scope
    if (!scope) return
    const { grade_level, section } = scope
    if (action.type === 'score-entry') {
      const STORAGE_KEY = 'vista_score_entry_filters'
      let cur = {}
      try { cur = JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {} } catch { cur = {} }
      cur.selectedClass = `${grade_level}|||${section}`
      if (action.subject_id) cur.subjectId = action.subject_id
      cur.quarter = String(action.quarter || 1)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cur))
      navigate('/score-entry')
    } else if (action.type === 'attendance') {
      navigate('/attendance', {
        state: {
          deepLink: {
            selectedSection: `${grade_level}|||${section}`,
            selectedSubject: action.subject_id || '',
            ts: Date.now(),
          },
        },
      })
    } else if (action.type === 'behavior') {
      navigate('/behavior')
    }
  }

  // Restoring from here rather than only from the Students page: an admin who
  // followed a link into an archived learner is already looking at the record they
  // want back, and sending them to another page to press the same button is a
  // detour, not a safeguard.
  const handleRestore = async () => {
    setRestoring(true)
    try {
      const res = await studentApi.setArchived(id, false)
      toast.success(res.data.message)
      const fresh = await studentApi.get(id)
      setStudent(fresh.data.student)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to restore.')
    } finally { setRestoring(false) }
  }

  const handleToggleAcademicAccess = async () => {
    if (!student) return
    const currentlySuspended = !!student.academic_access_suspended
    if (currentlySuspended) {
      if (!window.confirm('Restore academic access for this student? The parent app will show grades + ECE records again.')) return
      try {
        await studentApi.setAcademicAccess(id, { suspended: false })
        setStudent({ ...student, academic_access_suspended: false, academic_access_suspended_reason: null })
        toast.success('Academic access restored.')
      } catch (e) {
        toast.error(e?.response?.data?.error || 'Unable to update access.')
      }
      return
    }
    const reason = window.prompt('Reason for suspending academic access (shown to the parent):', 'Outstanding tuition balance.')
    if (reason == null) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('A reason is required.')
      return
    }
    try {
      await studentApi.setAcademicAccess(id, { suspended: true, reason: trimmed })
      setStudent({ ...student, academic_access_suspended: true, academic_access_suspended_reason: trimmed })
      toast.success('Academic access suspended.')
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Unable to update access.')
    }
  }

  const attSummary = attendance.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1
    return a
  }, {})

  // Group grades by school year → subject (most recent SY first)
  const gradesBySY = grades.reduce((acc, g) => {
    const sy = g.school_year || '—'
    if (!acc[sy]) acc[sy] = {}
    if (!acc[sy][g.subject_name]) acc[sy][g.subject_name] = {}
    acc[sy][g.subject_name][g.quarter] = g.grade
    return acc
  }, {})
  const sortedSYs = Object.keys(gradesBySY).sort().reverse()

  useEffect(() => {
    if (sortedSYs.length && expandedSYs.size === 0) {
      setExpandedSYs(new Set([sortedSYs[0]]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades])

  const monthKey = (d) => {
    const dt = new Date(d)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }

  // Group attendance by school year, then by month within it. The year comes
  // from the record's own school_year_id (resolved by the API), never from the
  // date: consecutive years leave months uncovered between one year's end and
  // the next one's start, so dates cannot say which year a record belongs to.
  // A record the backfill could not attribute has no year at all and lands in
  // its own bucket rather than being guessed into someone else's.
  const emptyAttSummary = () => ({ Present: 0, Absent: 0, Late: 0, Excused: 0 })
  const attBySY = attendance.reduce((acc, r) => {
    const sy = r.school_year || UNASSIGNED_SY
    const mk = monthKey(r.date)
    if (!acc[sy]) acc[sy] = { total: 0, summary: emptyAttSummary(), months: {} }
    if (!acc[sy].months[mk]) acc[sy].months[mk] = { records: [], summary: emptyAttSummary() }
    acc[sy].months[mk].records.push(r)
    acc[sy].months[mk].summary[r.status] = (acc[sy].months[mk].summary[r.status] || 0) + 1
    acc[sy].summary[r.status] = (acc[sy].summary[r.status] || 0) + 1
    acc[sy].total++
    return acc
  }, {})
  // Most recent year first, with the unattributed bucket always last — it has no
  // place on the timeline, so sorting it by label would drop it at the top.
  const sortedAttSYs = Object.keys(attBySY).sort((a, b) => {
    if (a === UNASSIGNED_SY) return 1
    if (b === UNASSIGNED_SY) return -1
    return b.localeCompare(a)
  })
  const attMonthsOf = (sy) => Object.keys(attBySY[sy].months).sort().reverse()

  useEffect(() => {
    if (sortedAttSYs.length && expandedAttSYs.size === 0) {
      const latestSY = sortedAttSYs[0]
      setExpandedAttSYs(new Set([latestSY]))
      setExpandedAttMonths(new Set([attMonthsOf(latestSY)[0]]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance])

  // Behavior: filter by sentiment, then group by school year and month. The year
  // is the one stamped on the log when it was written, never read off the date —
  // see the Attendance grouping above for why the date cannot answer this.
  const filteredBehavior = behaviorFilter === 'All'
    ? behavior
    : behavior.filter(b => b.sentiment === behaviorFilter)
  const behBySY = filteredBehavior.reduce((acc, b) => {
    const sy = b.school_year || UNASSIGNED_SY
    const mk = monthKey(b.observed_at)
    if (!acc[sy]) acc[sy] = { total: 0, months: {} }
    if (!acc[sy].months[mk]) acc[sy].months[mk] = []
    acc[sy].months[mk].push(b)
    acc[sy].total++
    return acc
  }, {})
  const sortedBehSYs = Object.keys(behBySY).sort((a, b) => {
    if (a === UNASSIGNED_SY) return 1
    if (b === UNASSIGNED_SY) return -1
    return b.localeCompare(a)
  })
  const behMonthsOf = (sy) => Object.keys(behBySY[sy].months).sort().reverse()

  useEffect(() => {
    if (!sortedBehSYs.length) return
    // Re-seed whenever the sentiment filter has left nothing open — switching to
    // a filter whose logs are all in years that were collapsed would otherwise
    // show a list of shut drawers.
    if (sortedBehSYs.some(sy => expandedBehSYs.has(sy))) return
    const latestSY = sortedBehSYs[0]
    setExpandedBehSYs(new Set([latestSY]))
    setExpandedBehMonths(new Set([behMonthsOf(latestSY)[0]]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behavior, behaviorFilter])

  const formatMonth = (k) => {
    const [y, m] = k.split('-').map(Number)
    return format(new Date(y, m - 1, 1), 'MMMM yyyy')
  }

  if (loading) return <LoadingSpinner />
  if (!student) return <div className="text-slate-500 text-sm">Student not found.</div>

  return (
    <div className="space-y-5 animate-fade-in">
      {/* An archived learner is reachable here on purpose — the archive keeps the
          record, and this page is where the record lives. But every tab below
          reads history that stops at the archive date, so say so once at the top
          rather than letting the page look live. */}
      {student.is_active === false && (
        <div className="flex items-start gap-2.5 text-sm rounded-xl px-3.5 py-3 border bg-slate-100 border-slate-300 text-slate-700">
          <Archive size={16} className="shrink-0 mt-0.5"/>
          <div className="flex-1">
            <p>
              <strong>{formatName(student)}</strong> is archived — off the active roll, so they
              appear on no class list, dashboard or risk report. Everything below is their
              record as it stood.
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {student.archived_reason || 'No reason recorded'}
              {student.archived_at && ` · ${format(new Date(student.archived_at), 'd MMM yyyy')}`}
            </p>
          </div>
          {isAnyAdmin && (
            <button onClick={handleRestore} disabled={restoring}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 text-xs font-medium hover:border-slate-400 transition-colors disabled:opacity-50">
              <ArchiveRestore size={13}/> {restoring ? 'Restoring...' : 'Restore'}
            </button>
          )}
        </div>
      )}

      {/* Back + header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors mt-0.5">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0">
              <span className="text-brand-700 font-bold text-lg sm:text-xl">{nameInitial(student)}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{formatName(student)}</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">LRN: {student.lrn}</span>
                <span className="text-xs text-slate-500">{student.grade_level} {student.section && `· ${student.section}`}</span>
                {/* Both chips sit immediately after the class, because that is
                    what they are a fact about — who is responsible for the
                    section this learner is in. Which one shows depends on
                    whether that person is you:
                      · you       → "Your advisee", brand-tinted, since it is a
                                    relationship to you and explains why the tabs
                                    below show the whole record rather than only
                                    the subjects you teach
                      · anyone else → the adviser's name, neutral slate, because
                                    it is reference information rather than
                                    something about the viewer
                    This is the only place the adviser appears on this page.
                    Nothing renders when the section has no adviser — an absence
                    is noise here rather than information. */}
                {isAdvisee ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-lg bg-brand-50 text-brand-700 border border-brand-200"
                    title="You are the class adviser of this section.">
                    <GraduationCap size={12}/> Your advisee
                  </span>
                ) : student.adviser && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200"
                    title={`Class adviser of ${student.grade_level}${student.section ? ` · ${student.section}` : ''}`}>
                    <GraduationCap size={12} className="text-slate-400"/>
                    Adviser: <span className="font-semibold">{formatName(student.adviser)}</span>
                    {student.adviser.is_active === false && (
                      <span className="ml-0.5 text-[10px] font-semibold text-amber-600">(inactive)</span>
                    )}
                  </span>
                )}
                {risk && <RiskBadge level={risk.risk_level} />}
              </div>
            </div>
          </div>


          <div className="flex items-center gap-2 flex-wrap">
            {isAnyAdmin && (
              <button
                onClick={handleToggleAcademicAccess}
                className="btn-secondary"
                title={student.academic_access_suspended ? 'Restore parent academic view' : 'Suspend parent academic view'}
              >
                {student.academic_access_suspended
                  ? (<><Unlock size={16} /> Restore Access</>)
                  : (<><Lock size={16} /> Suspend Access</>)}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Academic access suspended banner */}
      {student.academic_access_suspended && (
        <div className="card p-4 flex items-start gap-3 border-l-4 border-amber-500 bg-amber-50">
          <Lock size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">Parent academic view suspended</p>
            <p className="text-xs text-amber-800 mt-1">
              {student.academic_access_suspended_reason || 'No reason recorded.'}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Attendance, behavior, pickup QR, and dismissal history remain visible to the parent.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'Grades' && isECE ? 'Competencies' : t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Overview' && (
        <div className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Info card */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">Student Information</h3>
            {[
              ['LRN', student.lrn],
              ['Surname', student.surname],
              ['First Name', student.first_name],
              ['Middle Name', student.middle_name || '—'],
              ['Date of Birth', student.date_of_birth ? format(new Date(student.date_of_birth), 'MMM d, yyyy') : '—'],
              ['Age', calcAge(student.date_of_birth) !== null ? `${calcAge(student.date_of_birth)} years old` : '—'],
              ['Gender', student.gender],
              ['Grade Level', student.grade_level],
              ['Section', student.section || '—'],
              // The adviser is deliberately not a row here — it lives in the
              // header chip beside the class, which is the one place it is a
              // fact about. Repeating it in this card said the same thing twice
              // and buried it under the learner's own details.
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-800">{val}</span>
              </div>
            ))}
          </div>

          {/* Attendance summary */}
          <div className="card relative overflow-hidden">
            <div className="absolute inset-0 p-5 flex flex-col overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 flex-shrink-0">
              <ClipboardCheck size={15} className="text-brand-500" /> Attendance Summary
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Present', count: attSummary.Present || 0, color: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50' },
                { label: 'Absent',  count: attSummary.Absent  || 0, color: 'bg-red-500',     textColor: 'text-red-700',     bg: 'bg-red-50'     },
                { label: 'Late',    count: attSummary.Late    || 0, color: 'bg-amber-500',   textColor: 'text-amber-700',   bg: 'bg-amber-50'   },
                { label: 'Excused', count: attSummary.Excused || 0, color: 'bg-blue-500',    textColor: 'text-blue-700',    bg: 'bg-blue-50'    },
              ].map(r => (
                <div key={r.label} className={`flex items-center justify-between px-3 py-2 rounded-xl ${r.bg}`}>
                  <span className={`text-sm font-medium ${r.textColor}`}>{r.label}</span>
                  <span className={`font-bold text-lg ${r.textColor}`}>{r.count}</span>
                </div>
              ))}
            </div>
            </div>
          </div>

          {/* Guardians */}
          <div className="card relative overflow-hidden">
            <div className="absolute inset-0 p-5 flex flex-col overflow-hidden">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 flex-shrink-0">
              <span>Linked Parents / Guardians</span>
              <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                {(student.guardians || []).length}
              </span>
            </h3>
            {(student.guardians || []).length === 0 ? (
              <p className="text-sm text-slate-400">No guardians linked yet.</p>
            ) : (
              <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                {student.guardians.map(g => (
                  <div key={g.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700 flex-shrink-0">
                        {nameInitial(g)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-800">{formatName(g)}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 font-medium">{g.relationship}</span>
                          {g.is_emergency_contact && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-semibold">🚨 Emergency</span>
                          )}
                          {g.is_authorized_pickup && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-medium">✓ Pickup</span>
                          )}
                        </div>
                        {!isTeacher && (
                          <div className="mt-1 space-y-0.5">
                            {g.email && <p className="text-xs text-slate-400 truncate">✉ {g.email}</p>}
                            {g.phone && <p className="text-xs text-slate-400">📞 {g.phone}</p>}
                            {g.home_address && <p className="text-xs text-slate-400">📍 {g.home_address}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Enrolment history — full width. `students.grade_level` above is only
            the current year; this is where the learner has actually been. */}
        {!isTeacher && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <CalendarDays size={15} className="text-brand-500" /> Enrolment History
            </h3>
            {enrollments === null ? (
              <p className="text-sm text-slate-400 italic">Loading...</p>
            ) : enrollments.length === 0 ? (
              <p className="text-sm text-slate-400 italic">
                No enrolment records yet. Records start from the school year in which enrolment tracking began.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="whitespace-nowrap">School Year</th>
                      <th className="whitespace-nowrap">Grade Level</th>
                      <th className="whitespace-nowrap">Section</th>
                      <th className="whitespace-nowrap">Status</th>
                      <th className="whitespace-nowrap">Outcome</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map(e => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap">
                          <span className="font-medium text-slate-800">SY {e.school_year}</span>
                          {e.is_active && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">current</span>}
                          {e.is_upcoming && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">upcoming</span>}
                        </td>
                        <td className="text-sm text-slate-700">{e.grade_level}</td>
                        <td className="text-sm text-slate-500">{e.section || '—'}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusClasses(e.status)}`}>
                            {statusLabel(e.status)}
                          </span>
                        </td>
                        {/* How the year ended, independent of whether they
                            attended it. Blank until that year is closed. */}
                        <td>
                          {e.outcome ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusClasses(e.outcome)}`}>
                              {statusLabel(e.outcome)}
                            </span>
                          ) : <span className="text-sm text-slate-300">—</span>}
                        </td>
                        <td className="text-sm text-slate-500">
                          {e.remarks || (e.outcome_remarks ? null : '—')}
                          {e.outcome_remarks && (
                            <span className="block text-xs text-slate-400">{e.outcome_remarks}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Home Address card — full width */}
        {!isTeacher && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <MapPin size={15} className="text-brand-500" /> Home Address
            </h3>
            {student.home_address ? (
              <p className="text-sm text-slate-700 leading-relaxed">{student.home_address}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">No home address recorded.</p>
            )}
          </div>
        )}
      </div>
      )}

      {tab === 'Grades' && (
        isECE ? (
          (() => {
            // ECE learners: show competency ratings instead of numeric grades.
            const ratingByskill = new Map(eceRecords.map(r => [r.skill_id, r.rating]))
            const subjectsWithSkills = eceSubjects
              .map(sub => ({
                subject: sub,
                skills: eceSkills.filter(sk => sk.subject_id === sub.id),
              }))
              .filter(g => g.skills.length > 0)
            const totalSkills = subjectsWithSkills.reduce((a, g) => a + g.skills.length, 0)
            const ratedCount  = eceRecords.length
            const syLabel = eceSchoolYear?.label || '—'
            return (
              <div className="space-y-3">
                <div className="card overflow-hidden">
                  <button
                    onClick={() => setExpandedEceSY(v => !v)}
                    className="w-full flex items-center gap-2 px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    {expandedEceSY ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-800">{syLabel}</span>
                    <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {activeGrading.abbr(eceQuarter)} · {ratedCount} / {totalSkills} rated
                    </span>
                  </button>
                  {expandedEceSY && (
                    <div className="border-t border-slate-100 p-5 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-semibold text-slate-800">Competency Ratings</h3>
                        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                          {activeGrading.periods.map(q => (
                            <button
                              key={q}
                              onClick={() => setEceQuarter(q)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                eceQuarter === q ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              {activeGrading.abbr(q)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {eceAccessError ? (
                        <div className="p-8 text-center text-sm text-slate-500">{eceAccessError}</div>
                      ) : eceLoading ? (
                        <div className="p-8 text-center">
                          <LoadingSpinner size="sm" />
                          <p className="text-sm text-slate-400 mt-2">Loading competency records...</p>
                        </div>
                      ) : subjectsWithSkills.length === 0 ? (
                        <div className="p-8 text-center text-sm text-slate-400">
                          No competency skills have been defined for {student.grade_level} yet.
                          {isTeacher && (
                            <>
                              {' '}
                              <Link to="/ece-competency" className="text-brand-600 hover:text-brand-700 font-medium">
                                Open ECE Competency →
                              </Link>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {subjectsWithSkills.map(({ subject, skills }) => {
                            const isOpen = expandedEceSubjects.has(subject.id)
                            const rated = skills.filter(sk => ratingByskill.has(sk.id)).length
                            return (
                              <div key={subject.id} className="border border-slate-100 rounded-xl overflow-hidden">
                                <button
                                  onClick={() => toggleEceSubject(subject.id)}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                                >
                                  {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                                  <span className="text-sm font-semibold text-slate-800">{subject.name}</span>
                                  <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                    {rated} / {skills.length} rated
                                  </span>
                                </button>
                                {isOpen && (
                                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                                    {skills.map(skill => {
                                      const rating = ratingByskill.get(skill.id)
                                      const meta = rating ? ECE_RATING_BY_VALUE[rating] : null
                                      return (
                                        <div key={skill.id} className="flex items-center justify-between gap-3 px-4 py-2">
                                          <span className="text-sm text-slate-700">{skill.name}</span>
                                          {meta ? (
                                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.color}`}>
                                              {meta.value} · {meta.label}
                                            </span>
                                          ) : (
                                            <span className="text-xs italic text-slate-400">Not rated</span>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {isTeacher && (
                  <div className="flex justify-end">
                    <Link to="/ece-competency" className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline">
                      Open ECE Competency →
                    </Link>
                  </div>
                )}
              </div>
            )
          })()
        ) : grades.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-400">No grade records found.</div>
        ) : (
          <div className="space-y-3">
            {sortedSYs.map(sy => {
              const isOpen = expandedSYs.has(sy)
              const subjects = Object.entries(gradesBySY[sy])
              return (
                <div key={sy} className="card overflow-hidden">
                  <button
                    onClick={() => toggleSY(sy)}
                    className="w-full flex items-center gap-2 px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-800">{sy}</span>
                    <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {subjects.length} {subjects.length === 1 ? 'subject' : 'subjects'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="overflow-x-auto border-t border-slate-100">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>Subject</th>
                            {gradingForSY(sy).periods.map(q => (
                              <th key={q}>{gradingForSY(sy).abbr(q)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {subjects.map(([subject, quarters]) => (
                            <tr key={subject}>
                              <td className="font-medium">{subject}</td>
                              {gradingForSY(sy).periods.map(q => (
                                <td key={q}><GradeChip grade={quarters[q]} /></td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'Attendance' && (
        attendance.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-400">No attendance records found.</div>
        ) : (
          <div className="space-y-3">
            {sortedAttSYs.map(sy => {
              const syOpen = expandedAttSYs.has(sy)
              const { summary: sySummary, total, months } = attBySY[sy]
              return (
                <div key={sy} className="card overflow-hidden">
                  <button
                    onClick={() => toggleAttSY(sy)}
                    className="w-full flex items-center gap-2 px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    {syOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-800">
                      {sy === UNASSIGNED_SY ? sy : `SY ${sy}`}
                    </span>
                    <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {total} {total === 1 ? 'record' : 'records'}
                    </span>
                    <div className="ml-auto"><AttendanceCounts summary={sySummary} /></div>
                  </button>

                  {syOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {attMonthsOf(sy).map(mk => {
                        const isOpen = expandedAttMonths.has(mk)
                        const { records, summary } = months[mk]
                        return (
                          <div key={mk}>
                            <button
                              onClick={() => toggleAttMonth(mk)}
                              className="w-full flex items-center gap-2 pl-9 pr-5 py-2.5 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                            >
                              {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                              <span className="text-xs font-semibold text-slate-600">{formatMonth(mk)}</span>
                              <div className="ml-auto"><AttendanceCounts summary={summary} /></div>
                            </button>
                            {isOpen && (
                              <div className="overflow-x-auto border-t border-slate-100">
                                <table className="table-base">
                                  <thead><tr><th>Date</th><th>Status</th><th>Subject</th><th>Recorded By</th></tr></thead>
                                  <tbody>
                                    {records.map(a => (
                                      <tr key={a.id}>
                                        <td className="font-mono text-xs">{format(new Date(a.date), 'MMM d, yyyy')}</td>
                                        <td>
                                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            a.status === 'Present' ? 'bg-emerald-50 text-emerald-700' :
                                            a.status === 'Absent'  ? 'bg-red-50 text-red-700' :
                                            a.status === 'Late'    ? 'bg-amber-50 text-amber-700' :
                                                                     'bg-blue-50 text-blue-700'
                                          }`}>{a.status}</span>
                                        </td>
                                        <td className="text-slate-500 text-xs">{a.subject_name || '—'}</td>
                                        <td className="text-slate-400 text-xs">
                                          {isTeacher && a.recorded_by === user?.id ? 'You' : (a.recorded_by_name || '—')}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'Behavior' && (
        behavior.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-400">No behavior logs yet.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
              {['All', 'Positive', 'Neutral', 'Negative'].map(f => {
                const count = f === 'All' ? behavior.length : behavior.filter(b => b.sentiment === f).length
                return (
                  <button
                    key={f}
                    onClick={() => setBehaviorFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                      behaviorFilter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {f}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${behaviorFilter === f ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-500'}`}>{count}</span>
                  </button>
                )
              })}
            </div>
            {sortedBehSYs.length === 0 ? (
              <div className="card p-8 text-center text-sm text-slate-400">No {behaviorFilter.toLowerCase()} logs in this view.</div>
            ) : sortedBehSYs.map(sy => {
              const syOpen = expandedBehSYs.has(sy)
              const { total, months } = behBySY[sy]
              return (
                <div key={sy} className="card overflow-hidden">
                  <button
                    onClick={() => toggleBehSY(sy)}
                    className="w-full flex items-center gap-2 px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    {syOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-800">
                      {sy === UNASSIGNED_SY ? sy : `SY ${sy}`}
                    </span>
                    <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {total} {total === 1 ? 'log' : 'logs'}
                    </span>
                  </button>

                  {syOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {behMonthsOf(sy).map(mk => {
                        const isOpen = expandedBehMonths.has(mk)
                        const logs = months[mk]
                        return (
                          <div key={mk}>
                            <button
                              onClick={() => toggleBehMonth(mk)}
                              className="w-full flex items-center gap-2 pl-9 pr-5 py-2.5 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                            >
                              {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                              <span className="text-xs font-semibold text-slate-600">{formatMonth(mk)}</span>
                              <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                {logs.length} {logs.length === 1 ? 'log' : 'logs'}
                              </span>
                            </button>
                            {isOpen && (
                              <div className="border-t border-slate-100 p-3 space-y-2">
                                {logs.map(b => {
                                  const mine = isTeacher && b.teacher_id === user?.id
                                  return (
                                  <div key={b.id} className="p-3 bg-slate-50 rounded-xl flex gap-4">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${mine ? 'bg-brand-50 text-brand-600' : 'bg-white text-slate-500 text-sm font-bold'}`}>
                                      {mine ? <Pencil size={14}/> : (b.teacher_name?.[0] || 'T')}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <p className="text-sm font-medium text-slate-800">{mine ? 'Logged by you' : b.teacher_name}</p>
                                        <div className="flex items-center gap-2">
                                          <SentimentBadge sentiment={b.sentiment} />
                                          {b.category && <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded-full">{b.category}</span>}
                                        </div>
                                      </div>
                                      <p className="text-sm text-slate-600 mt-1.5">{b.observation}</p>
                                      <p className="text-xs text-slate-400 mt-1.5">{format(new Date(b.observed_at), 'MMM d, yyyy · h:mm a')}</p>
                                      {b.sentiment_score !== null && (
                                        <div className="mt-2 flex items-center gap-2">
                                          <div className="flex-1 h-1.5 bg-slate-200 rounded-full max-w-24">
                                            <div
                                              className={`h-full rounded-full ${b.sentiment === 'Positive' ? 'bg-brand-500' : b.sentiment === 'Negative' ? 'bg-red-500' : 'bg-slate-400'}`}
                                              style={{ width: `${Math.abs(b.sentiment_score) * 100}%` }}
                                            />
                                          </div>
                                          <span className="text-xs font-mono text-slate-400">score: {Number(b.sentiment_score).toFixed(3)}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'AI Insights' && isECE && (
        eceHealthError ? (
          <div className="card p-5 text-sm text-slate-500">{eceHealthError}</div>
        ) : !eceHealth ? (
          <div className="card p-8 text-center">
            <LoadingSpinner size="sm" />
            <p className="text-sm text-slate-400 mt-2">Computing ECE signals...</p>
          </div>
        ) : (
          (() => {
            const bandStyles = {
              ok:           'bg-emerald-50 text-emerald-700',
              watch:        'bg-amber-50 text-amber-700',
              urgent:       'bg-red-50 text-red-700',
              insufficient: 'bg-slate-100 text-slate-500',
            }
            const bandLabels = {
              ok:           'OK',
              watch:        'Watch',
              urgent:       'Urgent',
              insufficient: 'More data needed',
            }
            const { overall_band, metrics, suggestions } = eceHealth
            const { competency, attendance: att, behavior: beh } = metrics

            return (
              <div className="space-y-5">
                <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-xs text-brand-800 flex items-start gap-2">
                  <Baby size={14} className="text-brand-600 mt-0.5 flex-shrink-0" />
                  <p>
                    <span className="font-semibold">ECE signals</span> replace grade-based predictions.
                    Competency ratings reflect the latest {activeGrading.periodNoun.toLowerCase()} with records.
                  </p>
                </div>

                <div className="card p-5">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Brain size={15} className="text-brand-500" />
                      {isTeacher ? 'Competency & Class Signals' : 'Competency Snapshot'}
                    </h3>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${bandStyles[overall_band]}`}>
                      {bandLabels[overall_band]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">
                    {isTeacher
                      ? 'Your signals for this student: latest-quarter competencies, attendance, and behavior.'
                      : 'School-wide signals: latest-quarter competencies, attendance, and behavior.'}
                  </p>

                  <div className="space-y-2">
                    {/* Competency — overview header + per-subject breakdown */}
                    {(() => {
                      const perSubject = competency.per_subject || []
                      const urgentAndWatch = perSubject.filter(s => s.band === 'urgent' || s.band === 'watch')
                      const insufficientSubjects = perSubject.filter(s => s.band === 'insufficient')
                      const okSubjects = perSubject.filter(s => s.band === 'ok')

                      return (
                        <div className="p-3 bg-slate-50 rounded-xl space-y-3">
                          {/* Header — overall competency stats */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800">Competency</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {competency.total_skills === 0
                                  ? 'No competency skills defined for this grade level yet.'
                                  : competency.quarter
                                    ? `${competency.rated} of ${competency.total_skills} skills rated · ${activeGrading.abbr(competency.quarter)}`
                                    : `${competency.rated} of ${competency.total_skills} skills rated · no ${activeGrading.periodNoun.toLowerCase()} yet`}
                              </p>
                              {competency.rated > 0 && (
                                <>
                                  <div className="mt-1.5 flex h-2 rounded-full overflow-hidden bg-slate-200">
                                    {ECE_RATINGS.map(r => {
                                      const count = competency.distribution[r.value] || 0
                                      if (!count) return null
                                      const pct = (count / competency.total_skills) * 100
                                      return (
                                        <div
                                          key={r.value}
                                          className={r.color.split(' ')[0]}
                                          style={{ width: `${pct}%` }}
                                          title={`${r.label}: ${count}`}
                                        />
                                      )
                                    })}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                                    {ECE_RATINGS.map(r => (
                                      <span key={r.value} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                        <span className={`w-2 h-2 rounded-full ${r.color.split(' ')[0]}`} />
                                        {r.value}: <span className="font-mono text-slate-700">{competency.distribution[r.value] || 0}</span>
                                      </span>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Per-subject breakdown */}
                          {perSubject.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                By subject
                              </p>

                              {/* Urgent + Watch — shown individually */}
                              {urgentAndWatch.map(s => (
                                <div key={s.subject_id} className="flex items-center justify-between gap-3 px-3 py-2 bg-white rounded-lg border border-slate-100">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-slate-800 truncate">{s.subject_name}</p>
                                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                                      <span className="text-[11px] text-slate-500">
                                        {s.rated} / {s.total_skills} rated
                                      </span>
                                      {s.rated > 0 && (
                                        <span className="flex items-center gap-1.5">
                                          {ECE_RATINGS.map(r => (
                                            <span key={r.value} className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                                              <span className={`w-1.5 h-1.5 rounded-full ${r.color.split(' ')[0]}`} />
                                              <span className="font-mono text-slate-700">{s.distribution[r.value] || 0}</span>
                                            </span>
                                          ))}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles[s.band]}`}>
                                    {bandLabels[s.band]}
                                  </span>
                                </div>
                              ))}

                              {/* Insufficient — collapsed aggregate */}
                              {insufficientSubjects.length > 0 && (
                                <div className="bg-white rounded-lg border border-slate-100 overflow-hidden">
                                  <button
                                    onClick={() => setExpandedEceInsightsInsufficient(v => !v)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                  >
                                    {expandedEceInsightsInsufficient
                                      ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                                      : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-slate-800">
                                        {insufficientSubjects.length} subject{insufficientSubjects.length === 1 ? '' : 's'} need{insufficientSubjects.length === 1 ? 's' : ''} more ratings
                                      </p>
                                      {!expandedEceInsightsInsufficient && (
                                        <p className="text-[11px] text-slate-500 truncate">
                                          {insufficientSubjects.map(s => s.subject_name).join(', ')}
                                        </p>
                                      )}
                                    </div>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles.insufficient}`}>
                                      {bandLabels.insufficient}
                                    </span>
                                  </button>
                                  {expandedEceInsightsInsufficient && (
                                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                                      {insufficientSubjects.map(s => (
                                        <div key={s.subject_id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                                          <span className="text-sm text-slate-700">{s.subject_name}</span>
                                          <span className="text-[11px] text-slate-500 font-mono">{s.rated} / {s.total_skills}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* OK — collapsed aggregate */}
                              {okSubjects.length > 0 && (
                                <div className="bg-white rounded-lg border border-slate-100 overflow-hidden">
                                  <button
                                    onClick={() => setExpandedEceInsightsOk(v => !v)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                  >
                                    {expandedEceInsightsOk
                                      ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                                      : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-slate-800">
                                        {okSubjects.length} subject{okSubjects.length === 1 ? '' : 's'} on track
                                      </p>
                                      {!expandedEceInsightsOk && (
                                        <p className="text-[11px] text-slate-500 truncate">
                                          {okSubjects.map(s => s.subject_name).join(', ')}
                                        </p>
                                      )}
                                    </div>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles.ok}`}>
                                      {bandLabels.ok}
                                    </span>
                                  </button>
                                  {expandedEceInsightsOk && (
                                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                                      {okSubjects.map(s => (
                                        <div key={s.subject_id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                                          <span className="text-sm text-slate-700">{s.subject_name}</span>
                                          <span className="text-[11px] text-slate-500 font-mono">{s.rated} / {s.total_skills}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Attendance */}
                    <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">Attendance</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {att.total === 0
                            ? isTeacher
                              ? 'No attendance recorded in your subject sessions yet.'
                              : 'No attendance recorded in the last 30 days.'
                            : `${att.present} of ${att.total} classes · last 30 days`}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles[att.band]}`}>
                        {bandLabels[att.band]}
                      </span>
                    </div>

                    {/* Behavior */}
                    <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">Behavior</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {beh.log_count === 0
                            ? isTeacher
                              ? "You haven't logged any behavior notes this month."
                              : 'No behavior logs this month.'
                            : `${beh.log_count} ${beh.log_count === 1 ? 'log' : 'logs'} this month`}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles[beh.band]}`}>
                        {bandLabels[beh.band]}
                      </span>
                    </div>
                  </div>

                  {suggestions?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        Suggested next steps
                      </p>
                      <ul className="space-y-2">
                        {suggestions.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              s.severity === 'urgent'       ? 'bg-red-500'     :
                              s.severity === 'watch'        ? 'bg-amber-500'   :
                              s.severity === 'ok'           ? 'bg-emerald-500' :
                                                              'bg-slate-300'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <span>{s.text}</span>
                              {s.action && (
                                <button
                                  onClick={() => runSuggestionAction(s.action)}
                                  className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                                >
                                  {s.action.label || 'Open'} →
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )
          })()
        )
      )}

      {tab === 'AI Insights' && !isECE && (
        <div className="space-y-5">
          {isTeacher && (
            <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-xs text-brand-800">
              <span className="font-semibold">Scoped view:</span> AI insights below are limited to the subjects you teach
              {student.section && <> in <span className="font-semibold">{student.grade_level} · {student.section}</span></>}.
              {/* An adviser's other tabs now carry the whole record, so say which
                  half of the page this caveat is actually about — otherwise the
                  banner reads as if it bounded everything. */}
              {isAdvisee && <> The Grades, Attendance and Behavior tabs show the full record, because you are this class's adviser.</>}
            </div>
          )}

          {/* In Your Class — teacher-scoped health card */}
          {isTeacher && (
            classHealthError ? (
              <div className="card p-5 text-sm text-slate-500">{classHealthError}</div>
            ) : !classHealth ? (
              <div className="card p-8 text-center">
                <LoadingSpinner size="sm" />
                <p className="text-sm text-slate-400 mt-2">Computing in-class signals...</p>
              </div>
            ) : (
              (() => {
                const bandStyles = {
                  ok:           'bg-emerald-50 text-emerald-700',
                  watch:        'bg-amber-50 text-amber-700',
                  urgent:       'bg-red-50 text-red-700',
                  insufficient: 'bg-slate-100 text-slate-500',
                }
                const bandLabels = {
                  ok:           'OK',
                  watch:        'Watch',
                  urgent:       'Urgent',
                  insufficient: 'More data needed',
                }
                const { scope, overall_band, metrics } = classHealth
                return (
                  <div className="card p-5">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <Brain size={15} className="text-brand-500" /> In Your Class
                      </h3>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${bandStyles[overall_band]}`}>
                        {bandLabels[overall_band]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-4">
                      Your signals for this student across {scope.subjects.map(s => s.name).join(', ')}
                    </p>

                    <div className="space-y-2">
                      {/* Academic */}
                      <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">Academic</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {metrics.academic.sample_count === 0
                              ? 'No grades recorded yet this school year.'
                              : `Based on ${metrics.academic.sample_count} ${metrics.academic.sample_count === 1 ? 'subject' : 'subjects'} · latest ${activeGrading.periodNoun.toLowerCase()} each`}
                          </p>
                          {metrics.academic.per_subject.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {metrics.academic.per_subject.map(p => (
                                <span key={p.subject_name} className="text-[11px] font-mono bg-white text-slate-600 px-1.5 py-0.5 rounded">
                                  {p.subject_name}: {p.grade} ({activeGrading.abbr(p.quarter)})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles[metrics.academic.band]}`}>
                          {bandLabels[metrics.academic.band]}
                        </span>
                      </div>

                      {/* Attendance */}
                      <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">Attendance</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {metrics.attendance.total === 0
                              ? 'No attendance recorded in your subject sessions yet.'
                              : `${metrics.attendance.present} of ${metrics.attendance.total} classes · last 30 days`}
                          </p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles[metrics.attendance.band]}`}>
                          {bandLabels[metrics.attendance.band]}
                        </span>
                      </div>

                      {/* Behavior */}
                      <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">Behavior</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {metrics.behavior.log_count === 0
                              ? "You haven't logged any behavior notes this month."
                              : `${metrics.behavior.log_count} ${metrics.behavior.log_count === 1 ? 'log' : 'logs'} you recorded this month`}
                          </p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${bandStyles[metrics.behavior.band]}`}>
                          {bandLabels[metrics.behavior.band]}
                        </span>
                      </div>
                    </div>

                    {/* DSS — rule-based suggestions */}
                    {classHealth.suggestions?.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                          Suggested next steps
                        </p>
                        <ul className="space-y-2">
                          {classHealth.suggestions.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                s.severity === 'urgent'       ? 'bg-red-500'     :
                                s.severity === 'watch'        ? 'bg-amber-500'   :
                                s.severity === 'ok'           ? 'bg-emerald-500' :
                                                                'bg-slate-300'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <span>{s.text}</span>
                                {s.action && (
                                  <button
                                    onClick={() => runSuggestionAction(s.action)}
                                    className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                                  >
                                    {s.action.label || 'Open'} →
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })()
            )
          )}

          {/* Risk Assessment — admin only */}
          {!isTeacher && (
            risk ? (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Brain size={15} className="text-brand-500" /> Risk Assessment
                </h3>
                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  <RiskBadge level={risk.risk_level} />
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-slate-100 rounded-full">
                      <div
                        className={`h-full rounded-full ${risk.risk_level === 'High Risk' ? 'bg-red-500' : risk.risk_level === 'Moderate Risk' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${risk.risk_score * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono font-semibold">{(risk.risk_score * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 mb-4">{risk.recommendation}</div>
                {risk.factors?.length > 0 && (
                  <div className="space-y-2 overflow-y-auto flex-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contributing Factors</p>
                    {risk.factors.map((f, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold mt-0.5 ${f.severity === 'High' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {f.severity}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{f.factor}</p>
                          <p className="text-xs text-slate-500">{f.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="card p-8 text-center">
                <LoadingSpinner size="sm" />
                <p className="text-sm text-slate-400 mt-2">Analyzing student data...</p>
              </div>
            )
          )}

          {/* Empty state for teachers with no subjects/predictions */}
          {isTeacher && prediction && (!prediction.subjects || prediction.subjects.length === 0) && (
            <div className="card p-8 text-center text-sm text-slate-400">
              No predictions available for the subjects you teach this student yet. Record more grades to enable forecasts.
            </div>
          )}

          {/* Academic Predictions */}
          {prediction?.subjects?.map(subject => (
            <div key={subject.subject_id} className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">{subject.subject_name}</h3>
                <div className="flex items-center gap-2">
                  {subject.overall_trend === 'Improving' ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><TrendingUp size={14} /> Improving</span>
                  ) : subject.overall_trend === 'Declining' ? (
                    <span className="flex items-center gap-1 text-xs text-red-500 font-medium"><TrendingDown size={14} /> Declining</span>
                  ) : (
                    <span className="text-xs text-slate-400 font-medium">Stable</span>
                  )}
                </div>
              </div>

              {/* Grade chart */}
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={[
                  ...subject.historical_grades.map(h => ({ label: `Q${h.quarter}`, grade: h.grade, type: 'actual' })),
                  ...subject.predictions.map(p => ({ label: `Q${p.quarter} (pred)`, grade: p.predicted_grade, type: 'predicted' }))
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }} />
                  <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Passing', fontSize: 10, fill: '#f59e0b' }} />
                  <Line type="monotone" dataKey="grade" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4, fill: '#14b8a6' }} />
                </LineChart>
              </ResponsiveContainer>

              {subject.recommendation && (
                <div className="mt-3 text-sm text-slate-600 bg-brand-50 rounded-xl p-3 border border-brand-100">
                  {subject.recommendation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
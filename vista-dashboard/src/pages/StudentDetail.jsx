import { useState, useEffect, Fragment } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, ClipboardCheck, Heart, Brain, Users, Activity, TrendingUp, TrendingDown, MapPin, ChevronDown, ChevronRight, Info, Baby, Lock, Unlock, CalendarDays, Archive, ArchiveRestore, GraduationCap } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { studentApi, gradesApi, attendanceApi, behaviorApi, aiApi, eceApi, curriculumApi, enrollmentApi } from '../api/client'
import { resolveGradingPolicy, finalGradeFrom } from '../utils/grading'
import { GradeNumber, RemarksPill, DescriptorLabel } from '../components/GradeMarks'
import { SYStatusPill } from '../components/SchoolYearPicker'
import { RiskBadge, LoadingSpinner } from '../components/UI'
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
// One status per school day, rolled up from that day's subject records — see
// `rollUpDay`. Ordered by how much a day needs attention, worst last.
const DAY_STATUS = {
  present: { label: 'Present',       cls: 'bg-emerald-50 text-emerald-700' },
  late:    { label: 'Late',          cls: 'bg-amber-50 text-amber-700' },
  excused: { label: 'Excused',       cls: 'bg-blue-50 text-blue-700' },
  partly:  { label: 'Partly absent', cls: 'bg-orange-50 text-orange-700' },
  absent:  { label: 'Absent',        cls: 'bg-red-50 text-red-700' },
}
const RECORD_STATUS_KEY = { Present: 'present', Late: 'late', Excused: 'excused', Absent: 'absent' }

function DayStatusPill({ status, label }) {
  const meta = DAY_STATUS[status] || DAY_STATUS.present
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${meta.cls}`}>
      {label || meta.label}
    </span>
  )
}

function DayCounts({ counts }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {Object.keys(DAY_STATUS).filter(k => counts[k] > 0).map(k => (
        <DayStatusPill key={k} status={k} label={`${DAY_STATUS[k].label} ${counts[k]}`} />
      ))}
    </div>
  )
}

// Behavior tab pieces — the Behavior page's own vocabulary (category pill,
// tone badge, timeline entry), so an observation reads the same in both places.
// The raw sentiment score is not shown, as on that page: the label carries it.
const BEHAVIOR_CATEGORY_ICON = { Social: Users, Emotional: Heart, Academic: BookOpen, Physical: Activity }
const BEHAVIOR_TONE = {
  Positive: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  Neutral:  { badge: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400' },
  Negative: { badge: 'bg-red-50 text-red-700',         dot: 'bg-red-500' },
}

function ToneBadge({ sentiment, label }) {
  const t = BEHAVIOR_TONE[sentiment] || BEHAVIOR_TONE.Neutral
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${t.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
      {label || sentiment || 'Neutral'}
    </span>
  )
}

function ToneCounts({ counts }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {Object.keys(BEHAVIOR_TONE).filter(k => counts[k] > 0).map(k => (
        <ToneBadge key={k} sentiment={k} label={`${k} ${counts[k]}`} />
      ))}
    </div>
  )
}

function BehaviorChip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}>
      {children}
    </button>
  )
}

function BehaviorEntry({ log, mine }) {
  const at = new Date(log.observed_at)
  const Icon = BEHAVIOR_CATEGORY_ICON[log.category]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[84px_minmax(0,1fr)] gap-1.5 sm:gap-4">
      <div className="sm:pt-3.5 flex sm:block items-baseline gap-2">
        <p className="text-sm font-semibold text-slate-700">{format(at, 'MMM d')}</p>
        <p className="text-xs text-slate-400">{format(at, 'EEE · h:mm a')}</p>
      </div>
      <div className="border border-slate-100 rounded-xl px-4 py-3.5 space-y-2 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-slate-200 bg-white text-slate-600">
              {Icon && <Icon size={12} />}
              {log.category || 'Uncategorized'}
            </span>
            <ToneBadge sentiment={log.sentiment} />
            {log.sentiment_overridden && (
              <span className="text-[11px] font-medium text-slate-400"
                title={log.ai_sentiment ? `VISTA suggested ${log.ai_sentiment}` : 'VISTA could not check the tone when this was saved'}>
                Set by teacher
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400">
            {mine ? 'Logged by you' : log.teacher_name ? `By ${log.teacher_name}` : ''}
          </span>
        </div>
        <p className="text-sm leading-[22px] text-slate-600 whitespace-pre-line">{log.observation}</p>
      </div>
    </div>
  )
}

const subjectList = (records) => records.map(r => r.subject_name || 'a subject').join(', ')

// A school day's status from every subject record the viewer can see that day:
//   absent   every subject Absent
//   partly   some, not all, Absent — the case the dashboard flags as possible skipping
//   excused  every subject Excused
//   late     no absence, at least one Late
//   present  everything else (Present, possibly with an Excused subject)
// `note` says which subjects were affected, so the row reads without opening it.
function rollUpDay(records) {
  const n = records.length
  const by = (st) => records.filter(r => r.status === st)
  const absent = by('Absent'), late = by('Late'), excused = by('Excused')
  const allOf = (list) => list.length === n
  const allSubjects = n === 1 ? (records[0].subject_name || '1 subject') : `all ${n} subjects`
  if (allOf(absent))  return { status: 'absent',  note: `Absent in ${allSubjects}` }
  if (allOf(excused)) return { status: 'excused', note: `Excused in ${allSubjects}` }
  const parts = []
  if (absent.length)  parts.push(`Absent in ${subjectList(absent)}`)
  if (late.length)    parts.push(`Late in ${subjectList(late)}`)
  if (excused.length) parts.push(`Excused in ${subjectList(excused)}`)
  const status = absent.length ? 'partly' : late.length ? 'late' : 'present'
  const note = parts.length ? parts.join(' · ')
    : n === 1 ? (records[0].subject_name || '1 subject') : `All ${n} subjects`
  return { status, note }
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
  // Which learning areas have their areas *closed*, keyed "SY|||MAPEH" so the
  // same learning area folds independently in each school year. Areas start
  // open: MAPEH's grade is not self-explanatory without the four beneath it.
  const [collapsedAreas, setCollapsedAreas] = useState(() => new Set())
  const toggleAreas = (key) => setCollapsedAreas(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const [expandedAttSYs, setExpandedAttSYs] = useState(() => new Set())
  const [expandedAttMonths, setExpandedAttMonths] = useState(() => new Set())
  // Open school days on the Attendance tab, keyed "SY|||yyyy-MM-dd".
  const [expandedAttDays, setExpandedAttDays] = useState(() => new Set())
  const [expandedBehSYs, setExpandedBehSYs] = useState(() => new Set())
  const [expandedBehMonths, setExpandedBehMonths] = useState(() => new Set())
  // Category and tone filters live inside each open school-year card, so each
  // year keeps its own: { [sy]: { category, tone } }.
  const [behFilters, setBehFilters] = useState({})
  const behFilterFor = (sy) => ({ category: 'All', tone: 'All', ...(behFilters[sy] || {}) })
  const setBehFilter = (sy, patch) =>
    setBehFilters(prev => ({ ...prev, [sy]: { ...behFilterFor(sy), ...patch } }))

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

  // Where the learner sat in a given school year, for the Grades tab's year
  // header. Admins have the enrolment history; anyone else only knows the
  // active year, whose placement is the learner's own snapshot.
  const activeSYLabel = schoolYears.find(sy => sy.is_active)?.label
  const placementForSY = (label) => {
    const e = (enrollments || []).find(r => r.school_year === label)
    if (e) return { grade_level: e.grade_level, section: e.section }
    if (student && label === activeSYLabel) return { grade_level: student.grade_level, section: student.section }
    return null
  }

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

  // A general average counts every learning area of a year, so it may only be
  // shown to a viewer who is served all of them. `GET /api/grades` narrows a
  // teacher to the learning areas they teach, and widens it to the whole record
  // only for their advisee in the active year — an average over the rest would
  // look complete while missing most of the year.
  const seesWholeYear = (label) => !isTeacher || (isAdvisee && label === activeSYLabel)

  const toGrade = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

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
  const toggleAttDay       = toggleInSet(setExpandedAttDays)
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

  // Group grades by school year → learning area → period, with each learning
  // area carrying its areas. MAPEH is one row whose grade is the average of
  // Music, Arts, Physical Education and Health; those sit under it, revealed on
  // click, which is how an SF9 prints them and how the ECE tab below already
  // renders a subject with skills.
  const gradesBySY = grades.reduce((acc, g) => {
    const sy = g.school_year || '—'
    const area = g.parent_subject_name || g.subject_name
    if (!acc[sy]) acc[sy] = {}
    if (!acc[sy][area]) acc[sy][area] = { periods: {}, areas: {} }
    if (g.parent_subject_name) {
      const sub = acc[sy][area].areas
      if (!sub[g.subject_name]) sub[g.subject_name] = {}
      sub[g.subject_name][g.quarter] = g.grade
    } else {
      acc[sy][area].periods[g.quarter] = g.grade
    }
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
  //
  // Within a month the records are folded into **school days**: one row per
  // date, with a status rolled up from that day's subject records (`rollUpDay`).
  // Every count on the tab is in days, not records — eight subjects on one day
  // used to be eight rows and eight "Present".
  const emptyDayCounts = () => ({ present: 0, late: 0, excused: 0, partly: 0, absent: 0 })
  const attBySY = (() => {
    const acc = {}
    for (const r of attendance) {
      const sy = r.school_year || UNASSIGNED_SY
      const mk = monthKey(r.date)
      const dk = format(new Date(r.date), 'yyyy-MM-dd')
      acc[sy] ??= { counts: emptyDayCounts(), dayCount: 0, months: {} }
      acc[sy].months[mk] ??= { counts: emptyDayCounts(), days: {} }
      ;(acc[sy].months[mk].days[dk] ??= { records: [] }).records.push(r)
    }
    for (const year of Object.values(acc)) {
      for (const month of Object.values(year.months)) {
        for (const day of Object.values(month.days)) {
          day.records.sort((x, y) => (x.subject_name || '').localeCompare(y.subject_name || ''))
          Object.assign(day, rollUpDay(day.records))
          month.counts[day.status]++
          year.counts[day.status]++
          year.dayCount++
        }
      }
    }
    return acc
  })()
  // The Overview card counts the same school days as the Attendance tab, summed
  // across every year on record, so the two never disagree about a learner.
  const attDaySummary = Object.values(attBySY).reduce((sum, year) => {
    for (const [k, n] of Object.entries(year.counts)) sum[k] += n
    return sum
  }, emptyDayCounts())
  // Whether those days are whole school days or only the viewer's own subjects.
  // A subject teacher is served just the subjects they teach, so a day they see
  // as Absent may be one class missed, not a day away from school — the card
  // says which it is rather than letting the count read as the second.
  const attSummaryIsWholeDays = Object.keys(attBySY).every(
    sy => sy !== UNASSIGNED_SY ? seesWholeYear(sy) : !isTeacher
  )
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

  // Behavior: group by school year and month. The year is the one stamped on the
  // log when it was written, never read off the date — see the Attendance
  // grouping above for why the date cannot answer this. Grouping is unfiltered,
  // so the year header's tone counts describe the whole year; the month chips are
  // recounted at render from the entries the card's filters leave listed.
  const emptyToneCounts = () => ({ Positive: 0, Neutral: 0, Negative: 0 })
  const behBySY = behavior.reduce((acc, b) => {
    const sy = b.school_year || UNASSIGNED_SY
    const mk = monthKey(b.observed_at)
    const tone = b.sentiment || 'Neutral'
    acc[sy] ??= { total: 0, counts: emptyToneCounts(), months: {} }
    acc[sy].months[mk] ??= { logs: [], counts: emptyToneCounts() }
    acc[sy].months[mk].logs.push(b)
    acc[sy].months[mk].counts[tone] = (acc[sy].months[mk].counts[tone] || 0) + 1
    acc[sy].counts[tone] = (acc[sy].counts[tone] || 0) + 1
    acc[sy].total++
    return acc
  }, {})
  for (const year of Object.values(behBySY)) {
    for (const month of Object.values(year.months)) {
      month.logs.sort((x, y) => new Date(y.observed_at) - new Date(x.observed_at))
    }
  }
  const sortedBehSYs = Object.keys(behBySY).sort((a, b) => {
    if (a === UNASSIGNED_SY) return 1
    if (b === UNASSIGNED_SY) return -1
    return b.localeCompare(a)
  })
  const behMonthsOf = (sy) => Object.keys(behBySY[sy].months).sort().reverse()

  useEffect(() => {
    if (!sortedBehSYs.length) return
    if (sortedBehSYs.some(sy => expandedBehSYs.has(sy))) return
    const latestSY = sortedBehSYs[0]
    setExpandedBehSYs(new Set([latestSY]))
    setExpandedBehMonths(new Set([behMonthsOf(latestSY)[0]]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behavior])

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
              Attendance and behavior remain visible to the parent.
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

          {/* Home Address. Sits right after Student Information in the source so
              the stacked single-column layout reads the learner's details
              together; on lg: it moves behind the other two cards and spans the
              full width as its own row. */}
          {!isTeacher && (
            <div className="card p-5 lg:order-last lg:col-span-3">
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

          {/* Attendance summary. This card and Guardians take their height from
              the Student Information card beside them, through the grid row, so
              their content is absolutely positioned — but only on lg:. Stacked in
              one column there is no neighbour to stretch to, and an absolute body
              would leave each card zero pixels tall. */}
          <div className="card relative overflow-hidden">
            <div className="lg:absolute lg:inset-0 p-5 flex flex-col overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 flex-shrink-0">
              <ClipboardCheck size={15} className="text-brand-500" /> Attendance Summary
              <span className="ml-auto text-xs font-medium text-slate-400">
                {attSummaryIsWholeDays ? 'in school days' : 'in your subjects'}
              </span>
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Present',       count: attDaySummary.present, textColor: 'text-emerald-700', bg: 'bg-emerald-50' },
                { label: 'Partly absent', count: attDaySummary.partly,  textColor: 'text-orange-700',  bg: 'bg-orange-50'  },
                { label: 'Absent',        count: attDaySummary.absent,  textColor: 'text-red-700',     bg: 'bg-red-50'     },
                { label: 'Late',          count: attDaySummary.late,    textColor: 'text-amber-700',   bg: 'bg-amber-50'   },
                { label: 'Excused',       count: attDaySummary.excused, textColor: 'text-blue-700',    bg: 'bg-blue-50'    },
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
            <div className="lg:absolute lg:inset-0 p-5 flex flex-col overflow-hidden">
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
              const grading = gradingForSY(sy)
              const passing = grading.passingGrade
              const showDescriptor = !!grading.descriptorFor
              const syRow = schoolYears.find(s => s.label === sy)
              const placement = placementForSY(sy)
              const rows = Object.entries(gradesBySY[sy])
                .map(([name, entry]) => {
                  const periods = grading.periods.map(q => toGrade(entry.periods[q]))
                  const areas = Object.entries(entry.areas || {})
                    .map(([areaName, quarters]) => {
                      const ap = grading.periods.map(q => toGrade(quarters[q]))
                      return { name: areaName, periods: ap, final: finalGradeFrom(ap) }
                    })
                    .sort((a, b) => a.name.localeCompare(b.name))
                  return { name, periods, final: finalGradeFrom(periods), areas }
                })
                .sort((a, b) => a.name.localeCompare(b.name))
              // The general average counts every learning area of the year, so it
              // is shown only to a viewer who can see them all — see seesWholeYear.
              const whole = seesWholeYear(sy)
              const generalAverage = whole ? finalGradeFrom(rows.map(r => r.final)) : null
              const hasComposite = rows.some(r => r.areas.length > 0)
              return (
                <div key={sy} className="card overflow-hidden">
                  <button
                    onClick={() => toggleSY(sy)}
                    className={`w-full flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors ${isOpen ? 'border-b border-slate-100' : ''}`}
                  >
                    {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {sy === '—' ? 'No school year recorded' : `SY ${sy}`}
                        </span>
                        {syRow && <SYStatusPill sy={syRow} className="!text-[10px]" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[
                          placement && `${placement.grade_level}${placement.section ? ` · ${placement.section}` : ''}`,
                          `${grading.periodCount} ${grading.periodNoun.toLowerCase()}s`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {generalAverage !== null && (
                      <div className="ml-auto flex flex-wrap items-center gap-3">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">General average</span>
                        <GradeNumber grade={generalAverage} passing={passing} tone="final" />
                        {showDescriptor && <DescriptorLabel grade={generalAverage} grading={grading} />}
                        <RemarksPill grade={generalAverage} passing={passing} />
                      </div>
                    )}
                  </button>
                  {isOpen && (
                    <>
                      <div className="overflow-x-auto">
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th className="!pl-5">Learning area</th>
                              {grading.ordinals.map(o => <th key={o} className="!text-center">{o}</th>)}
                              <th className="!text-center border-l border-slate-100">Final grade</th>
                              {showDescriptor && <th className="!text-center">Descriptor</th>}
                              <th className="!text-center">Remarks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(r => {
                              const key = `${sy}|||${r.name}`
                              const composite = r.areas.length > 0
                              const open = composite && !collapsedAreas.has(key)
                              return (
                                <Fragment key={r.name}>
                                  <tr className={composite ? 'cursor-pointer' : undefined}
                                    onClick={composite ? () => toggleAreas(key) : undefined}>
                                    <td className="!pl-5 font-medium text-slate-800">
                                      <span className="flex items-center gap-1.5">
                                        {composite && (open
                                          ? <ChevronDown size={14} className="text-slate-400" />
                                          : <ChevronRight size={14} className="text-slate-400" />)}
                                        <span className="whitespace-nowrap">{r.name}</span>
                                        {composite && (
                                          <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
                                            avg. of {r.areas.length}
                                          </span>
                                        )}
                                      </span>
                                    </td>
                                    {r.periods.map((g, i) => (
                                      <td key={i} className="text-center"><GradeNumber grade={g} passing={passing} /></td>
                                    ))}
                                    <td className="text-center border-l border-slate-100"><GradeNumber grade={r.final} passing={passing} tone="final" /></td>
                                    {showDescriptor && <td className="text-center"><DescriptorLabel grade={r.final} grading={grading} /></td>}
                                    <td className="text-center"><RemarksPill grade={r.final} passing={passing} /></td>
                                  </tr>
                                  {open && r.areas.map(a => (
                                    <tr key={a.name} className="bg-slate-50/60">
                                      <td className="!pl-12 !py-2.5 text-[13px] text-slate-500 whitespace-nowrap">{a.name}</td>
                                      {a.periods.map((g, i) => (
                                        <td key={i} className="text-center !py-2.5"><GradeNumber grade={g} passing={passing} tone="muted" small /></td>
                                      ))}
                                      <td className="text-center !py-2.5 border-l border-slate-100"><GradeNumber grade={a.final} passing={passing} tone="muted" small /></td>
                                      {showDescriptor && <td className="!py-2.5" />}
                                      <td className="!py-2.5" />
                                    </tr>
                                  ))}
                                </Fragment>
                              )
                            })}
                            {generalAverage !== null && (
                              <tr className="bg-slate-50 hover:!bg-slate-50">
                                <td colSpan={grading.periodCount + 1} className="!pl-5 text-[13px] font-bold text-slate-800 border-t border-slate-200">
                                  General average
                                </td>
                                <td className="text-center border-t border-slate-200 border-l border-l-slate-100">
                                  <GradeNumber grade={generalAverage} passing={passing} tone="final" />
                                </td>
                                {showDescriptor && (
                                  <td className="text-center border-t border-slate-200"><DescriptorLabel grade={generalAverage} grading={grading} /></td>
                                )}
                                <td className="text-center border-t border-slate-200"><RemarksPill grade={generalAverage} passing={passing} /></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {(hasComposite || !whole) && (
                        <div className="px-5 py-3 space-y-1">
                          {hasComposite && (
                            <p className="flex items-center gap-2 text-xs text-slate-500">
                              <Info size={14} className="text-slate-400 flex-shrink-0" />
                              MAPEH’s areas are shown beneath it.
                            </p>
                          )}
                          {!whole && (
                            <p className="flex items-center gap-2 text-xs text-slate-500">
                              <Info size={14} className="text-slate-400 flex-shrink-0" />
                              Only the learning areas you teach are shown, so no general average is given.
                            </p>
                          )}
                        </div>
                      )}
                    </>
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
              const { counts: syCounts, dayCount, months } = attBySY[sy]
              const syRow = schoolYears.find(s => s.label === sy)
              const placement = sy === UNASSIGNED_SY ? null : placementForSY(sy)
              return (
                <div key={sy} className="card overflow-hidden">
                  <button
                    onClick={() => toggleAttSY(sy)}
                    className="w-full flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
                  >
                    {syOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {sy === UNASSIGNED_SY ? sy : `SY ${sy}`}
                        </span>
                        {syRow && <SYStatusPill sy={syRow} className="!text-[10px]" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[
                          placement && `${placement.grade_level}${placement.section ? ` · ${placement.section}` : ''}`,
                          `${dayCount} school ${dayCount === 1 ? 'day' : 'days'} recorded`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="ml-auto"><DayCounts counts={syCounts} /></div>
                  </button>

                  {syOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {attMonthsOf(sy).map(mk => {
                        const isOpen = expandedAttMonths.has(mk)
                        const { counts, days } = months[mk]
                        const dayKeys = Object.keys(days).sort().reverse()
                        return (
                          <div key={mk}>
                            <button
                              onClick={() => toggleAttMonth(mk)}
                              className="w-full flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-9 pr-5 py-2.5 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                            >
                              {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                              <span className="text-xs font-semibold text-slate-600">{formatMonth(mk)}</span>
                              <span className="text-xs text-slate-400">
                                {dayKeys.length} school {dayKeys.length === 1 ? 'day' : 'days'}
                              </span>
                              <div className="ml-auto"><DayCounts counts={counts} /></div>
                            </button>
                            {isOpen && (
                              <div className="overflow-x-auto border-t border-slate-100">
                                <table className="table-base">
                                  <thead>
                                    <tr>
                                      <th className="!pl-9 w-40">Date</th>
                                      <th className="w-40">Status</th>
                                      <th>Subjects</th>
                                      <th className="w-12" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dayKeys.map(dk => {
                                      const day = days[dk]
                                      const key = `${sy}|||${dk}`
                                      const dayOpen = expandedAttDays.has(key)
                                      return (
                                        <Fragment key={dk}>
                                          <tr
                                            onClick={() => toggleAttDay(key)}
                                            className={`cursor-pointer ${dayOpen ? '!bg-brand-50' : ''}`}
                                          >
                                            <td className="!pl-9 font-mono text-xs text-slate-700 whitespace-nowrap">
                                              {format(new Date(day.records[0].date), 'EEE, MMM d')}
                                            </td>
                                            <td><DayStatusPill status={day.status} /></td>
                                            <td className={`text-[13px] ${day.status === 'present' && !day.note.startsWith('Excused') ? 'text-slate-400' : 'text-slate-700'}`}>
                                              {day.note}
                                            </td>
                                            <td className="text-slate-400">
                                              {dayOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                            </td>
                                          </tr>
                                          {dayOpen && (
                                            <tr className="!bg-brand-50">
                                              <td colSpan={4} className="!pt-0 !pb-3.5 !pl-9 !pr-5">
                                                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                                  <table className="w-full text-sm">
                                                    <thead>
                                                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                                        <th className="px-4 py-2 text-left">Subject</th>
                                                        <th className="px-4 py-2 text-left w-36">Status</th>
                                                        <th className="px-4 py-2 text-left w-56">Recorded by</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {day.records.map(a => (
                                                        <tr key={a.id} className="border-b border-slate-50 last:border-0">
                                                          <td className="px-4 py-2 text-[13px] font-medium text-slate-800">{a.subject_name || '—'}</td>
                                                          <td className="px-4 py-2">
                                                            <DayStatusPill status={RECORD_STATUS_KEY[a.status] || 'present'} label={a.status} />
                                                          </td>
                                                          <td className="px-4 py-2 text-xs text-slate-400">
                                                            {isTeacher && a.recorded_by === user?.id ? 'You' : (a.recorded_by_name || '—')}
                                                          </td>
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {sy !== UNASSIGNED_SY && !seesWholeYear(sy) && (
                        <p className="px-5 py-3 flex items-center gap-2 text-xs text-slate-500">
                          <Info size={14} className="text-slate-400 flex-shrink-0" />
                          Only the subjects you teach are shown, so a day’s status covers those subjects only.
                        </p>
                      )}
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
            {sortedBehSYs.map(sy => {
              const syOpen = expandedBehSYs.has(sy)
              const { total, counts: syCounts, months } = behBySY[sy]
              const syRow = schoolYears.find(s => s.label === sy)
              const placement = sy === UNASSIGNED_SY ? null : placementForSY(sy)
              const filter = behFilterFor(sy)
              const filtering = filter.category !== 'All' || filter.tone !== 'All'
              const matches = (b) =>
                (filter.category === 'All' || b.category === filter.category) &&
                (filter.tone === 'All' || b.sentiment === filter.tone)
              const monthKeys = behMonthsOf(sy).filter(mk => !filtering || months[mk].logs.some(matches))
              return (
                <div key={sy} className="card overflow-hidden">
                  <button
                    onClick={() => toggleBehSY(sy)}
                    className={`w-full flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors ${syOpen ? 'border-b border-slate-100' : ''}`}
                  >
                    {syOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {sy === UNASSIGNED_SY ? sy : `SY ${sy}`}
                        </span>
                        {syRow && <SYStatusPill sy={syRow} className="!text-[10px]" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[
                          placement && `${placement.grade_level}${placement.section ? ` · ${placement.section}` : ''}`,
                          `${total} ${total === 1 ? 'observation' : 'observations'}`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="ml-auto"><ToneCounts counts={syCounts} /></div>
                  </button>

                  {syOpen && (
                    <>
                      <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500 mr-1">Show</span>
                          {['All', ...Object.keys(BEHAVIOR_CATEGORY_ICON)].map(c => (
                            <BehaviorChip key={c} active={filter.category === c}
                              onClick={() => setBehFilter(sy, { category: c })}>
                              {c}
                            </BehaviorChip>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {['All', 'Positive', 'Neutral', 'Negative'].map(t => (
                            <BehaviorChip key={t} active={filter.tone === t}
                              onClick={() => setBehFilter(sy, { tone: t })}>
                              {t === 'All' ? 'All tones' : t}
                            </BehaviorChip>
                          ))}
                        </div>
                      </div>

                      {monthKeys.length === 0 ? (
                        <p className="px-5 py-8 text-center text-sm text-slate-400 border-t border-slate-100">
                          No observations match these filters.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {monthKeys.map(mk => {
                            const isOpen = expandedBehMonths.has(mk)
                            const { logs } = months[mk]
                            const shown = logs.filter(matches)
                            // The month's tone chips follow the filter, so they
                            // always describe the entries listed beneath them.
                            const counts = shown.reduce((c, b) => {
                              const t = b.sentiment || 'Neutral'
                              c[t] = (c[t] || 0) + 1
                              return c
                            }, emptyToneCounts())
                            return (
                              <div key={mk}>
                                <button
                                  onClick={() => toggleBehMonth(mk)}
                                  className="w-full flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-9 pr-5 py-2.5 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                                >
                                  {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                  <span className="text-xs font-semibold text-slate-600">{formatMonth(mk)}</span>
                                  <span className="text-xs text-slate-400">
                                    {filtering
                                      ? `${shown.length} of ${logs.length} observations`
                                      : `${logs.length} ${logs.length === 1 ? 'observation' : 'observations'}`}
                                  </span>
                                  <div className="ml-auto"><ToneCounts counts={counts} /></div>
                                </button>
                                {isOpen && (
                                  <div className="pl-9 pr-5 pt-4 pb-5 space-y-3 border-t border-slate-100">
                                    {shown.map(b => (
                                      <BehaviorEntry key={b.id} log={b} mine={isTeacher && b.teacher_id === user?.id} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {sy !== UNASSIGNED_SY && !seesWholeYear(sy) && (
                        <p className="px-5 py-3 flex items-center gap-2 text-xs text-slate-500 border-t border-slate-100">
                          <Info size={14} className="text-slate-400 flex-shrink-0" />
                          Only your own observations are shown for this school year.
                        </p>
                      )}
                    </>
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
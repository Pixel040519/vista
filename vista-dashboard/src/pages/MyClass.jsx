/**
 * My Class — the section adviser's read-only view of their advisory class.
 *
 * Every other teacher page in the app is **one subject at a time**: Attendance,
 * Score Entry and the Grades sheet all pick a class and then a subject. That is
 * the right shape for a subject teacher and the wrong one for an adviser, whose
 * remit is the whole learner across every learning area. So this is a separate
 * page rather than a wider filter on the existing ones — and because the API
 * behind it exposes no writes, nothing here can enter a grade or a mark.
 *
 * The advisory comes from `advisory` on the auth payload, not from
 * `activeAssignments`: an adviser may well teach no subject in the class they
 * advise.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  GraduationCap, Users, ClipboardCheck, Heart, BookOpen,
  ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import { advisoryApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { LoadingSpinner, EmptyState, GradeChip } from '../components/UI'
import { RATING_TINT_CLASSES } from '../utils/ratingUi'
import { format } from 'date-fns'

const fullName = (s) =>
  `${s.surname}, ${s.first_name}${s.middle_name ? ` ${s.middle_name[0]}.` : ''}`

const BAND_PILL = {
  ok:           'bg-emerald-50 text-emerald-700',
  watch:        'bg-amber-50 text-amber-700',
  urgent:       'bg-red-50 text-red-700',
  insufficient: 'bg-slate-100 text-slate-500',
}
const BAND_LABEL = { ok: 'On track', watch: 'Watch', urgent: 'Urgent', insufficient: 'No data' }

// ── Tab bar (house idiom: bottom border + an `after:` underline) ──
function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex border-b border-slate-200 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={clsx(
            'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
            'after:absolute after:left-0 after:right-0 after:bottom-0 after:h-0.5',
            active === t.id
              ? 'text-brand-600 after:bg-brand-500'
              : 'text-slate-500 hover:text-slate-700 after:bg-transparent'
          )}>
          <t.icon size={15}/> {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Period picker, named from the school year's own model ──
function PeriodPicker({ grading, value, onChange }) {
  if (!grading) return null
  return (
    <div className="flex items-center gap-1.5">
      {grading.periods.map(p => (
        <button key={p} onClick={() => onChange(p)}
          className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
            value === p ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
          {/* Never a literal "Q" — a three-term year reads T1/T2/T3. */}
          {grading.period_model === '3T' ? 'T' : 'Q'}{p}
        </button>
      ))}
    </div>
  )
}

// ── Grades: learners down, every learning area across ──
function GradesTab({ sectionId, grading }) {
  const [quarter, setQuarter] = useState(grading?.periods?.[0] || 1)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    advisoryApi.grades({ section_id: sectionId, quarter })
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sectionId, quarter])

  const offLevel = (data?.subjects || []).filter(s => s.off_level)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker grading={grading} value={quarter} onChange={setQuarter}/>
        <p className="text-xs text-slate-400">
          Every learning area, including the ones you do not teach. Read-only.
        </p>
      </div>

      {/* A grade recorded against another grade level's subject inside the same
          school year — usually a mid-year placement change. Named rather than
          dropped, so the work is visible and the anomaly is noticeable. */}
      {offLevel.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5"/>
          <p className="text-xs text-amber-800">
            <span className="font-semibold">
              {offLevel.length} column{offLevel.length !== 1 ? 's' : ''} from another grade level
            </span>{' '}
            ({offLevel.map(s => `${s.name} · ${s.grade_level}`).join(', ')}). These grades were
            recorded this school year against a subject outside this class's grade level.
          </p>
        </div>
      )}

      {loading ? <LoadingSpinner/> : !data ? (
        <EmptyState icon={BookOpen} title="No grades to show"
          description="This class has no grade records for the selected period."/>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="whitespace-nowrap">#</th>
                <th className="whitespace-nowrap">Learner</th>
                {data.subjects.map(s => (
                  <th key={s.id} className="whitespace-nowrap text-center">
                    {s.name}
                    {s.off_level && <span className="ml-1 text-amber-500" title={`${s.grade_level} subject`}>*</span>}
                  </th>
                ))}
                <th className="whitespace-nowrap text-center">General Ave.</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s, i) => {
                const row = data.rows[i]
                return (
                  <tr key={s.id}>
                    <td className="text-slate-400 text-sm">{i + 1}</td>
                    <td>
                      <Link to={`/students/${s.id}`} className="text-sm font-medium text-slate-700 hover:text-brand-600">
                        {fullName(s)}
                      </Link>
                    </td>
                    {row.cells.map(c => (
                      <td key={c.subject_id} className="text-center"><GradeChip grade={c.grade}/></td>
                    ))}
                    <td className="text-center"><GradeChip grade={row.general_average}/></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Competency: the descriptive equivalent of the sheet above ──
function CompetencyTab({ sectionId, grading }) {
  const [quarter, setQuarter] = useState(grading?.periods?.[0] || 1)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    advisoryApi.competency({ section_id: sectionId, quarter })
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sectionId, quarter])

  // Always read the scale off the response — 'E' is Excellent on E/G/F/NA but
  // Emerging, the worst level, on A-E.
  const codes = data?.scale?.codes || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker grading={grading} value={quarter} onChange={setQuarter}/>
        {data?.scale && (
          <div className="flex items-center gap-1.5">
            {data.scale.levels.map(l => (
              <span key={l.code}
                className={clsx('px-2 py-0.5 rounded text-[11px] font-semibold', RATING_TINT_CLASSES[l.color])}
                title={l.label}>{l.code}</span>
            ))}
          </div>
        )}
      </div>

      {loading ? <LoadingSpinner/> : !data ? (
        <EmptyState icon={BookOpen} title="No competency records"
          description="Nothing has been rated for this class in the selected period."/>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="whitespace-nowrap">#</th>
                <th className="whitespace-nowrap">Learner</th>
                <th className="whitespace-nowrap text-center">Rated</th>
                {codes.map(c => <th key={c} className="whitespace-nowrap text-center">{c}</th>)}
                <th className="whitespace-nowrap text-center">Standing</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s, i) => {
                const row = data.rows[i]
                return (
                  <tr key={s.id}>
                    <td className="text-slate-400 text-sm">{i + 1}</td>
                    <td>
                      <Link to={`/students/${s.id}`} className="text-sm font-medium text-slate-700 hover:text-brand-600">
                        {fullName(s)}
                      </Link>
                    </td>
                    <td className="text-center text-sm text-slate-600">
                      {row.rated}/{row.total_skills}
                    </td>
                    {codes.map(c => (
                      <td key={c} className="text-center text-sm text-slate-600">
                        {row.distribution[c] || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className="text-center">
                      <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-semibold', BAND_PILL[row.band])}>
                        {BAND_LABEL[row.band]}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Attendance: the register, across every subject ──
function AttendanceTab({ sectionId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    advisoryApi.attendance({ section_id: sectionId })
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sectionId])

  if (loading) return <LoadingSpinner/>
  if (!data) return <EmptyState icon={ClipboardCheck} title="No attendance records"/>

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        All subjects for this school year. Expand a learner for the per-subject breakdown —
        that is where a partial day (present in one subject, absent in another) shows up.
      </p>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="whitespace-nowrap">Learner</th>
              <th className="whitespace-nowrap text-center">Present</th>
              <th className="whitespace-nowrap text-center">Absent</th>
              <th className="whitespace-nowrap text-center">Late</th>
              <th className="whitespace-nowrap text-center">Excused</th>
              <th className="whitespace-nowrap text-center">Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s, i) => {
              const row = data.rows[i]
              const isOpen = open === s.id
              return [
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setOpen(isOpen ? null : s.id)}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {isOpen ? <ChevronDown size={14} className="text-slate-400"/>
                              : <ChevronRight size={14} className="text-slate-400"/>}
                      <span className="text-sm font-medium text-slate-700">{fullName(s)}</span>
                    </div>
                  </td>
                  <td className="text-lg text-sm text-emerald-700">{row.counts.Present}</td>
                  <td className="text-lg text-sm text-red-700">{row.counts.Absent}</td>
                  <td className="text-lg text-sm text-amber-700">{row.counts.Late}</td>
                  <td className="text-lg text-sm text-blue-700">{row.counts.Excused}</td>
                  <td className="text-lg text-sm font-semibold text-slate-700">
                    {row.rate === null ? <span className="text-slate-300">—</span>
                      : `${Math.round(row.rate * 100)}%`}
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${s.id}-detail`}>
                    <td colSpan={6} className="bg-slate-50 px-5 py-3">
                      {row.by_subject.length === 0 ? (
                        <p className="text-xs text-slate-400">No attendance recorded yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {row.by_subject.map(b => (
                            <span key={b.subject_name}
                              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs">
                              <span className="font-medium text-slate-700">{b.subject_name}</span>
                              <span className="text-emerald-700">P{b.counts.Present}</span>
                              <span className="text-red-700">A{b.counts.Absent}</span>
                              <span className="text-amber-700">L{b.counts.Late}</span>
                              <span className="text-blue-700">E{b.counts.Excused}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Behavior: every teacher's observations, not just your own ──
//
// Grouped **by learner**, not chronological. A flat feed answers "what happened
// most recently", which is the wrong question here: an adviser is looking at a
// whole class over a whole year, so a term's worth of logs becomes a scroll with
// no shape and one learner's pattern is spread across dozens of cards. One
// collapsed row per learner keeps the class on a single screen and puts the
// count and sentiment mix — the thing that decides who needs attention — in
// front of the observations rather than behind them.
const SENTIMENT_STYLE = {
  Positive: { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Neutral:  { dot: 'bg-slate-400',   pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  Negative: { dot: 'bg-red-500',     pill: 'bg-red-50 text-red-700 border-red-200' },
}
const SENTIMENTS = ['Positive', 'Neutral', 'Negative']
const CATEGORIES = ['Social', 'Emotional', 'Academic', 'Physical']

function BehaviorTab({ sectionId, myId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [sentiment, setSentiment] = useState('')
  const [category, setCategory]   = useState('')
  const [open, setOpen]           = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    // Filtering is client-side over one load so the chips are instant and their
    // counts stay stable — a count that changes when you click it cannot be used
    // to compare. 300 is the API's own cap.
    advisoryApi.behavior({ section_id: sectionId, limit: 300 })
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sectionId])

  const logs = data?.logs || []

  // Counts for the chips come off the *unfiltered* set, minus whatever the other
  // control has narrowed to — so each chip still reports what selecting it gives.
  const sentimentCounts = useMemo(() => {
    const base = category ? logs.filter(l => l.category === category) : logs
    const c = { Positive: 0, Neutral: 0, Negative: 0 }
    for (const l of base) if (l.sentiment in c) c[l.sentiment]++
    return { ...c, total: base.length }
  }, [logs, category])

  const filtered = useMemo(() => logs.filter(l =>
    (!sentiment || l.sentiment === sentiment) && (!category || l.category === category)
  ), [logs, sentiment, category])

  // One group per learner who has a matching log. Learners with none are left
  // out of the list and counted underneath instead — an empty row per learner
  // would be most of the class and none of the information.
  const groups = useMemo(() => {
    const byStudent = new Map()
    for (const s of data?.students || []) {
      byStudent.set(s.id, { student: s, logs: [], counts: { Positive: 0, Neutral: 0, Negative: 0 }, latest: null })
    }
    for (const l of filtered) {
      const g = byStudent.get(l.student_id)
      if (!g) continue
      g.logs.push(l)
      if (l.sentiment in g.counts) g.counts[l.sentiment]++
      if (!g.latest || new Date(l.observed_at) > new Date(g.latest)) g.latest = l.observed_at
    }
    return [...byStudent.values()]
      .filter(g => g.logs.length)
      // Triage order: most negative first, then most logged, then by name. The
      // learner an adviser needs to look at is the one being flagged, and an
      // alphabetical list buries them.
      .sort((a, b) =>
        b.counts.Negative - a.counts.Negative ||
        b.logs.length - a.logs.length ||
        a.student.surname.localeCompare(b.student.surname))
  }, [data, filtered])

  const withNone = (data?.students?.length || 0) - groups.length

  if (loading) return <LoadingSpinner/>
  if (!data || !logs.length) {
    return <EmptyState icon={Heart} title="No observations yet"
      description="Behaviour logged by any teacher for this class will appear here."/>
  }

  const chip = (label, value, count, style) => (
    <button key={label} onClick={() => setSentiment(value)}
      className={clsx('px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
        sentiment === value
          ? (style || 'bg-slate-800 text-white border-slate-800')
          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300')}>
      {label} <span className="opacity-70">· {count}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Observations from <span className="font-medium">every</span> teacher of this class this
        school year — conduct is the adviser's responsibility, so this is not limited to your own.
        Learners with the most negative observations are listed first.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {chip('All', '', sentimentCounts.total)}
        {SENTIMENTS.map(s => chip(s, s, sentimentCounts[s], SENTIMENT_STYLE[s].pill))}
        <select className="input !w-auto text-xs py-1.5 ml-auto"
          value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={Heart} title="No observations match these filters"
          description="Clear the sentiment or category filter to see the rest."/>
      ) : (
        <div className="space-y-1.5">
          {groups.map(g => {
            const isOpen = open === g.student.id
            return (
              <div key={g.student.id} className="rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => setOpen(isOpen ? null : g.student.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors">
                  {isOpen ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0"/>
                          : <ChevronRight size={15} className="text-slate-400 flex-shrink-0"/>}
                  <span className="text-sm font-medium text-slate-700 truncate flex-1">
                    {fullName(g.student)}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {SENTIMENTS.map(s => g.counts[s] > 0 && (
                      <span key={s}
                        className={clsx('px-1.5 py-0.5 rounded text-[11px] font-semibold border', SENTIMENT_STYLE[s].pill)}
                        title={`${g.counts[s]} ${s.toLowerCase()}`}>
                        {g.counts[s]}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 w-24 text-right flex-shrink-0 hidden sm:block">
                    {g.latest ? format(new Date(g.latest), 'MMM d, yyyy') : ''}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100 bg-slate-50/50">
                    {g.logs.map(l => (
                      <div key={l.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0',
                            SENTIMENT_STYLE[l.sentiment]?.dot || 'bg-slate-300')}/>
                          <span className="text-xs text-slate-500">
                            {l.observed_at && format(new Date(l.observed_at), 'MMM d, yyyy')}
                            {l.category && <> · {l.category}</>}
                            {' · '}
                            {l.teacher_id === myId
                              ? <span className="text-brand-600 font-medium">Logged by you</span>
                              : l.teacher_name}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 mt-1">{l.observation}</p>
                      </div>
                    ))}
                    <div className="px-4 py-2">
                      <Link to={`/students/${g.student.id}`}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700">
                        Open student record →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-400">
        {groups.length} of {data.students.length} learner{data.students.length !== 1 ? 's' : ''} have
        observations{withNone > 0 && <> · {withNone} with none</>}
        {data.total > logs.length && <> · showing the {logs.length} most recent of {data.total}</>}
      </p>
    </div>
  )
}

// ── Class list ──
function ClassListTab({ students }) {
  if (!students.length) {
    return <EmptyState icon={Users} title="No learners enrolled"
      description="Nobody is enrolled in this section for the active school year."/>
  }
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th className="whitespace-nowrap">#</th>
            <th className="whitespace-nowrap">Learner</th>
            <th className="whitespace-nowrap">LRN</th>
            <th className="whitespace-nowrap">Sex</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, i) => (
            <tr key={s.id}>
              <td className="text-slate-400 text-sm">{i + 1}</td>
              <td>
                <Link to={`/students/${s.id}`} className="text-sm font-medium text-slate-700 hover:text-brand-600">
                  {fullName(s)}
                </Link>
              </td>
              <td className="text-sm text-slate-500 font-mono">{s.lrn || '—'}</td>
              <td className="text-sm text-slate-500">{s.gender || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MyClass() {
  const { user, advisory } = useAuth()
  // The uniqueness index caps an adviser at one section per school year, so this
  // selects rather than offers a picker. If that rule is ever relaxed, a class
  // dropdown goes here.
  const section = advisory?.[0] || null

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('classlist')

  const load = useCallback(async () => {
    if (!section) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await advisoryApi.classList({ section_id: section.id })
      setData(r.data)
    } catch { setData(null) } finally { setLoading(false) }
  }, [section?.id]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  if (!section) {
    return (
      <div className="animate-fade-in">
        <h1 className="page-title">My Class</h1>
        <div className="mt-6">
          <EmptyState icon={GraduationCap} title="You are not a class adviser"
            description="An administrator assigns advisers on the Curriculum page. Your teaching assignments are unaffected."/>
        </div>
      </div>
    )
  }

  if (loading) return <LoadingSpinner/>
  if (!data) {
    return (
      <div className="animate-fade-in">
        <h1 className="page-title">My Class</h1>
        <div className="mt-6">
          <EmptyState icon={AlertTriangle} title="Could not load your class"
            description="Try again in a moment."/>
        </div>
      </div>
    )
  }

  const descriptive = data.assessment.is_descriptive
  const tabs = [
    { id: 'classlist',  label: 'Class List', icon: Users },
    descriptive
      ? { id: 'competency', label: 'Competency', icon: BookOpen }
      : { id: 'grades',     label: 'Grades',     icon: BookOpen },
    { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
    { id: 'behavior',   label: 'Behavior',   icon: Heart },
  ]

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <GraduationCap size={22} className="text-brand-600"/>
            {data.section.grade_level} · {data.section.name}
          </h1>
          <p className="page-subtitle">
            You are the class adviser · SY {data.section.school_year} ·{' '}
            {data.students.length} learner{data.students.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab}/>

      <div>
        {tab === 'classlist'  && <ClassListTab students={data.students}/>}
        {tab === 'grades'     && <GradesTab sectionId={section.id} grading={data.grading}/>}
        {tab === 'competency' && <CompetencyTab sectionId={section.id} grading={data.grading}/>}
        {tab === 'attendance' && <AttendanceTab sectionId={section.id}/>}
        {tab === 'behavior'   && <BehaviorTab sectionId={section.id} myId={user?.id}/>}
      </div>
    </div>
  )
}

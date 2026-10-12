// ============================================================
// ATTENDANCE PAGE
// ============================================================
import { formatName, nameInitial } from '../utils/nameHelper'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { attendanceApi, studentApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState } from '../components/UI'
import { useAuth } from '../context/AuthContext'
import { ClipboardCheck, Search, Save } from 'lucide-react'
import { format, startOfWeek, startOfMonth } from 'date-fns'
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
  const [loaded, setLoaded]     = useState({})  // records as last loaded or saved — the diff baseline
  const [date, setDate]         = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [subjects, setSubjects]           = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const pendingDeepLinkSubject = useRef(initialDeepLink?.selectedSubject || '')
  const appliedDeepLinkTs = useRef(initialDeepLink?.ts || 0)

  // Loading or clearing the marks moves the baseline with them; only a
  // teacher's click may move one without the other.
  const resetRecords = (r) => { setRecords(r); setLoaded(r) }

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
    resetRecords({})
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
    if (!selectedSection || !date || !selectedSubject) { resetRecords({}); return }
    const [grade_level, section] = selectedSection.split('|||')
    attendanceApi.bulk({ date, grade_level, section, subject_id: selectedSubject })
      .then(res => resetRecords(res.data.records || {}))
      .catch(() => resetRecords({}))
  }, [selectedSection, date, selectedSubject])

  const filtered = students.filter(s =>
    formatName(s).toLowerCase().includes(search.toLowerCase()) ||
    (s.lrn || '').toLowerCase().includes(search.toLowerCase())
  )

  // How many marks differ from what was loaded — drives the save bar. A cleared
  // mark counts too, which is why both sides are walked.
  const dirtyCount = useMemo(() => {
    const ids = new Set([...Object.keys(records), ...Object.keys(loaded)])
    return [...ids].filter(id => records[id] !== loaded[id]).length
  }, [records, loaded])

  const setStatus = (id, status) => setRecords(p => {
    if (p[id] === status) { const { [id]: _, ...rest } = p; return rest }
    return { ...p, [id]: status }
  })

  const handleSave = async () => {
    const saved = records
    const toSubmit = Object.entries(records).map(([student_id, status]) => ({
      student_id, date, status, subject_id: selectedSubject
    }))
    if (toSubmit.length === 0) return toast.error('No attendance marked yet.')
    setSaving(true)
    try {
      await attendanceApi.submit(toSubmit)
      toast.success(`Attendance saved for ${toSubmit.length} students.`)
      setLoaded(saved)
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
    <div className="space-y-5 animate-fade-in pb-24">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Mark and track daily attendance</p>
        </div>
        <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} />
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

      {/* Sticky save bar */}
      {dirtyCount > 0 && (
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-30 bg-white border-t border-slate-200 shadow-lg animate-slide-up">
          <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">
              {dirtyCount} unsaved mark{dirtyCount === 1 ? '' : 's'}
              <span className="text-slate-500 font-normal">
                {' '}&middot; {currentSection.join(' — ')}
                {' '}&middot; {subjects.find(s => s.id === selectedSubject)?.name || 'Subject'}
                {' '}&middot; {date}
              </span>
            </span>
            <button onClick={() => setRecords(loaded)} disabled={saving}
              className="ml-auto btn-secondary text-sm disabled:opacity-60">Discard</button>
            <button onClick={handleSave} disabled={saving}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
              <Save size={15} /> {saving ? 'Saving...' : 'Save Attendance'}
            </button>
          </div>
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
import { Heart, Plus as PlusIcon, Pencil, Trash2, Smile, Meh, Frown, X as XIcon, Users, Activity, Calendar, Clock, Check, ChevronDown, ChevronLeft, ChevronRight, ArrowUpRight, Eye } from 'lucide-react'
import { Link as RouterLink } from 'react-router-dom'
// Both lived under the Grades page's imports before it moved to Grades.jsx.
import { BookOpen } from 'lucide-react'
import clsx from 'clsx'

export function Behavior() {
  const { user } = useAuth()
  return user?.role === 'teacher' ? <TeacherBehavior /> : <AdminBehavior />
}

// ─── Teacher view — class roster + learner timeline ──────────
// Picking a class lists every learner in it at once, each with the tally of
// observations the teacher can see, so there is nothing to search before the
// page is useful. Picking a learner opens their record grouped by month.
const BEHAVIOR_CATEGORIES = [
  { value: 'Social',    icon: Users,    description: 'Getting along with classmates and teachers' },
  { value: 'Emotional', icon: Heart,    description: 'Feelings, mood and self-control' },
  { value: 'Academic',  icon: BookOpen, description: 'Participation, focus and work habits' },
  { value: 'Physical',  icon: Activity, description: 'Health, energy and movement' },
]
const CATEGORY_ICON = Object.fromEntries(BEHAVIOR_CATEGORIES.map(c => [c.value, c.icon]))

const SENTIMENTS = ['Positive', 'Neutral', 'Negative']
const SENTIMENT_TONE = {
  Positive: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', text: 'text-emerald-700', icon: Smile },
  Neutral:  { badge: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400',   text: 'text-slate-600',   icon: Meh },
  Negative: { badge: 'bg-red-50 text-red-700',         dot: 'bg-red-500',     text: 'text-red-700',     icon: Frown },
}

// `sentiment` is the tone the teacher picked; '' means "use VISTA's suggestion".
const EMPTY_OBSERVATION = { observation: '', category: 'Social', observed_at: '', sentiment: '' }

const shortDate = (value) => {
  const d = new Date(value)
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

// Pass `log` for a saved observation: a tone the teacher picked over VISTA's
// suggestion is marked, so nobody reads it as the analyzer's call.
function ToneBadge({ sentiment, log }) {
  const label = log ? log.sentiment : sentiment
  const tone = SENTIMENT_TONE[label] || SENTIMENT_TONE.Neutral
  const badge = (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', tone.badge)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', tone.dot)} />
      {label || 'Neutral'}
    </span>
  )
  if (!log?.sentiment_overridden) return badge
  return (
    <span className="inline-flex items-center gap-1.5">
      {badge}
      <span className="text-[11px] font-medium text-slate-400"
        title={log.ai_sentiment ? `VISTA suggested ${log.ai_sentiment}` : 'VISTA could not check the tone when this was saved'}>
        Set by teacher
      </span>
    </span>
  )
}

function CategoryPill({ category }) {
  const Icon = CATEGORY_ICON[category]
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-slate-200 bg-white text-slate-600">
      {Icon && <Icon size={12} />}
      {category || 'Uncategorized'}
    </span>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={clsx(
        'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
        active ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
      )}>
      {children}
    </button>
  )
}

function ClassPicker({ sections, value, counts, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = sections.find(s => s.key === value)
  const learners = key => counts[key] == null ? null : `${counts[key]} ${counts[key] === 1 ? 'learner' : 'learners'}`

  return (
    <div ref={ref} className="relative w-full sm:w-[300px]">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={clsx('input flex items-center justify-between gap-2 text-left', open && 'ring-2 ring-brand-500/30 border-brand-500')}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-slate-800 truncate">
            {current ? `${current.grade_level} — ${current.section}` : 'Choose a class'}
          </span>
          {current && learners(current.key) && (
            <span className="text-xs font-medium px-1.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
              {learners(current.key)}
            </span>
          )}
        </span>
        <ChevronDown size={16} className={clsx('flex-shrink-0 transition-transform', open ? 'rotate-180 text-brand-500' : 'text-slate-500')} />
      </button>

      {open && (
        <div role="listbox" className="absolute left-0 right-0 top-full mt-1.5 z-30 card shadow-xl p-1.5 space-y-0.5 max-h-72 overflow-y-auto">
          {sections.map(s => {
            const selected = s.key === value
            return (
              <button key={s.key} type="button" role="option" aria-selected={selected}
                onClick={() => { onChange(s.key); setOpen(false) }}
                className={clsx(
                  'w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-[10px] text-left transition-colors',
                  selected ? 'bg-brand-50' : 'hover:bg-slate-50'
                )}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={clsx('text-sm truncate', selected ? 'font-semibold text-brand-700' : 'font-medium text-slate-800')}>
                    {s.grade_level} — {s.section}
                  </span>
                  {learners(s.key) && <span className="text-xs text-slate-400 whitespace-nowrap">{learners(s.key)}</span>}
                </span>
                {selected && <Check size={16} className="text-brand-500 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RosterRow({ learner, selected, onSelect }) {
  const observed = learner.total > 0
  return (
    <button type="button" onClick={onSelect} aria-current={selected || undefined}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
        selected ? 'bg-brand-50' : 'hover:bg-slate-50'
      )}>
      <div className={clsx(
        'w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0',
        selected ? 'bg-brand-100 text-brand-700' : 'bg-brand-50 text-brand-600'
      )}>
        {nameInitial(learner)}
      </div>
      <div className="flex-1 min-w-0">
        <p className={clsx('text-sm truncate', selected ? 'font-semibold text-brand-700' : 'font-medium text-slate-800')}>
          {formatName(learner)}
        </p>
        <p className={clsx('text-xs', observed ? 'text-slate-400' : 'text-amber-700')}>
          {observed
            ? `${learner.total} ${learner.total === 1 ? 'observation' : 'observations'} · last ${shortDate(learner.last_observed_at)}`
            : 'No observations yet'}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {SENTIMENTS.map(s => {
          const count = learner[s.toLowerCase()]
          if (!count) return null
          return (
            <span key={s} title={`${count} ${s.toLowerCase()}`}
              className={clsx('inline-flex items-center gap-1 text-xs font-semibold', SENTIMENT_TONE[s].text)}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', SENTIMENT_TONE[s].dot)} />
              {count}
            </span>
          )
        })}
      </div>
    </button>
  )
}

function TimelineEntry({ log, canEdit, onEdit, onDelete }) {
  const at = new Date(log.observed_at)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[84px_minmax(0,1fr)] gap-1.5 sm:gap-4">
      <div className="sm:pt-3.5 flex sm:block items-baseline gap-2">
        <p className="text-sm font-semibold text-slate-700">{format(at, 'MMM d')}</p>
        <p className="text-xs text-slate-400">{format(at, 'EEE · h:mm a')}</p>
      </div>
      <div className="border border-slate-100 rounded-xl px-4 py-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryPill category={log.category} />
            <ToneBadge log={log} />
          </div>
          {canEdit ? (
            <div className="flex items-center gap-0.5 -mr-2">
              <button type="button" onClick={onEdit}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                <Pencil size={13} /> Edit
              </button>
              <button type="button" onClick={onDelete}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                <Trash2 size={13} /> Delete
              </button>
            </div>
          ) : log.teacher_name && (
            <span className="text-xs text-slate-400">By {log.teacher_name}</span>
          )}
        </div>
        <p className="text-sm leading-[22px] text-slate-600 whitespace-pre-line">{log.observation}</p>
      </div>
    </div>
  )
}

// VISTA suggests the tone from the wording; the teacher can pick another when it
// misreads what happened. `chosen` is '' while following the suggestion. Picking
// the suggested tone is agreement — the API does not record it as a change.
function ToneChooser({ tone, chosen, onChoose }) {
  const suggested = tone.sentiment || null
  const selected = chosen || suggested
  const overriding = chosen && chosen !== suggested

  let note
  if (overriding) {
    note = suggested
      ? <>You chose <b>{chosen}</b>. VISTA suggested {suggested}.</>
      : <>You chose <b>{chosen}</b>.</>
  } else if (tone.status === 'checking') {
    note = 'Checking the tone…'
  } else if (suggested) {
    note = "Suggested from your wording. Pick another if it doesn't match what happened."
  } else if (tone.status === 'unavailable') {
    note = "The tone couldn't be checked right now. Pick one, or VISTA will check it when you save."
  } else {
    note = 'VISTA suggests a tone from your wording as you type.'
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">How does it read?</p>
      <div className="grid grid-cols-3 gap-2">
        {SENTIMENTS.map(s => {
          const t = SENTIMENT_TONE[s]
          const Icon = t.icon
          const on = selected === s
          return (
            <button key={s} type="button" aria-pressed={on} onClick={() => onChoose(s)}
              className={clsx(
                'relative flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-sm font-medium transition-colors',
                on ? clsx(t.badge, 'border-current ring-1 ring-current') : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              )}>
              <Icon size={18} />
              {s}
              {suggested === s && (
                <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Suggested</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1" aria-live="polite">
        <p className="text-xs text-slate-500">{note}</p>
        {overriding && (
          <button type="button" onClick={() => onChoose('')}
            className="text-xs font-medium text-brand-600 hover:text-brand-700">
            {suggested ? 'Use suggestion' : 'Clear'}
          </button>
        )}
      </div>
    </div>
  )
}

function TeacherBehavior() {
  const { user, activeAssignments } = useAuth()

  const sections = useMemo(() => {
    const map = new Map()
    for (const a of activeAssignments || []) {
      const key = `${a.grade_level}|||${a.section}`
      if (!map.has(key)) map.set(key, { key, grade_level: a.grade_level, section: a.section })
    }
    return [...map.values()].sort(
      (a, b) => a.grade_level.localeCompare(b.grade_level) || a.section.localeCompare(b.section)
    )
  }, [activeAssignments])

  const [selectedSection, setSelectedSection] = useState('')
  const [rosters, setRosters]         = useState({})   // section key → learners with tallies
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterSearch, setRosterSearch]   = useState('')
  const [unobservedOnly, setUnobservedOnly] = useState(false)

  const [studentId, setStudentId]     = useState('')
  const [logs, setLogs]               = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)

  const [showLog, setShowLog]         = useState(false)
  const [editingId, setEditingId]     = useState(null)
  const [form, setForm]               = useState(EMPTY_OBSERVATION)
  const [whenMode, setWhenMode]       = useState('now')
  const [tone, setTone]               = useState({ status: 'idle' })
  const [submitting, setSubmitting]   = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const panelRef = useRef(null)
  const latestStudent = useRef('')

  const loadRoster = (key) => {
    const s = sections.find(x => x.key === key)
    if (!s) return Promise.resolve()
    return behaviorApi.classRoster({ grade_level: s.grade_level, section: s.section })
      .then(res => setRosters(prev => ({ ...prev, [key]: res.data.students || [] })))
      .catch(() => {})
  }

  // Every class is loaded up front: a teacher holds only a handful, and it
  // lets the class dropdown show each one's learner count.
  useEffect(() => {
    if (sections.length === 0) return
    if (!sections.some(s => s.key === selectedSection)) setSelectedSection(sections[0].key)
    setRosterLoading(true)
    Promise.all(sections.map(s => loadRoster(s.key))).finally(() => setRosterLoading(false))
  }, [sections])

  const changeSection = (key) => {
    if (key === selectedSection) return
    setSelectedSection(key)
    latestStudent.current = ''
    setStudentId('')
    setLogs([])
    setRosterSearch('')
    setUnobservedOnly(false)
    setCategoryFilter('')
  }

  const currentSection = sections.find(s => s.key === selectedSection)
  const roster = rosters[selectedSection] || []
  const student = roster.find(s => s.id === studentId)
  const unobservedCount = roster.filter(s => s.total === 0).length
  const rosterCounts = useMemo(
    () => Object.fromEntries(Object.entries(rosters).map(([k, v]) => [k, v.length])),
    [rosters]
  )

  const visibleRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase()
    return roster.filter(s =>
      (!unobservedOnly || s.total === 0) &&
      (!q || formatName(s).toLowerCase().includes(q) || (s.lrn || '').includes(q))
    )
  }, [roster, rosterSearch, unobservedOnly])

  const fetchLogs = async (sid) => {
    latestStudent.current = sid
    setLogsLoading(true)
    try {
      const res = await behaviorApi.get({ student_id: sid, limit: 200 })
      if (latestStudent.current === sid) setLogs(res.data.logs || [])
    } catch {
      if (latestStudent.current === sid) setLogs([])
    }
    if (latestStudent.current === sid) setLogsLoading(false)
  }

  const selectStudent = (sid) => {
    setStudentId(sid)
    setCategoryFilter('')
    setLogs([])
    fetchLogs(sid)
    // Stacked layout: the record opens below the list, out of view.
    if (window.innerWidth < 1024) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  const tally = useMemo(() => {
    const t = { total: logs.length, Positive: 0, Neutral: 0, Negative: 0 }
    for (const b of logs) if (b.sentiment in t) t[b.sentiment]++
    return t
  }, [logs])

  const summary = useMemo(() => {
    if (tally.total === 0) return null
    const lead = SENTIMENTS.find(s => tally[s] > tally.total / 2)
    const headline = lead
      ? `Mostly ${lead.toLowerCase()} so far.`
      : 'A mix of positive, neutral and negative notes so far.'
    const lastNegative = logs.find(b => b.sentiment === 'Negative')   // logs arrive newest first
    const detail = lastNegative
      ? `The last negative note was on ${format(new Date(lastNegative.observed_at), 'MMM d, yyyy')}${lastNegative.category ? ` (${lastNegative.category})` : ''}.`
      : 'No negative notes recorded.'
    return { headline, detail }
  }, [logs, tally])

  const timeline = useMemo(() => {
    const filtered = logs.filter(b => !categoryFilter || b.category === categoryFilter)
    const ordered = newestFirst ? filtered : [...filtered].reverse()
    const groups = []
    for (const b of ordered) {
      const label = format(new Date(b.observed_at), 'MMMM yyyy')
      const last = groups[groups.length - 1]
      if (last?.label === label) last.logs.push(b)
      else groups.push({ label, logs: [b] })
    }
    return groups
  }, [logs, categoryFilter, newestFirst])

  // Live tone preview while the form is open, debounced so it follows pauses in
  // typing rather than every keystroke. The saved tone is still computed server-side.
  useEffect(() => {
    if (!showLog) return
    const text = form.observation.trim()
    if (!text) { setTone({ status: 'idle' }); return }
    let cancelled = false
    const handle = setTimeout(() => {
      setTone(t => ({ ...t, status: 'checking' }))
      aiApi.sentiment(text)
        .then(res => {
          if (cancelled) return
          const sentiment = res.data?.sentiment
          setTone(sentiment ? { status: 'done', sentiment } : { status: 'unavailable' })
        })
        .catch(() => { if (!cancelled) setTone({ status: 'unavailable' }) })
    }, 700)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [form.observation, showLog])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_OBSERVATION)
    setWhenMode('now')
    setTone({ status: 'idle' })
    setShowLog(true)
  }

  const openEdit = (b) => {
    setEditingId(b.id)
    // A tone the teacher picked opens still picked; otherwise it follows VISTA.
    // The suggestion shown is VISTA's own reading, never the saved override.
    setForm({
      observation: b.observation, category: b.category || 'Social', observed_at: '',
      sentiment: b.sentiment_overridden ? b.sentiment : '',
    })
    setTone(b.ai_sentiment ? { status: 'done', sentiment: b.ai_sentiment } : { status: 'idle' })
    setShowLog(true)
  }

  const closeLog = () => {
    setShowLog(false)
    setEditingId(null)
  }

  const refreshAfterWrite = () => {
    fetchLogs(studentId)
    loadRoster(selectedSection)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const observation = form.observation.trim()
    if (!observation) return
    if (!editingId && whenMode === 'earlier' && !form.observed_at) {
      toast.error('Pick the date and time it happened.')
      return
    }
    // Sent only when the teacher picked one; left out, the API uses VISTA's reading.
    const chosen = form.sentiment ? { sentiment: form.sentiment } : {}
    setSubmitting(true)
    try {
      if (editingId) {
        await behaviorApi.update(editingId, { observation, category: form.category, ...chosen })
        toast.success('Observation updated.')
      } else {
        await behaviorApi.log({
          student_id: studentId,
          observation,
          category: form.category,
          observed_at: whenMode === 'earlier' ? form.observed_at : '',
          ...chosen,
        })
        toast.success('Observation saved.')
      }
      closeLog()
      refreshAfterWrite()
    } catch {}
    setSubmitting(false)
  }

  const confirmDelete = async () => {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    if (!id) return
    try {
      await behaviorApi.delete(id)
      toast.success('Observation deleted.')
      refreshAfterWrite()
    } catch {}
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">Behavior Monitoring</h1>
        <p className="page-subtitle">Record what you notice about your learners and look back on it any time</p>
      </div>

      {sections.length === 0 ? (
        <div className="card">
          <EmptyState icon={Heart} title="No assigned classes"
            description="You have no teaching assignments for the active school year." />
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Class</p>
            <ClassPicker sections={sections} value={selectedSection} counts={rosterCounts} onChange={changeSection} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5 items-start">
            {/* Learners in the class */}
            <div className="card flex flex-col">
              <div className="p-4 pb-3 space-y-3 border-b border-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-semibold text-slate-900">Learners</p>
                  {currentSection && (
                    <p className="text-xs text-slate-400 truncate">{currentSection.grade_level} — {currentSection.section}</p>
                  )}
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input pl-10" placeholder="Search name or LRN"
                    value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <FilterChip active={!unobservedOnly} onClick={() => setUnobservedOnly(false)}>
                    All · {roster.length}
                  </FilterChip>
                  <FilterChip active={unobservedOnly} onClick={() => setUnobservedOnly(true)}>
                    Not yet observed · {unobservedCount}
                  </FilterChip>
                </div>
              </div>

              <div className="p-2 space-y-0.5 overflow-y-auto max-h-[420px] lg:max-h-[640px]">
                {rosterLoading && !rosters[selectedSection] ? (
                  <LoadingSpinner size="sm" />
                ) : roster.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-slate-400">No enrolled learners in this class.</p>
                ) : visibleRoster.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-slate-400">
                    {unobservedOnly && !rosterSearch.trim()
                      ? 'You have observed every learner in this class.'
                      : 'No learners match your search.'}
                  </p>
                ) : visibleRoster.map(s => (
                  <RosterRow key={s.id} learner={s} selected={s.id === studentId} onSelect={() => selectStudent(s.id)} />
                ))}
              </div>

              <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {SENTIMENTS.map(s => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className={clsx('w-1.5 h-1.5 rounded-full', SENTIMENT_TONE[s].dot)} />{s}
                  </span>
                ))}
              </div>
            </div>

            {/* The selected learner's record */}
            <div ref={panelRef} className="card scroll-mt-20">
              {!student ? (
                <EmptyState icon={Heart} title="Choose a learner"
                  description="Pick a learner from the list to see your observations about them and log a new one." />
              ) : (
                <>
                  <div className="px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-lg font-semibold flex-shrink-0">
                        {nameInitial(student)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-lg font-semibold text-slate-900 truncate">{formatName(student)}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          {student.lrn && <span>LRN {student.lrn}</span>}
                          {currentSection && <span>{currentSection.grade_level} — {currentSection.section}</span>}
                          <RouterLink to={`/students/${student.id}`}
                            className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">
                            Open student profile <ArrowUpRight size={12} />
                          </RouterLink>
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={openCreate} className="btn-primary justify-center">
                      <PlusIcon size={16} /> Log observation
                    </button>
                  </div>

                  {logsLoading ? (
                    <LoadingSpinner />
                  ) : tally.total === 0 ? (
                    <EmptyState icon={Heart} title="No observations yet"
                      description={`You haven't logged anything about ${student.first_name || 'this learner'} yet.`}
                      action={
                        <button type="button" onClick={openCreate} className="btn-primary">
                          <PlusIcon size={16} /> Log the first observation
                        </button>
                      } />
                  ) : (
                    <>
                      <div className="px-4 sm:px-6 py-5 space-y-3 border-b border-slate-100">
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold">{summary.headline}</span>{' '}
                          <span className="text-slate-500">{summary.detail}</span>
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            ['All observations', tally.total, 'text-slate-900'],
                            ['Positive', tally.Positive, SENTIMENT_TONE.Positive.text],
                            ['Neutral', tally.Neutral, SENTIMENT_TONE.Neutral.text],
                            ['Negative', tally.Negative, SENTIMENT_TONE.Negative.text],
                          ].map(([label, value, color]) => (
                            <div key={label} className="px-4 py-3 rounded-xl bg-slate-50">
                              <p className="text-xs text-slate-500">{label}</p>
                              <p className={clsx('text-xl font-bold mt-0.5', color)}>{value}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500 mr-1">Show</span>
                          <FilterChip active={!categoryFilter} onClick={() => setCategoryFilter('')}>All</FilterChip>
                          {BEHAVIOR_CATEGORIES.map(c => (
                            <FilterChip key={c.value} active={categoryFilter === c.value} onClick={() => setCategoryFilter(c.value)}>
                              {c.value}
                            </FilterChip>
                          ))}
                        </div>
                        <select value={newestFirst ? 'newest' : 'oldest'}
                          onChange={e => setNewestFirst(e.target.value === 'newest')}
                          aria-label="Sort observations"
                          className="self-start sm:self-auto text-xs font-medium text-slate-600 bg-transparent border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30">
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                        </select>
                      </div>

                      <div className="px-4 sm:px-6 pt-5 pb-6 space-y-5">
                        {timeline.length === 0 ? (
                          <p className="py-8 text-center text-sm text-slate-400">
                            No {categoryFilter} observations for this learner.
                          </p>
                        ) : timeline.map(g => (
                          <div key={g.label} className="space-y-3">
                            <div className="flex items-center gap-3">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{g.label}</p>
                              <div className="flex-1 h-px bg-slate-100" />
                            </div>
                            {g.logs.map(b => (
                              <TimelineEntry key={b.id} log={b}
                                canEdit={b.teacher_id === user?.id}
                                onEdit={() => openEdit(b)}
                                onDelete={() => setDeleteTarget(b)} />
                            ))}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <Modal open={showLog} onClose={closeLog} title={editingId ? 'Edit observation' : 'Log observation'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          {student && (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-slate-50">
              <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {nameInitial(student)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{formatName(student)}</p>
                {currentSection && <p className="text-xs text-slate-400">{currentSection.grade_level} — {currentSection.section}</p>}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="behavior-observation" className="block text-sm font-medium text-slate-700">
              What did you observe? <span className="text-red-500">*</span>
            </label>
            <textarea id="behavior-observation" className="input min-h-28 resize-none"
              placeholder="e.g. Shared materials with classmates during group work"
              value={form.observation}
              onChange={e => setForm(p => ({ ...p, observation: e.target.value }))}
              required />
            <p className="text-xs text-slate-400">Describe what the learner did. Specific actions are easier to look back on later.</p>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-slate-700">What is it mostly about?</p>
              <p className="text-xs text-slate-400 mt-0.5">Pick the closest one.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {BEHAVIOR_CATEGORIES.map(c => {
                const selected = form.category === c.value
                const Icon = c.icon
                return (
                  <button key={c.value} type="button" aria-pressed={selected}
                    onClick={() => setForm(p => ({ ...p, category: c.value }))}
                    className={clsx(
                      'flex items-start gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors',
                      selected ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    )}>
                    <span className={clsx(
                      'w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0',
                      selected ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'
                    )}>
                      <Icon size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={clsx('block text-sm font-semibold', selected ? 'text-brand-700' : 'text-slate-800')}>{c.value}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{c.description}</span>
                    </span>
                    {selected && (
                      <span className="w-[18px] h-[18px] rounded-full bg-brand-500 text-white flex items-center justify-center flex-shrink-0">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {!editingId && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">When did it happen?</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex p-1 rounded-xl bg-slate-100 gap-1">
                  {[['now', Clock, 'Just now'], ['earlier', Calendar, 'Earlier']].map(([mode, Icon, label]) => (
                    <button key={mode} type="button" aria-pressed={whenMode === mode}
                      onClick={() => setWhenMode(mode)}
                      className={clsx(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        whenMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      )}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
                {whenMode === 'now' ? (
                  <p className="text-xs text-slate-400">Saved with the date and time you press Save</p>
                ) : (
                  <input type="datetime-local" className="input sm:w-auto" required
                    max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                    value={form.observed_at}
                    onChange={e => setForm(p => ({ ...p, observed_at: e.target.value }))} />
                )}
              </div>
            </div>
          )}

          <ToneChooser tone={tone} chosen={form.sentiment}
            onChoose={s => setForm(p => ({ ...p, sentiment: s }))} />

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={closeLog} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? 'Saving...' : editingId ? 'Update observation' : 'Save observation'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete this observation?" size="sm">
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
              <Trash2 size={18} />
            </div>
            <p className="text-sm text-slate-700">
              This removes the observation from {student ? formatName(student) : 'this learner'}'s record. It can't be undone.
            </p>
          </div>
          <div className="flex gap-3 pt-1 border-t border-slate-100">
            <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="button" onClick={confirmDelete} className="btn-danger flex-1 justify-center">Delete</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Admin view — school-wide read-only log ──────────────────
// One filter card, tone tabs that double as the summary counts, rows that show
// the observation itself, and a side panel for the full record. Nothing here
// writes: behaviour logs are the teachers' to record.
const EMPTY_BEHAVIOR_FILTERS = {
  student_id: '', grade_level: '', section: '', category: '', sentiment: '',
}
const BEHAVIOR_PAGE_SIZE = 50
const BEHAVIOR_PERIODS = [
  { value: 'week',  label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year',  label: 'This school year' },
]

// "This school year" filters on the year each log was stamped with rather than a
// date range: consecutive years can leave gaps and overlaps, so a date cannot say
// which year an observation belongs to. With no active year it filters nothing.
function periodParams(period, activeYear) {
  const today = new Date()
  if (period === 'week')  return { date_from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
  if (period === 'month') return { date_from: format(startOfMonth(today), 'yyyy-MM-dd') }
  return activeYear ? { school_year_id: activeYear.id } : {}
}

function SidePanel({ open, onClose, title, footer, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={title}
        className="relative w-full sm:max-w-[520px] h-full bg-white shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <XIcon size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5">{children}</div>
        {footer && <div className="flex gap-3 px-4 sm:px-6 py-4 border-t border-slate-100 flex-shrink-0">{footer}</div>}
      </aside>
    </div>,
    document.body
  )
}

function ToneTab({ label, count, dot, active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={clsx(
        'flex flex-col gap-0.5 px-4 py-2.5 rounded-xl border text-left sm:min-w-[128px] transition-colors',
        active ? 'bg-brand-500 border-brand-500' : 'bg-white border-slate-200 hover:bg-slate-50'
      )}>
      <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', active ? 'text-white/80' : 'text-slate-500')}>
        {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', dot)} />}
        {label}
      </span>
      <span className={clsx('text-xl font-bold', active ? 'text-white' : 'text-slate-900')}>{count ?? 0}</span>
    </button>
  )
}

function AdminBehavior() {
  const [filters, setFilters] = useState(EMPTY_BEHAVIOR_FILTERS)
  const [period, setPeriod]   = useState('year')
  const [activeYear, setActiveYear]   = useState(null)
  const [yearsLoaded, setYearsLoaded] = useState(false)
  const [offset, setOffset]   = useState(0)
  const [logs, setLogs]       = useState([])
  const [total, setTotal]     = useState(0)
  const [summary, setSummary] = useState({ total: 0, positive: 0, neutral: 0, negative: 0 })
  const [loading, setLoading] = useState(false)
  const [studentResults, setStudentResults] = useState([])
  const [sections, setSections] = useState([])
  const [studentSearch, setStudentSearch] = useState('')
  const [detailLog, setDetailLog] = useState(null)
  const [history, setHistory] = useState({ loading: false, logs: [] })

  useEffect(() => {
    curriculumApi.getSections()
      .then(res => setSections(res.data.sections || []))
      .catch(() => {})
    curriculumApi.getSchoolYears()
      .then(res => setActiveYear((res.data.school_years || []).find(y => y.is_active) || null))
      .catch(() => {})
      .finally(() => setYearsLoaded(true))
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

  // Both dropdowns read the sections list rather than a grade constant of their
  // own: the API already orders it by grade level and scopes it to the caller,
  // so a scoped admin is offered only the grades they may manage.
  const gradeLevels = useMemo(
    () => [...new Set(sections.map(s => s.grade_level))],
    [sections]
  )
  const sectionOptions = useMemo(
    () => sections.filter(s => s.grade_level === filters.grade_level),
    [sections, filters.grade_level]
  )

  // Everything except tone. The tone tabs' counts come from this, so picking
  // "Negative" does not zero out the other three tabs.
  const scopeParams = useMemo(() => {
    const out = periodParams(period, activeYear)
    for (const k of ['student_id', 'grade_level', 'section', 'category']) {
      if (filters[k]) out[k] = filters[k]
    }
    return out
  }, [filters.student_id, filters.grade_level, filters.section, filters.category, period, activeYear])

  const listParams = useMemo(
    () => (filters.sentiment ? { ...scopeParams, sentiment: filters.sentiment } : scopeParams),
    [scopeParams, filters.sentiment]
  )

  useEffect(() => { setOffset(0) }, [listParams])

  useEffect(() => {
    if (!yearsLoaded) return
    let cancelled = false
    behaviorApi.summary(scopeParams)
      .then(res => { if (!cancelled) setSummary(res.data || {}) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [scopeParams, yearsLoaded])

  useEffect(() => {
    if (!yearsLoaded) return
    let cancelled = false
    setLoading(true)
    behaviorApi.get({ ...listParams, limit: BEHAVIOR_PAGE_SIZE, offset })
      .then(res => {
        if (cancelled) return
        setLogs(res.data.logs || [])
        setTotal(res.data.total || 0)
      })
      .catch(() => { if (!cancelled) { setLogs([]); setTotal(0) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [listParams, offset, yearsLoaded])

  // The side panel's "this learner" section: the same learner's observations in
  // the year the opened one was recorded in.
  useEffect(() => {
    if (!detailLog) return
    let cancelled = false
    setHistory({ loading: true, logs: [] })
    const params = { student_id: detailLog.student_id, limit: 200 }
    if (detailLog.school_year_id) params.school_year_id = detailLog.school_year_id
    behaviorApi.get(params)
      .then(res => { if (!cancelled) setHistory({ loading: false, logs: res.data.logs || [] }) })
      .catch(() => { if (!cancelled) setHistory({ loading: false, logs: [] }) })
    return () => { cancelled = true }
  }, [detailLog?.id])

  const patch = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const hasFilters = Object.values(filters).some(Boolean)
  const clearFilters = () => {
    setFilters(EMPTY_BEHAVIOR_FILTERS)
    setStudentSearch('')
    setStudentResults([])
  }

  const showAllForLearner = (b) => {
    setFilters({
      ...EMPTY_BEHAVIOR_FILTERS,
      student_id: b.student_id,
      grade_level: b.grade_level || '',
      section: b.section || '',
    })
    setStudentSearch(formatName(b))
    setStudentResults([])
    setDetailLog(null)
  }

  const historyTally = useMemo(() => {
    const t = { Positive: 0, Neutral: 0, Negative: 0 }
    for (const b of history.logs) if (b.sentiment in t) t[b.sentiment]++
    return t
  }, [history.logs])
  const otherLogs = history.logs.filter(b => b.id !== detailLog?.id).slice(0, 3)

  const closeDetail = () => setDetailLog(null)
  const firstShown = total === 0 ? 0 : offset + 1
  const lastShown = Math.min(offset + BEHAVIOR_PAGE_SIZE, total)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Behavior Monitoring</h1>
          <p className="page-subtitle">Every observation teachers have recorded, across the school. View only.</p>
        </div>
        <div role="tablist" aria-label="Period" className="inline-flex self-start sm:self-auto p-1 rounded-xl bg-slate-100 gap-1">
          {BEHAVIOR_PERIODS.map(p => (
            <button key={p.value} type="button" role="tab" aria-selected={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors',
                period === p.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4 space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3">
          <div className="relative">
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Learner</label>
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-10" placeholder="Search name or LRN"
                value={studentSearch}
                onChange={e => {
                  setStudentSearch(e.target.value)
                  if (filters.student_id) {
                    setFilters(f => ({ ...f, student_id: '', grade_level: '', section: '' }))
                  }
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            </div>
            {studentResults.length > 0 && !filters.student_id && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 card shadow-xl p-1 max-h-60 overflow-y-auto">
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
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                    <span className="block text-sm font-medium text-slate-800">{formatName(s)}</span>
                    <span className="block text-xs text-slate-400">
                      {s.grade_level} — {s.section}{s.lrn && ` · LRN ${s.lrn}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Grade level</label>
            <select className="input disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
              disabled={!!filters.student_id}
              value={filters.grade_level}
              onChange={e => setFilters(f => ({ ...f, grade_level: e.target.value, section: '' }))}>
              <option value="">All grade levels</option>
              {gradeLevels.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Section</label>
            <select className="input disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
              disabled={!!filters.student_id || !filters.grade_level}
              value={filters.section}
              onChange={e => patch('section', e.target.value)}>
              <option value="">All sections</option>
              {sectionOptions.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Category</label>
            <select className="input" value={filters.category} onChange={e => patch('category', e.target.value)}>
              <option value="">All categories</option>
              {BEHAVIOR_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
          </div>
        </div>

        <div className="h-px bg-slate-100" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2.5">
            <ToneTab label="All observations" count={summary.total}
              active={!filters.sentiment} onClick={() => patch('sentiment', '')} />
            {SENTIMENTS.map(s => (
              <ToneTab key={s} label={s} count={summary[s.toLowerCase()]} dot={SENTIMENT_TONE[s].dot}
                active={filters.sentiment === s} onClick={() => patch('sentiment', s)} />
            ))}
          </div>
          <div className="flex items-center gap-3 lg:justify-end">
            {hasFilters && (
              <button type="button" onClick={clearFilters}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap flex items-center gap-1">
                <XIcon size={12} /> Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
          <p className="text-base font-semibold text-slate-900">
            {total} {total === 1 ? 'observation' : 'observations'}
            <span className="text-sm font-normal text-slate-400"> · newest first</span>
          </p>
          <p className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Eye size={14} className="text-slate-400" /> Click a row to read the full observation
          </p>
        </div>

        {loading ? <LoadingSpinner /> : logs.length === 0 ? (
          <EmptyState icon={Heart} title="No observations found"
            description={hasFilters ? 'No observations match these filters for this period.' : 'No observations have been recorded for this period.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Observation</th>
                    <th>Recorded by</th>
                    <th>When</th>
                    <th className="w-10"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(b => {
                    const at = new Date(b.observed_at)
                    const selected = detailLog?.id === b.id
                    return (
                      <tr key={b.id} tabIndex={0}
                        onClick={() => setDetailLog(b)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailLog(b) } }}
                        className={clsx('cursor-pointer focus:outline-none focus-visible:bg-brand-50', selected && '!bg-brand-50')}>
                        <td className="align-top whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-[13px] font-semibold flex-shrink-0">
                              {nameInitial(b)}
                            </div>
                            <div>
                              <RouterLink to={`/students/${b.student_id}`} onClick={e => e.stopPropagation()}
                                className="font-medium text-brand-600 hover:text-brand-700">
                                {formatName(b)}
                              </RouterLink>
                              <p className="text-xs text-slate-400">{b.grade_level} — {b.section}</p>
                            </div>
                          </div>
                        </td>
                        <td className="align-top min-w-[320px]">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <CategoryPill category={b.category} />
                              <ToneBadge log={b} />
                            </div>
                            <p className="text-sm leading-[22px] text-slate-600 line-clamp-2">{b.observation}</p>
                          </div>
                        </td>
                        <td className="align-top whitespace-nowrap">
                          <p className="text-sm text-slate-700">{b.teacher_name}</p>
                          {b.subject && <p className="text-xs text-slate-400 max-w-[200px] truncate">{b.subject}</p>}
                        </td>
                        <td className="align-top whitespace-nowrap">
                          <p className="text-sm text-slate-700">{shortDate(b.observed_at)}</p>
                          <p className="text-xs text-slate-400">{format(at, 'EEE · h:mm a')}</p>
                        </td>
                        <td className="align-middle">
                          <ChevronRight size={16} className={selected ? 'text-brand-500' : 'text-slate-300'} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Showing {firstShown}–{lastShown} of {total}</p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - BEHAVIOR_PAGE_SIZE))}>
                  <ChevronLeft size={16} /> Previous
                </button>
                <button type="button" className="btn-secondary px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={offset + BEHAVIOR_PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + BEHAVIOR_PAGE_SIZE)}>
                  Next <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <SidePanel open={!!detailLog} onClose={closeDetail} title="Observation"
        footer={detailLog && (
          <>
            <button type="button" onClick={() => showAllForLearner(detailLog)} className="btn-secondary flex-1 justify-center">
              Show all for this learner
            </button>
            <button type="button" onClick={closeDetail} className="btn-primary flex-1 justify-center">Close</button>
          </>
        )}>
        {detailLog && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-base font-semibold flex-shrink-0">
                {nameInitial(detailLog)}
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900 truncate">{formatName(detailLog)}</p>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                  {detailLog.lrn && <span>LRN {detailLog.lrn}</span>}
                  <span>{detailLog.grade_level} — {detailLog.section}</span>
                  <RouterLink to={`/students/${detailLog.student_id}`}
                    className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">
                    Student profile <ArrowUpRight size={12} />
                  </RouterLink>
                </div>
              </div>
            </div>

            <div className="px-4 py-3.5 rounded-xl bg-slate-50 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryPill category={detailLog.category} />
                <ToneBadge log={detailLog} />
              </div>
              <p className="text-[15px] leading-6 text-slate-800 whitespace-pre-wrap select-text">{detailLog.observation}</p>
            </div>

            <dl className="grid grid-cols-2 gap-4">
              {[
                ['Recorded by', detailLog.teacher_name || '—'],
                ['Teaches this class', detailLog.subject || '—'],
                ['Date & time', format(new Date(detailLog.observed_at), 'EEE, MMM d, yyyy · h:mm a')],
                ['School year', detailLog.school_year || 'Not recorded'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="text-sm text-slate-800 mt-1">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="text-sm font-semibold text-slate-900">
                {detailLog.school_year ? `This learner in SY ${detailLog.school_year}` : 'This learner'}
              </p>
              {history.loading ? <LoadingSpinner size="sm" /> : (
                <>
                  <div className="flex flex-wrap items-center gap-3 pt-1.5 pb-3 text-xs text-slate-500">
                    <span>
                      <strong className="font-semibold text-slate-900">{history.logs.length}</strong>{' '}
                      {history.logs.length === 1 ? 'observation' : 'observations'}
                    </span>
                    {SENTIMENTS.map(s => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <span className={clsx('w-1.5 h-1.5 rounded-full', SENTIMENT_TONE[s].dot)} />
                        {historyTally[s]} {s.toLowerCase()}
                      </span>
                    ))}
                  </div>
                  {otherLogs.length === 0 ? (
                    <p className="text-xs text-slate-400">No other observations for this learner.</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-slate-500 pb-1.5">Other observations</p>
                      {otherLogs.map(o => (
                        <div key={o.id} className="flex gap-3 py-2.5 border-t border-slate-100">
                          <p className="w-14 flex-shrink-0 text-xs font-semibold leading-5 text-slate-700">{shortDate(o.observed_at)}</p>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <ToneBadge log={o} />
                              <span className="text-xs text-slate-400 truncate">{o.teacher_name}</span>
                            </div>
                            <p className="text-[13px] leading-5 text-slate-600 truncate">{o.observation}</p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </SidePanel>
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
                    <td className="text-xs text-slate-400">{s.assessed_at ? format(new Date(s.assessed_at), 'MMM d, h:mm a') : '—'}</td>
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

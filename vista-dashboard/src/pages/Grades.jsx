import { useState, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  BookOpen, Layers, Search, List, LayoutGrid, Info, X,
  ChevronLeft, ChevronRight, ChevronDown, ArrowUpRight, AlertTriangle,
} from 'lucide-react'
import { curriculumApi, gradesApi, scoreApi } from '../api/client'
import { LoadingSpinner, EmptyState } from '../components/UI'
import { useAuth } from '../context/AuthContext'
import { formatName } from '../utils/nameHelper'
import { resolveGradingPolicy, finalGradeFrom, DO15_2026_DESCRIPTORS } from '../utils/grading'

// ============================================================
// GRADES PAGE
// ============================================================
// Two views over one class. **By subject** is the grading sheet for one
// learning area; **All subjects** lays every learning area side by side and
// opens any learner's whole record. Teachers only ever get the first — the
// class record endpoint is admin-only, and an adviser's cross-subject view is
// My Class.
//
// Remarks (Passed/Failed) sit beside the final grade under every grading
// policy. The descriptor column is shown only where the policy has one
// (`grading.descriptorFor`) — DO 015 and zero-based years, not DO 8. Both sit
// beside whichever grade a table calls its final: the year's final grade and
// the general average, or on Grade Summary the selected period's Final. Period
// cells beside a final stay numbers, which is what keeps the sheet readable.

// Male, then Female, like the DepEd class record. A learner with no gender on
// file still gets a group of their own at the end: gender is nullable, and a
// Male/Female filter alone would drop them from the sheet without a trace.
function groupByGender(rows, genderOf) {
  const groups = [
    { label: 'MALE', students: rows.filter(r => genderOf(r) === 'Male') },
    { label: 'FEMALE', students: rows.filter(r => genderOf(r) === 'Female') },
    { label: 'NO GENDER RECORDED', students: rows.filter(r => !['Male', 'Female'].includes(genderOf(r))) },
  ]
  return groups.filter(g => g.students.length)
}

const toGrade = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

const matchesSearch = (student, q) => {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  return formatName(student).toLowerCase().includes(needle) || (student.lrn || '').includes(needle)
}

// Rank-ordered, best first — the same order as DO15_2026_DESCRIPTORS.
const DESCRIPTOR_DOTS = ['bg-emerald-500', 'bg-brand-400', 'bg-slate-400', 'bg-amber-500', 'bg-red-500']

// ── Small pieces ─────────────────────────────────────────────

function Field({ label, className, children }) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1.5">{label}</label>
      {children}
    </div>
  )
}

function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className="inline-flex max-w-full gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-all',
            size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {o.icon && <o.icon size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({ label, value, note, danger }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{label}</p>
      <p className="flex items-baseline gap-1.5">
        <span className={clsx('font-mono text-xl font-semibold', danger ? 'text-red-500' : 'text-slate-900')}>{value}</span>
        {note && <span className="text-xs text-slate-400 whitespace-nowrap">{note}</span>}
      </p>
    </div>
  )
}

function SearchBox({ value, onChange }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        className="input !py-2 pl-9"
        placeholder="Search learner"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </div>
  )
}

// `tone`: 'final' is the grade that counts (teal), 'plain' a period or area grade.
function GradeNumber({ grade, passing, tone = 'plain', small = false }) {
  if (grade === null) return <span className={clsx('font-mono text-slate-300', small ? 'text-[13px]' : 'text-sm')}>—</span>
  const failing = grade < passing
  return (
    <span className={clsx(
      'font-mono', small ? 'text-[13px]' : 'text-sm',
      failing ? 'text-red-500 font-semibold'
        : tone === 'final' ? 'text-teal-600 font-bold'
        : tone === 'muted' ? 'text-slate-500'
        : 'text-slate-700'
    )}>
      {grade}
    </span>
  )
}

function RemarksPill({ grade, passing }) {
  if (grade === null) return <span className="text-slate-300 text-xs">—</span>
  const passed = grade >= passing
  return (
    <span className={clsx(
      'inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
    )}>
      {passed ? 'PASSED' : 'FAILED'}
    </span>
  )
}

function DescriptorLabel({ grade, grading }) {
  if (grade === null || !grading.descriptorFor) return <span className="text-slate-300 text-xs">—</span>
  const d = grading.descriptorFor(grade)
  const rank = DO15_2026_DESCRIPTORS.findIndex(x => x.label === d.label)
  return (
    <span
      title={d.response}
      className={clsx(
        'inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap',
        grade < grading.passingGrade ? 'text-red-600' : 'text-slate-700'
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', DESCRIPTOR_DOTS[rank] || 'bg-slate-300')} />
      {d.label}
    </span>
  )
}

const GroupRow = ({ label, colSpan }) => (
  <tr>
    <td colSpan={colSpan} className="bg-slate-50 !px-5 !py-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-y border-slate-200">
      {label}
    </td>
  </tr>
)

const NoMatchRow = ({ colSpan, search }) => (
  <tr>
    <td colSpan={colSpan} className="!py-8 text-center text-sm text-slate-400">
      No learners match “{search.trim()}”.
    </td>
  </tr>
)

// ── Page ─────────────────────────────────────────────────────

export default function Grades() {
  const { user, activeAssignments } = useAuth()
  const isTeacher = user?.role === 'teacher'
  const assignments = activeAssignments || []

  // ── View state ─────────────────────────────────────────────
  // `view` is 'subject' or 'all'; a teacher is always on 'subject'.
  const [view, setView]                     = useState('subject')
  const activeView = isTeacher ? 'subject' : view
  const [activeTab, setActiveTab]           = useState('grading')
  const [search, setSearch]                 = useState('')
  // The All subjects view shows one period, or the final grade ('final').
  const [allPeriod, setAllPeriod]           = useState('final')

  // ── Filter state ──────────────────────────────────────────
  const [syId, setSyId]                     = useState('')
  const [schoolYears, setSchoolYears]       = useState([])
  const [selectedClass, setSelectedClass]   = useState('')
  // `subjectId` names a **learning area**; `areaId` is the area of a composite
  // one (MAPEH → Music / Arts / Physical Education / Health), or '' for the
  // learning area's own roll-up sheet. Both are real views here, unlike Score
  // Entry where a composite learning area is not gradeable — the roll-up is
  // the grade that goes on the report card, so it is the tab strip's first tab.
  const [subjectId, setSubjectId]           = useState('')
  const [areaId, setAreaId]                 = useState('')
  const [subjects, setSubjects]             = useState([])
  const [sectionsGrouped, setSectionsGrouped] = useState({})
  const [loading, setLoading]               = useState(false)
  const [data, setData]                     = useState(null)

  // ── Grade Summary state ───────────────────────────────────
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
    setAreaId('')
    setSubjects([])
    setData(null)
    curriculumApi.getSectionsGrouped(syId).then(res => setSectionsGrouped(res.data.grouped || {})).catch(() => {})
  }, [isTeacher, syId])

  // ── Admin: load subjects when grade level changes ─────────
  useEffect(() => {
    if (isTeacher || !syId || !gradeLevel) return
    setSubjectId('')
    setAreaId('')
    setSubjects([])
    setData(null)
    curriculumApi.getSubjects({ sy_id: syId, grade_level: gradeLevel, include_areas: true }).then(res => {
      setSubjects(res.data.subjects || res.data)
    }).catch(() => {})
  }, [isTeacher, syId, gradeLevel])

  // ── Teacher: load subjects matching allowed names ─────────
  useEffect(() => {
    if (!isTeacher || !syId || !gradeLevel) return
    setSubjectId('')
    setAreaId('')
    setSubjects([])
    setData(null)
    curriculumApi.getSubjects({ sy_id: syId, grade_level: gradeLevel, include_areas: true }).then(res => {
      const all = res.data.subjects || res.data
      setSubjects(all.filter(s => allowedSubjects.includes(s.parent_name || s.name)))
    }).catch(() => {})
  }, [isTeacher, syId, gradeLevel, allowedSubjects])

  // Reset downstream when class changes
  useEffect(() => { setSubjectId(''); setAreaId(''); setData(null) }, [selectedClass])

  // ── Subject / area selection ──────────────────────────────
  // The dropdown offers learning areas only. MAPEH's four areas are the tab
  // strip below it, alongside MAPEH itself — the roll-up is the grade that
  // reaches the report card, so it is a view in its own right and stays the
  // default. A stale `areaId` falls back to the roll-up rather than to nothing.
  const learningAreas = useMemo(() => subjects.filter(s => !s.parent_id), [subjects])
  const selectedLearningArea = learningAreas.find(s => s.id === subjectId) || null
  const areas = useMemo(
    () => subjects.filter(s => s.parent_id === subjectId),
    [subjects, subjectId]
  )
  const hasAreas = !!selectedLearningArea && selectedLearningArea.area_count > 0
  const activeSubjectId = hasAreas && areas.some(a => a.id === areaId) ? areaId : subjectId

  // A learning area graded through its areas (MAPEH) *while its own roll-up is
  // on screen*: that sheet is the average of the four, so it is read-only and
  // has no weighted-category breakdown to summarise. An individual area is an
  // ordinary gradeable subject and keeps both tabs.
  const viewingRollup = hasAreas && activeSubjectId === subjectId
  // '' is the roll-up's tab id, so it is what the strip compares against.
  const activeAreaTab = viewingRollup ? '' : activeSubjectId

  // ── Resolve SY label ──────────────────────────────────────
  const selectedSY = schoolYears.find(sy => sy.id === syId)
  const syLabel = selectedSY?.label || ''

  // Period count and grading policy come from the school year itself, so an
  // archived four-quarter year and a current three-term one both render right.
  const grading = useMemo(() => resolveGradingPolicy(selectedSY || null, gradeLevel), [selectedSY, gradeLevel])
  const passing = grading.passingGrade
  const showDescriptor = !!grading.descriptorFor
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
    if (activeView !== 'subject' || !filtersReady) { setData(null); return }
    setLoading(true)
    gradesApi.getBySubject({ subject_id: activeSubjectId, grade_level: gradeLevel, section, school_year: syLabel })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [activeView, activeSubjectId, gradeLevel, section, syLabel])

  // Reset the selected period when the school year's period model changes.
  useEffect(() => {
    if (!grading.periods.includes(classQuarter)) setClassQuarter(grading.periods[0])
    if (allPeriod !== 'final' && !grading.periods.includes(allPeriod)) setAllPeriod('final')
  }, [grading.periodModel])

  // ── Fetch breakdown for the Grade Summary tab ─────────────
  useEffect(() => {
    // The roll-up has no weighted categories of its own — its summary is the
    // four areas, which arrive with the sheet — so it fetches nothing here.
    if (activeView !== 'subject' || activeTab !== 'class' || !filtersReady || viewingRollup) { setBreakdownData(null); return }
    setBreakdownLoading(true)
    scoreApi.getBreakdown({ subject_id: activeSubjectId, quarter: classQuarter, grade_level: gradeLevel, section })
      .then(res => setBreakdownData(res.data))
      .catch(() => setBreakdownData(null))
      .finally(() => setBreakdownLoading(false))
  }, [activeView, activeTab, classQuarter, activeSubjectId, gradeLevel, section, viewingRollup])

  // ── Grading sheet rows ────────────────────────────────────
  const sheetRows = useMemo(() => (data?.students || []).map(student => {
    const sg = data.grades[student.id] || {}
    const periods = grading.periods.map(q => toGrade(sg[q]?.grade))
    return { student, periods, final: finalGradeFrom(periods) }
  }), [data, grading])

  const failedCount = sheetRows.filter(r => r.final !== null && r.final < passing).length

  const sheetGroups = useMemo(
    () => groupByGender(sheetRows.filter(r => matchesSearch(r.student, search)), r => r.student.gender),
    [sheetRows, search]
  )
  const breakdownGroups = useMemo(
    () => groupByGender((breakdownData?.breakdown || []).filter(b => matchesSearch(b.student, search)), b => b.student.gender),
    [breakdownData, search]
  )
  const rollupGroups = useMemo(
    () => groupByGender((data?.students || []).filter(s => matchesSearch(s, search)), s => s.gender),
    [data, search]
  )

  // Category headers from first student's breakdown
  const breakdownCategories = useMemo(() => {
    if (!breakdownData?.breakdown?.length) return []
    return breakdownData.breakdown[0].categories.map(c => ({ id: c.id, name: c.name, weight: c.weight }))
  }, [breakdownData])

  const periodPlural = `${grading.periodNoun.toLowerCase()}s`

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">Grades</h1>
        <p className="page-subtitle">
          {isTeacher
            ? 'View the grades recorded for your classes'
            : 'Review a class’s grades one subject at a time, or every subject at once.'}
        </p>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={<>School year {syStatusChip}</>} className="w-full sm:w-44">
            {isTeacher ? (
              <div className="input bg-slate-50 text-slate-500 cursor-default">SY {syLabel || '—'}</div>
            ) : (
              <select className="input" value={syId} onChange={e => setSyId(e.target.value)}>
                <option value="">— Select —</option>
                {schoolYears.map(sy => <option key={sy.id} value={sy.id}>{sy.label}</option>)}
              </select>
            )}
          </Field>

          {isTeacher ? (
            <Field label="Class" className="w-full sm:w-52">
              <select className="input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
                <option value="">— Select —</option>
                {classOptions.map(c => (
                  <option key={`${c.grade_level}|||${c.section}`} value={`${c.grade_level}|||${c.section}`}>
                    {c.grade_level} - {c.section}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Grade level" className="w-full sm:w-36">
                <select className="input" value={gradeLevel} onChange={e => setSelectedClass(e.target.value ? `${e.target.value}|||` : '')}>
                  <option value="">— Select —</option>
                  {adminGradeLevels.map(gl => <option key={gl} value={gl}>{gl}</option>)}
                </select>
              </Field>
              <Field label="Section" className="w-full sm:w-40">
                <select className="input" value={section} onChange={e => setSelectedClass(gradeLevel ? `${gradeLevel}|||${e.target.value}` : '')} disabled={!gradeLevel}>
                  <option value="">— Select —</option>
                  {adminSections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
            </>
          )}

          {!isTeacher && (
            <>
              <div className="hidden lg:block w-px h-10 bg-slate-200 mx-1" />
              <Field label="View">
                <Segmented
                  value={activeView}
                  onChange={setView}
                  options={[
                    { value: 'subject', label: 'By subject', icon: List },
                    { value: 'all', label: 'All subjects', icon: LayoutGrid },
                  ]}
                />
              </Field>
            </>
          )}

          {activeView === 'subject' ? (
            <Field label="Subject" className="w-full sm:w-56">
              {/* Learning areas only. MAPEH is one entry — the learning area the
                  report card carries — and its four areas are the tab strip below
                  the filters, beside the roll-up itself. */}
              <select className="input" value={subjectId}
                onChange={e => { setSubjectId(e.target.value); setAreaId('') }}
                disabled={!gradeLevel || !section}>
                <option value="">— Select —</option>
                {learningAreas.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.area_count > 0 ? ` (${s.area_count} areas)` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={grading.periodNoun}>
              <Segmented
                value={allPeriod}
                onChange={setAllPeriod}
                options={[
                  ...grading.periods.map((p, i) => ({ value: p, label: grading.ordinals[i] })),
                  { value: 'final', label: 'Final' },
                ]}
              />
            </Field>
          )}
        </div>
      </div>

      {activeView === 'all' ? (
        syLabel && gradeLevel && section ? (
          <ClassRecord
            syLabel={syLabel}
            gradeLevel={gradeLevel}
            section={section}
            grading={grading}
            period={allPeriod}
            search={search}
            setSearch={setSearch}
          />
        ) : (
          <div className="card">
            <EmptyState icon={LayoutGrid} title="Select a class"
              description="Choose a school year, grade level and section to see every learning area at once." />
          </div>
        )
      ) : (
        <>
          {/* ── Area tabs — only a composite learning area has them ──
              MAPEH is one learning area on the report card and four separately
              graded areas underneath. Both are worth reading, so the strip carries
              the roll-up as its first tab and the four areas after it: one subject
              selection, five sheets. */}
          {hasAreas && (
            <div className="card p-3 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 pl-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <Layers size={15} className="text-slate-400" />
                {selectedLearningArea.name} areas
              </span>
              <Segmented
                size="sm"
                value={activeAreaTab}
                onChange={setAreaId}
                options={[{ id: '', name: selectedLearningArea.name }, ...areas].map(t => ({ value: t.id, label: t.name }))}
              />
            </div>
          )}

          {loading ? (
            <div className="card"><LoadingSpinner /></div>
          ) : data ? (
            <div className="card overflow-hidden">
              {/* Sheet header — names the class for BOTH tabs, including Grade
                  Summary, whose weighted-category columns read identically for
                  every subject in the school. */}
              <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {data.parent_name ? `${data.parent_name} — ${data.subject_name}` : data.subject_name}
                  </h2>
                  <p className="text-[13px] text-slate-500 mt-0.5">
                    {gradeLevel} – {section} · Subject teacher:{' '}
                    <span className="font-medium text-slate-700">{data.teacher_name || '—'}</span>
                    {' '}· {grading.periodCount} {periodPlural}
                  </p>
                </div>
                {sheetRows.length > 0 && (
                  <Stat
                    label="Failed"
                    value={failedCount}
                    note={failedCount === 1 ? 'learner' : 'learners'}
                    danger={failedCount > 0}
                  />
                )}
              </div>

              <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    size="sm"
                    value={activeTab}
                    onChange={setActiveTab}
                    options={[{ value: 'grading', label: 'Grading sheet' }, { value: 'class', label: 'Grade summary' }]}
                  />
                  {/* Period selector — `grading.abbr(q)` renders Q1..Q4 on a
                      four-quarter year and T1..T3 on a three-term one. */}
                  {activeTab === 'class' && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-500 mr-1">{grading.periodNoun}:</span>
                      {grading.periods.map(q => (
                        <button key={q} type="button" onClick={() => setClassQuarter(q)}
                          className={clsx('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                            classQuarter === q ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          )}>
                          {grading.abbr(q)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {data.students.length > 0 && <SearchBox value={search} onChange={setSearch} />}
              </div>

              {data.students.length === 0 ? (
                <EmptyState icon={BookOpen} title="No students enrolled" description="No students found in this class." />
              ) : activeTab === 'grading' ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th className="w-12 !text-center">#</th>
                          <th>Learner</th>
                          {grading.ordinals.map(o => <th key={o} className="!text-center">{o}</th>)}
                          <th className="!text-center border-l border-slate-100">Final grade</th>
                          {showDescriptor && <th className="!text-center">Descriptor</th>}
                          <th className="!text-center">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheetGroups.length === 0 && <NoMatchRow colSpan={grading.periodCount + (showDescriptor ? 5 : 4)} search={search} />}
                        {sheetGroups.map(group => (
                          <Fragment key={group.label}>
                            <GroupRow label={group.label} colSpan={grading.periodCount + (showDescriptor ? 5 : 4)} />
                            {group.students.map((r, idx) => (
                              <tr key={r.student.id}>
                                <td className="text-xs text-slate-400 text-center">{idx + 1}</td>
                                <td className="font-medium text-sm text-slate-800 whitespace-nowrap">{formatName(r.student)}</td>
                                {r.periods.map((g, qi) => (
                                  <td key={qi} className="text-center"><GradeNumber grade={g} passing={passing} /></td>
                                ))}
                                <td className="text-center border-l border-slate-100"><GradeNumber grade={r.final} passing={passing} tone="final" /></td>
                                {showDescriptor && <td className="text-center"><DescriptorLabel grade={r.final} grading={grading} /></td>}
                                <td className="text-center"><RemarksPill grade={r.final} passing={passing} /></td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="px-5 py-3 flex items-center gap-2 text-xs text-slate-500">
                    <Info size={14} className="text-slate-400 flex-shrink-0" />
                    Final grade is the average of the {periodPlural} graded so far. Passing grade is {passing}.
                  </p>
                </>
              ) : viewingRollup ? (
                /* The roll-up's summary is its areas, not weighted categories:
                   MAPEH has no Written Work of its own, its grade for a period
                   is the average of the four areas' grades for that period. The
                   numbers come from the sheet's own `area_grades`, which is why
                   nothing is fetched for it. */
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="w-12 !text-center">#</th>
                        <th>Learner</th>
                        {data.areas.map(a => <th key={a.id} className="!text-center">{a.name}</th>)}
                        <th className="!text-center border-l border-slate-100">Final</th>
                        {showDescriptor && <th className="!text-center">Descriptor</th>}
                        <th className="!text-center">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollupGroups.length === 0 && <NoMatchRow colSpan={data.areas.length + (showDescriptor ? 5 : 4)} search={search} />}
                      {rollupGroups.map(group => (
                        <Fragment key={group.label}>
                          <GroupRow label={group.label} colSpan={data.areas.length + (showDescriptor ? 5 : 4)} />
                          {group.students.map((student, idx) => {
                            const ag = data.area_grades?.[student.id] || {}
                            const final = toGrade(data.grades[student.id]?.[classQuarter]?.grade)
                            return (
                              <tr key={student.id}>
                                <td className="text-xs text-slate-400 text-center">{idx + 1}</td>
                                <td className="font-medium text-sm text-slate-800 whitespace-nowrap">{formatName(student)}</td>
                                {data.areas.map(a => (
                                  <td key={a.id} className="text-center">
                                    <GradeNumber grade={toGrade(ag[a.id]?.[classQuarter])} passing={passing} />
                                  </td>
                                ))}
                                <td className="text-center border-l border-slate-100"><GradeNumber grade={final} passing={passing} tone="final" /></td>
                                {showDescriptor && <td className="text-center"><DescriptorLabel grade={final} grading={grading} /></td>}
                                <td className="text-center"><RemarksPill grade={final} passing={passing} /></td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : breakdownLoading ? (
                <div className="py-8"><LoadingSpinner /></div>
              ) : breakdownCategories.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="w-12 !text-center">#</th>
                        <th>Learner</th>
                        {breakdownCategories.map(cat => (
                          <th key={cat.id} className="!text-center">
                            <div className="truncate max-w-[160px] mx-auto">{cat.name}</div>
                            <div className="font-normal text-slate-400">({cat.weight}%)</div>
                          </th>
                        ))}
                        <th className="!text-center">Initial</th>
                        <th className="!text-center border-l border-slate-100">Final</th>
                        {showDescriptor && <th className="!text-center">Descriptor</th>}
                        <th className="!text-center">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownGroups.length === 0 && <NoMatchRow colSpan={breakdownCategories.length + (showDescriptor ? 6 : 5)} search={search} />}
                      {breakdownGroups.map(group => (
                        <Fragment key={group.label}>
                          <GroupRow label={group.label} colSpan={breakdownCategories.length + (showDescriptor ? 6 : 5)} />
                          {group.students.map((entry, idx) => {
                            const fg = toGrade(entry.final_grade)
                            return (
                              <tr key={entry.student.id}>
                                <td className="text-xs text-slate-400 text-center">{idx + 1}</td>
                                <td className="font-medium text-sm text-slate-800 whitespace-nowrap">{formatName(entry.student)}</td>
                                {entry.categories.map(cat => (
                                  <td key={cat.id} className={clsx('text-center font-mono text-sm', cat.ws > 0 ? 'text-slate-700' : 'text-slate-300')}>
                                    {cat.ws != null ? Number(cat.ws).toFixed(2) : '—'}
                                  </td>
                                ))}
                                <td className={clsx('text-center font-mono text-sm', entry.initial_grade > 0 ? 'text-slate-700' : 'text-slate-300')}>
                                  {entry.initial_grade != null ? Number(entry.initial_grade).toFixed(2) : '—'}
                                </td>
                                <td className="text-center border-l border-slate-100"><GradeNumber grade={fg} passing={passing} tone="final" /></td>
                                {showDescriptor && <td className="text-center"><DescriptorLabel grade={fg} grading={grading} /></td>}
                                <td className="text-center"><RemarksPill grade={fg} passing={passing} /></td>
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
                  <EmptyState icon={BookOpen} title="No scores recorded" description={`No score data found for this ${grading.periodNoun.toLowerCase()}.`} />
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <EmptyState icon={BookOpen} title="Select filters"
                description={isTeacher
                  ? 'Choose a class and subject to view the grading sheet.'
                  : 'Choose a school year, grade level, section and subject to view the grading sheet.'} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── All subjects ─────────────────────────────────────────────
// One row per learner, one column per learning area. MAPEH is one column
// carrying its stored roll-up — its areas are shown only inside the learner
// record, beneath it, never beside it — so the general average counts each
// learning area once.
function ClassRecord({ syLabel, gradeLevel, section, grading, period, search, setSearch }) {
  const [record, setRecord]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [openId, setOpenId]   = useState(null)
  const passing = grading.passingGrade
  const showDescriptor = !!grading.descriptorFor

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setOpenId(null)
    gradesApi.getClassRecord({ grade_level: gradeLevel, section, school_year: syLabel })
      .then(res => { if (alive) setRecord(res.data) })
      .catch(err => {
        if (!alive) return
        setRecord(null)
        setError(err.response?.data?.error || 'Could not load this class’s grades.')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [syLabel, gradeLevel, section])

  const subjects = record?.subjects || []
  const periodIdx = period === 'final' ? -1 : grading.periods.indexOf(period)

  const rows = useMemo(() => (record?.students || []).map(student => {
    const g = record.grades[student.id] || {}
    const periodsOf = (id) => grading.periods.map(p => toGrade(g[id]?.[p]))
    const cells = subjects.map(subject => {
      const periods = periodsOf(subject.id)
      return {
        subject,
        periods,
        final: finalGradeFrom(periods),
        areas: subject.areas.map(a => {
          const ap = periodsOf(a.id)
          return { ...a, periods: ap, final: finalGradeFrom(ap) }
        }),
      }
    })
    const shown = cells.map(c => (periodIdx < 0 ? c.final : c.periods[periodIdx]))
    return {
      student,
      cells,
      shown,
      average: finalGradeFrom(shown),
      generalAverage: finalGradeFrom(cells.map(c => c.final)),
    }
  }), [record, subjects, grading, periodIdx])

  const failed = rows.filter(r => r.average !== null && r.average < passing).length

  const groups = useMemo(
    () => groupByGender(rows.filter(r => matchesSearch(r.student, search)), r => r.student.gender),
    [rows, search]
  )
  const ordered = useMemo(() => groups.flatMap(gr => gr.students), [groups])
  const openRow = rows.find(r => r.student.id === openId) || null
  const offLevel = subjects.filter(s => s.off_level)
  const colSpan = subjects.length + (showDescriptor ? 5 : 4)

  if (loading) return <div className="card"><LoadingSpinner /></div>
  if (error || !record) {
    return (
      <div className="card">
        <EmptyState icon={LayoutGrid} title="No grades to show" description={error || 'This class has no grade records.'} />
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">All learning areas</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {gradeLevel} – {section}
            {' '}· Adviser: <span className="font-medium text-slate-700">{record.adviser_name || '—'}</span>
          </p>
        </div>
        {rows.length > 0 && (
          <Stat label="Failed" value={failed} note={failed === 1 ? 'learner' : 'learners'} danger={failed > 0} />
        )}
      </div>

      {rows.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-slate-500">Select a learner to see their full record.</p>
          <SearchBox value={search} onChange={setSearch} />
        </div>
      )}

      {/* A grade recorded against another grade level's subject inside the same
          school year — usually a mid-year placement change. Named rather than
          dropped, so the work is visible and the anomaly is noticeable. */}
      {offLevel.length > 0 && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <span className="font-semibold">
              {offLevel.length} column{offLevel.length !== 1 ? 's' : ''} from another grade level
            </span>{' '}
            ({offLevel.map(s => `${s.name} · ${s.grade_level}`).join(', ')}). These grades were recorded
            this school year against a subject outside this class’s grade level.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No students enrolled" description="No students found in this class." />
      ) : subjects.length === 0 ? (
        <EmptyState icon={BookOpen} title="No learning areas" description={`${gradeLevel} has no subjects in SY ${syLabel}.`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10 !text-center !px-2">#</th>
                <th className="!pl-2">Learner</th>
                {subjects.map(s => (
                  <th key={s.id} className="!text-center !px-2 !whitespace-normal leading-tight min-w-[4.5rem]" title={s.name}>
                    {s.name}
                    {s.off_level && <span className="ml-0.5 text-amber-500" title={`${s.grade_level} subject`}>*</span>}
                  </th>
                ))}
                <th className="!text-center !px-2 border-l border-slate-100">Gen. ave</th>
                {showDescriptor && <th className="!text-center !pr-2">Descriptor</th>}
                <th className="!text-center !pl-2">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && <NoMatchRow colSpan={colSpan} search={search} />}
              {groups.map(group => (
                <Fragment key={group.label}>
                  <GroupRow label={group.label} colSpan={colSpan} />
                  {group.students.map((r, idx) => {
                    const open = r.student.id === openId
                    return (
                      <tr
                        key={r.student.id}
                        tabIndex={0}
                        onClick={() => setOpenId(r.student.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(r.student.id) } }}
                        className={clsx('cursor-pointer focus:outline-none focus-visible:bg-brand-50', open && '!bg-brand-50')}
                      >
                        <td className="text-xs text-slate-400 text-center !px-2">{idx + 1}</td>
                        <td className={clsx('font-medium text-sm whitespace-nowrap !pl-2', open ? 'text-brand-600' : 'text-slate-800')}>
                          {formatName(r.student)}
                        </td>
                        {r.shown.map((g, i) => (
                          <td key={r.cells[i].subject.id} className="text-center !px-2"><GradeNumber grade={g} passing={passing} /></td>
                        ))}
                        <td className="text-center !px-2 border-l border-slate-100"><GradeNumber grade={r.average} passing={passing} tone="final" /></td>
                        {showDescriptor && <td className="text-center !pr-2"><DescriptorLabel grade={r.average} grading={grading} /></td>}
                        <td className="text-center !pl-2"><RemarksPill grade={r.average} passing={passing} /></td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openRow && (
        <LearnerRecord
          row={openRow}
          ordered={ordered}
          onNavigate={setOpenId}
          onClose={() => setOpenId(null)}
          grading={grading}
          gradeLevel={gradeLevel}
          section={section}
          syLabel={syLabel}
        />
      )}
    </div>
  )
}

// ── Learner record ───────────────────────────────────────────
// Every learning area for one learner across every period, with the final,
// descriptor and remarks. A composite learning area lists its areas beneath it
// — shown, not added: the general average counts MAPEH once.
function LearnerRecord({ row, ordered, onNavigate, onClose, grading, gradeLevel, section, syLabel }) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const passing = grading.passingGrade
  const showDescriptor = !!grading.descriptorFor
  const { student } = row
  const position = ordered.findIndex(r => r.student.id === student.id)
  const prev = position > 0 ? ordered[position - 1] : null
  const next = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null
  const hasComposite = row.cells.some(c => c.areas.length > 0)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (id) => setCollapsed(prevSet => {
    const nextSet = new Set(prevSet)
    nextSet.has(id) ? nextSet.delete(id) : nextSet.add(id)
    return nextSet
  })

  const initials = `${student.first_name?.[0] || ''}${student.surname?.[0] || ''}`.toUpperCase() || '?'

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 animate-fade-in" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Grades of ${formatName(student)}`}
        className="relative w-full max-w-3xl h-full bg-white shadow-2xl flex flex-col"
      >
        <div className="px-4 sm:px-6 py-5 border-b border-slate-100 flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-full bg-brand-100 text-brand-600 font-semibold text-[15px] flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 truncate">{formatName(student)}</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {student.lrn ? `LRN ${student.lrn} · ` : ''}{gradeLevel} – {section} · SY {syLabel}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50">
            <div className={clsx(
              'w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center font-mono text-2xl font-bold flex-shrink-0',
              row.generalAverage !== null && row.generalAverage < passing ? 'text-red-500' : 'text-brand-600'
            )}>
              {row.generalAverage ?? '—'}
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">General average</p>
              {row.generalAverage !== null && (
                <div className="flex flex-wrap items-center gap-3">
                  {showDescriptor && <DescriptorLabel grade={row.generalAverage} grading={grading} />}
                  <RemarksPill grade={row.generalAverage} passing={passing} />
                </div>
              )}
              <p className="text-xs text-slate-400">
                {row.cells.length} learning area{row.cells.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Learning area</th>
                  {grading.ordinals.map(o => <th key={o} className="px-1.5 py-2.5 text-center whitespace-nowrap">{o}</th>)}
                  <th className="px-3 py-2.5 text-center whitespace-nowrap border-l border-slate-200">Final</th>
                  {showDescriptor && <th className="px-3 py-2.5 text-center whitespace-nowrap">Descriptor</th>}
                  <th className="px-3 py-2.5 text-center whitespace-nowrap">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {row.cells.map(cell => {
                  const composite = cell.areas.length > 0
                  const isOpen = composite && !collapsed.has(cell.subject.id)
                  return (
                    <Fragment key={cell.subject.id}>
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-2.5 font-medium text-slate-800">
                          {composite ? (
                            <button type="button" onClick={() => toggle(cell.subject.id)} className="flex items-center gap-1.5 text-left">
                              <ChevronDown size={14} className={clsx('text-slate-400 transition-transform', !isOpen && '-rotate-90')} />
                              <span className="whitespace-nowrap">{cell.subject.name}</span>
                              <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">avg. of {cell.areas.length}</span>
                            </button>
                          ) : (
                            <span className="whitespace-nowrap">
                              {cell.subject.name}
                              {cell.subject.off_level && <span className="ml-1 text-amber-500" title={`${cell.subject.grade_level} subject`}>*</span>}
                            </span>
                          )}
                        </td>
                        {cell.periods.map((g, i) => (
                          <td key={i} className="px-1.5 py-2.5 text-center"><GradeNumber grade={g} passing={passing} small /></td>
                        ))}
                        <td className="px-3 py-2.5 text-center border-l border-slate-100"><GradeNumber grade={cell.final} passing={passing} tone="final" /></td>
                        {showDescriptor && <td className="px-3 py-2.5 text-center"><DescriptorLabel grade={cell.final} grading={grading} /></td>}
                        <td className="px-3 py-2.5 text-center"><RemarksPill grade={cell.final} passing={passing} /></td>
                      </tr>
                      {isOpen && cell.areas.map(area => (
                        <tr key={area.id} className="border-b border-slate-100 bg-slate-50/50">
                          <td className="pl-9 pr-3 py-2 text-[13px] text-slate-500 whitespace-nowrap">{area.name}</td>
                          {area.periods.map((g, i) => (
                            <td key={i} className="px-1.5 py-2 text-center"><GradeNumber grade={g} passing={passing} tone="muted" small /></td>
                          ))}
                          <td className="px-3 py-2 text-center border-l border-slate-100"><GradeNumber grade={area.final} passing={passing} tone="muted" small /></td>
                          {showDescriptor && <td />}
                          <td />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {hasComposite && (
            <p className="flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
              <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
              MAPEH’s areas are shown beneath it.
            </p>
          )}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" disabled={!prev} onClick={() => prev && onNavigate(prev.student.id)}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Previous learner">
              <ChevronLeft size={16} />
            </button>
            <button type="button" disabled={!next} onClick={() => next && onNavigate(next.student.id)}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Next learner">
              <ChevronRight size={16} />
            </button>
            {position >= 0 && <span className="text-xs text-slate-400">{position + 1} of {ordered.length}</span>}
          </div>
          <Link to={`/students/${student.id}`} className="btn-primary">
            Open student profile <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
    </div>,
    document.body
  )
}

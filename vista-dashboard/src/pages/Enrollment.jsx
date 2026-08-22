import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Users, Search, Save, RotateCcw, AlertTriangle, Info, X, GraduationCap, Eye, EyeOff,
  Lock, Unlock,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { enrollmentApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'
import SchoolYearPicker, { isArchivedYear } from '../components/SchoolYearPicker'
import { useAuth } from '../context/AuthContext'
import { ALL_GRADES } from '../utils/roles'
import {
  SELECTABLE_STATUSES, NO_RECORD_ID, OUTCOMES, statusLabel, statusClasses, nextGradeLevel,
} from '../utils/enrollment'
import { formatName } from '../utils/nameHelper'

// The roster is one row per student per school year. A row with no record yet
// is represented by `status: null` from the API and rendered as "Not enrolled" —
// those are the rows the admin is here to fill in.
const statusOf = (row) => row.status || 'none'

// Status only. Outcomes get their own filter — mixing them in one strip is
// what made this page confusing in the first place.
const CHIP_ORDER = ['none', 'pending', 'enrolled', 'transferred_out', 'dropped']

function StatusBadge({ status }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap', statusClasses(status))}>
      {statusLabel(status)}
    </span>
  )
}

/**
 * Where the learner was before this school year — the most recent year they
 * actually have a record for, gaps skipped. This replaced a "Currently" column
 * that showed `students.grade_level`: redundant when you are editing the active
 * year, and misleading when you are not.
 *
 * The second line says how that year ended when it has been closed, and falls
 * back to the status when they did not finish it.
 */
function LastAttended({ row }) {
  if (!row.last_school_year) {
    return <span className="text-slate-400 italic">— first year</span>
  }
  const note = row.last_outcome
    ? statusLabel(row.last_outcome)
    : row.last_status !== 'enrolled' ? statusLabel(row.last_status) : null
  return (
    <div className="text-slate-500 leading-tight">
      <p className="text-slate-700">
        {row.last_grade_level}{row.last_section ? ` — ${row.last_section}` : ''}
      </p>
      <p className="text-[11px] text-slate-400">
        SY {row.last_school_year}{note ? ` · ${note}` : ''}
      </p>
    </div>
  )
}

export default function Enrollment() {
  const { gradeScope } = useAuth()

  const scopedGrades = useMemo(
    () => (gradeScope?.length ? ALL_GRADES.filter(g => gradeScope.includes(g)) : ALL_GRADES),
    [gradeScope]
  )

  // ── School years ───────────────────────────────────────────
  const [schoolYears, setSchoolYears] = useState([])
  const [selectedSY, setSelectedSY]   = useState(null)
  // An archived year opens read-only. Its records are what actually happened,
  // and the picker offers closed years exactly like the others, so the likeliest
  // reason to be editing one is that the wrong year is selected. Correcting a
  // closed year is still legitimate — records get entered wrong — so this is a
  // deliberate step, not a freeze.
  const [unlocked, setUnlocked] = useState(false)
  const archived = isArchivedYear(selectedSY)
  const locked   = archived && !unlocked

  useEffect(() => {
    curriculumApi.getSchoolYears()
      .then(res => {
        const list = res.data.school_years || []
        setSchoolYears(list)
        // Default to the active year: it is the one whose roster the rest of
        // the app reads, so landing there matches what the user sees elsewhere.
        setSelectedSY(list.find(s => s.is_active) || list.find(s => s.is_upcoming) || list[0] || null)
      })
      .catch(() => toast.error('Failed to load school years.'))
  }, [])

  // ── Filters (URL params, same idiom as the Students page) ──
  const [searchParams, setSearchParams] = useSearchParams()
  const search        = searchParams.get('q') || ''
  const gradeFilter   = searchParams.get('grade') || ''
  const statusFilter  = searchParams.get('status') || ''
  const outcomeFilter = searchParams.get('outcome') || ''
  const includeLeft   = searchParams.get('left') === '1'

  const params = () => ({
    q: search, grade: gradeFilter, status: statusFilter,
    outcome: outcomeFilter, left: includeLeft ? '1' : '',
  })

  const updateParams = (vals) => {
    const p = {}
    if (vals.q) p.q = vals.q
    if (vals.grade) p.grade = vals.grade
    if (vals.status) p.status = vals.status
    if (vals.outcome) p.outcome = vals.outcome
    if (vals.left) p.left = vals.left
    setSearchParams(p, { replace: true })
  }

  // ── Roster ─────────────────────────────────────────────────
  const [rows, setRows]         = useState([])
  const [summary, setSummary]   = useState({})
  const [outcomeSummary, setOutcomeSummary] = useState({})
  const [leftCount, setLeftCount]           = useState(0)
  const [loading, setLoading]   = useState(true)
  const [sections, setSections] = useState([])

  // Pending edits, keyed by student_id. Only these are sent on save, so an
  // admin who touched three rows does not rewrite the whole year.
  const [drafts, setDrafts] = useState({})
  const [selected, setSelected] = useState(() => new Set())
  const [saving, setSaving] = useState(false)

  const fetchRoster = useCallback(async () => {
    if (!selectedSY) return
    setLoading(true)
    try {
      const res = await enrollmentApi.roster({
        sy_id: selectedSY.id,
        grade_level: gradeFilter || undefined,
        status: statusFilter || undefined,
        outcome: outcomeFilter || undefined,
        include_left: includeLeft ? 'true' : undefined,
        q: search || undefined,
      })
      setRows(res.data.students || [])
      setSummary(res.data.summary || {})
      setOutcomeSummary(res.data.outcome_summary || {})
      setLeftCount(res.data.left_count || 0)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load the enrolment roster.')
    } finally {
      setLoading(false)
    }
  }, [selectedSY, gradeFilter, statusFilter, outcomeFilter, includeLeft, search])

  useEffect(() => {
    const t = setTimeout(fetchRoster, 250)
    return () => clearTimeout(t)
  }, [fetchRoster])

  // Sections belong to the selected year, not the active one — enrolling into
  // next year has to offer next year's sections.
  useEffect(() => {
    if (!selectedSY) return
    curriculumApi.getSections({ sy_id: selectedSY.id })
      .then(res => setSections(res.data.sections || []))
      .catch(() => setSections([]))
  }, [selectedSY])

  // Changing year invalidates every pending edit — they were keyed to the old
  // one — and clears the status filter with them. Status counts are per year:
  // carrying "Not enrolled" into a year where everyone is enrolled shows an
  // empty roster, and the chip that would clear it is gone because its count is
  // zero. That reads as "this year has no learners" rather than "you filtered
  // them out". The first render is exempt so a shared or bookmarked URL still
  // opens on the filter it names.
  const prevSY = useRef(null)
  useEffect(() => {
    const id = selectedSY?.id
    if (!id) return
    const changed = prevSY.current && prevSY.current !== id
    prevSY.current = id
    if (!changed) return
    setDrafts({})
    setSelected(new Set())
    // Unlocking is per year: it must not carry into the next one selected.
    setUnlocked(false)
    if (statusFilter || outcomeFilter) updateParams({ ...params(), status: '', outcome: '' })
  }, [selectedSY?.id])

  const sectionsFor = useCallback(
    (grade) => sections.filter(s => s.grade_level === grade).map(s => s.name),
    [sections]
  )

  // ── Draft editing ──────────────────────────────────────────
  //
  // A draft starts from whatever the row already says: the year's record if it
  // has one, otherwise the learner's current position, so the admin edits a
  // sensible starting point rather than an empty form.
  const draftFor = useCallback((row) => drafts[row.student_id] || {
    grade_level: row.grade_level || row.current_grade_level,
    section:     row.section ?? row.current_section ?? '',
    status:      row.status || 'pending',
  }, [drafts])

  const isDirty = (row) => !!drafts[row.student_id]

  const setDraft = (row, patch) => {
    setDrafts(prev => {
      const base = prev[row.student_id] || {
        grade_level: row.grade_level || row.current_grade_level,
        section:     row.section ?? row.current_section ?? '',
        status:      row.status || 'pending',
      }
      const next = { ...base, ...patch }
      // Changing grade level invalidates the section — sections are per grade.
      if (patch.grade_level && patch.grade_level !== base.grade_level) next.section = ''
      return { ...prev, [row.student_id]: next }
    })
  }

  const clearDraft = (row) => setDrafts(prev => {
    const next = { ...prev }
    delete next[row.student_id]
    return next
  })

  const dirtyCount = Object.keys(drafts).length
  // Removals delete the year's record rather than writing a value, so the save
  // bar calls them out separately.
  const removalCount = Object.entries(drafts)
    .filter(([id, d]) => d.status === NO_RECORD_ID && rows.some(r => r.student_id === id && r.enrollment_id))
    .length

  // ── Bulk actions ───────────────────────────────────────────
  //
  // The two selects hold what was applied rather than snapping back to their
  // placeholder. They were pinned at `value=""`, so choosing "Enrolled" changed
  // every selected row but left the control reading "Set status..." — the table
  // was the only feedback that anything had happened.
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkGrade,  setBulkGrade]  = useState('')

  // Emptying the selection retires the bar, so the next one starts fresh rather
  // than reopening on the previous batch's choices.
  useEffect(() => {
    if (!selected.size) { setBulkStatus(''); setBulkGrade('') }
  }, [selected.size])

  const targets = () => rows.filter(r => selected.has(r.student_id))

  // What the selection is actually made of, counted off the grade each row is
  // *currently showing* so a pending edit is reflected. "12 selected" alone gave
  // no hint that the batch spanned grades, which is what makes a bulk grade set
  // dangerous: it is an absolute assignment, so a mixed batch is flattened into
  // one grade and every section is cleared with it.
  const selectionGrades = useMemo(() => {
    const by = new Map()
    for (const row of rows) {
      if (!selected.has(row.student_id)) continue
      const g = draftFor(row).grade_level || '—'
      by.set(g, (by.get(g) || 0) + 1)
    }
    return [...by.entries()].sort((a, b) => ALL_GRADES.indexOf(a[0]) - ALL_GRADES.indexOf(b[0]))
  }, [rows, selected, draftFor])

  const mixedGrades = selectionGrades.length > 1

  // How many of the selected learners cannot have their record removed. Two
  // separate reasons, reported separately because the fix differs: an outcome is
  // the one column no surface but the promotion wizard can write, so deleting the
  // row loses the verdict for good; academic work would be left hanging off a
  // learner the year no longer says was ever there.
  const blockedFromRemoval = useMemo(() => {
    const sel = rows.filter(r => selected.has(r.student_id))
    return {
      outcome:  sel.filter(r => r.outcome).length,
      academic: sel.filter(r => r.has_academic_records && !r.outcome).length,
    }
  }, [rows, selected])

  const noRemoveCount = blockedFromRemoval.outcome + blockedFromRemoval.academic
  const noRemoveWhy = blockedFromRemoval.outcome && blockedFromRemoval.academic
    ? 'have an outcome or recorded work'
    : blockedFromRemoval.outcome ? 'have a year-end outcome' : 'have recorded work'

  // Set when a bulk grade change would collapse a mixed selection; holds the
  // pending grade until the admin confirms it.
  const [pendingBulkGrade, setPendingBulkGrade] = useState(null)

  const bulkSet = (patch) => {
    const t = targets()
    if (!t.length) return
    t.forEach(row => setDraft(row, patch))
  }

  const toggleAll = () => {
    setSelected(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.student_id)))
  }

  // ── Carry over from the previous year ──────────────────────
  const [carrying, setCarrying] = useState(false)
  const [previousLabel, setPreviousLabel] = useState(null)

  useEffect(() => {
    if (!selectedSY) { setPreviousLabel(null); return }
    enrollmentApi.previous(selectedSY.id)
      .then(res => setPreviousLabel(res.data.previous?.label || null))
      .catch(() => setPreviousLabel(null))
  }, [selectedSY])

  const carryOver = async () => {
    if (!selectedSY) return
    setCarrying(true)
    try {
      const res = await enrollmentApi.previous(selectedSY.id)
      const prior = new Map((res.data.students || []).map(s => [s.student_id, s]))
      if (!prior.size) {
        toast.error(`No enrolment records exist for SY ${res.data.previous?.label || 'the previous year'}.`)
        return
      }

      const validSections = new Set(sections.map(s => `${s.grade_level}|${s.name}`))
      let filled = 0
      const next = { ...drafts }

      for (const row of rows) {
        // Never overwrite a record that already exists for this year.
        if (row.status) continue
        const from = prior.get(row.student_id)
        if (!from) continue

        // A learner who left last year does not roll forward. Leaving is a
        // status ('transferred_out'/'dropped'); graduating is an outcome.
        if (['transferred_out', 'dropped'].includes(from.status)) continue
        if (from.outcome === 'graduated') continue

        // Retained means they repeat, so the grade does not advance.
        const grade = from.outcome === 'retained'
          ? from.grade_level
          : (from.proposed_grade_level || nextGradeLevel(from.grade_level) || from.grade_level)
        const keepSection = from.section && validSections.has(`${grade}|${from.section}`) ? from.section : ''

        next[row.student_id] = {
          grade_level: grade,
          section: keepSection,
          // Always pending: carrying a learner over says where they belong, not
          // that they have enrolled. Graduation is the wizard's to record.
          status: 'pending',
        }
        filled++
      }

      setDrafts(next)
      toast.success(
        filled
          ? `${filled} learner${filled === 1 ? '' : 's'} prefilled from SY ${res.data.previous.label}. Review, then Save.`
          : 'Nothing to carry over — every learner already has a record for this year.'
      )
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to carry over.')
    } finally {
      setCarrying(false)
    }
  }

  // ── Save ───────────────────────────────────────────────────
  const save = async () => {
    if (!dirtyCount || !selectedSY) return
    // Setting a learner who has no record to "Not enrolled" is a no-op, not a
    // deletion — drop those so the result message counts only real changes.
    const hasRecord = new Set(rows.filter(r => r.enrollment_id).map(r => r.student_id))
    const entries = Object.entries(drafts)
      .filter(([student_id, d]) => d.status !== NO_RECORD_ID || hasRecord.has(student_id))
      .map(([student_id, d]) => (
        d.status === NO_RECORD_ID
          ? { student_id, status: NO_RECORD_ID }
          : { student_id, status: d.status, grade_level: d.grade_level, section: d.section || null }
      ))
    if (!entries.length) { setDrafts({}); setSelected(new Set()); return }

    const missing = entries.filter(e => e.status !== NO_RECORD_ID && !e.grade_level)
    if (missing.length) { toast.error('Every edited learner needs a grade level.'); return }

    setSaving(true)
    try {
      const res = await enrollmentApi.save(selectedSY.id, entries, archived && unlocked)
      toast.success(res.data.message)
      setDrafts({})
      setSelected(new Set())
      fetchRoster()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────
  const noSections = selectedSY && sections.length === 0
  const isActiveYear = !!selectedSY?.is_active

  const hasFilters = !!(search || gradeFilter || statusFilter || outcomeFilter)
  const activeFilterLabels = [
    statusFilter && `"${statusLabel(statusFilter)}"`,
    outcomeFilter && `"${outcomeFilter === 'none' ? 'No outcome yet' : statusLabel(outcomeFilter)}"`,
    gradeFilter,
    search && `"${search}"`,
  ].filter(Boolean)
  const clearFilters = () => updateParams({})

  return (
    <div className="space-y-5 animate-fade-in pb-24">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Enrollment</h1>
          <p className="page-subtitle">
            Who is studying in each school year, and at what grade level and section.
          </p>
        </div>
        {/* The wizard is the fast path at year end; this page stays the place
            for one-off corrections the rest of the year. */}
        <Link to="/enrollment/promotion" className="btn-primary flex items-center gap-2">
          <GraduationCap size={16}/> Year-End Promotion
        </Link>
      </div>

      {/* SY picker + summary chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <SchoolYearPicker
          schoolYears={schoolYears}
          selectedSY={selectedSY}
          onSelect={setSelectedSY}
          canManage={false}
        />
        <div className="w-px h-6 bg-slate-200"/>
        <div className="flex items-center gap-2 flex-wrap">
          {CHIP_ORDER.filter(id => summary[id] || statusFilter === id).map(id => (
            <button key={id}
              onClick={() => updateParams({ ...params(), status: statusFilter === id ? '' : id })}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-full font-medium transition-all',
                statusClasses(id),
                statusFilter === id && 'ring-2 ring-offset-1 ring-brand-400'
              )}>
              {statusLabel(id)} · {summary[id] || 0}
            </button>
          ))}
        </div>
      </div>

      {/* What editing this year actually does. Three cases, not two: an archived
          year is neither "moves learners now" nor "will be activated later" —
          it has already ended, and the old two-way copy said the opposite. */}
      {selectedSY && (
        <div className={clsx(
          'flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 border',
          isActiveYear || (archived && unlocked)
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-slate-50 border-slate-200 text-slate-600'
        )}>
          {locked
            ? <Lock size={14} className="shrink-0 mt-0.5"/>
            : isActiveYear || archived
              ? <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
              : <Info size={14} className="shrink-0 mt-0.5"/>}
          <p className="flex-1">
            {isActiveYear
              ? <>SY {selectedSY.label} is the <strong>active</strong> school year, so saving here moves learners immediately &mdash; their class lists change right away.</>
              : archived
                ? unlocked
                  ? <>SY {selectedSY.label} is <strong>archived</strong> and you are editing its history. Saving rewrites the record of who attended that year &mdash; it changes nothing about the current one.</>
                  : <>SY {selectedSY.label} is <strong>archived</strong>. Its records are the history of who attended that year, so they are read-only. Unlock only to correct a record that is wrong.</>
                : <>SY {selectedSY.label} is not active yet. Saving here only records the plan; learners move when this year is activated in Curriculum Management.</>}
          </p>
          {locked && (
            <button onClick={() => setUnlocked(true)}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 font-medium hover:border-slate-400 transition-colors">
              <Unlock size={12}/> Edit historical records
            </button>
          )}
        </div>
      )}

      {noSections && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
          <p>
            SY {selectedSY.label} has no sections defined, so learners can only be enrolled without one.{' '}
            <Link to="/curriculum" className="underline font-medium">Add sections in Curriculum Management</Link>.
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input className="input pl-9" placeholder="Search name or LRN..."
            value={search}
            onChange={e => updateParams({ ...params(), q: e.target.value })}/>
        </div>

        <select className="input w-auto min-w-[150px]" value={gradeFilter}
          onChange={e => updateParams({ ...params(), grade: e.target.value })}>
          <option value="">All Grade Levels</option>
          {scopedGrades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {/* Outcome is its own filter, deliberately not a status chip. */}
        <select className="input w-auto min-w-[150px]" value={outcomeFilter}
          onChange={e => updateParams({ ...params(), outcome: e.target.value })}>
          <option value="">Any outcome</option>
          <option value="none">
            No outcome yet{outcomeSummary.none ? ` (${outcomeSummary.none})` : ''}
          </option>
          {OUTCOMES.map(o => (
            <option key={o.id} value={o.id}>
              {o.label}{outcomeSummary[o.id] ? ` (${outcomeSummary[o.id]})` : ''}
            </option>
          ))}
        </select>

        <button onClick={carryOver} disabled={locked || carrying || !previousLabel || !rows.length}
          className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={locked ? 'This school year is archived — unlock it to edit its records'
            : previousLabel ? `Prefill from SY ${previousLabel}` : 'No earlier school year to carry over from'}>
          <RotateCcw size={15}/>
          {carrying ? 'Carrying over...' : previousLabel ? `Carry over from ${previousLabel}` : 'Carry over'}
        </button>

        {/* Learners who graduated or left are hidden from later years, or every
            future roster would accumulate every ex-student the school ever had.
            The toggle is how a returning learner is found again. */}
        {(leftCount > 0 || includeLeft) && (
          <button onClick={() => updateParams({ ...params(), left: includeLeft ? '' : '1' })}
            className={clsx('px-3 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2',
              includeLeft ? 'bg-slate-100 border-slate-300 text-slate-700'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300')}>
            {includeLeft ? <EyeOff size={15}/> : <Eye size={15}/>}
            {includeLeft ? 'Hide learners who left' : `Show learners who left${leftCount ? ` (${leftCount})` : ''}`}
          </button>
        )}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && !locked && (
        <div className="flex flex-wrap items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 animate-slide-up">
          <span className="text-sm font-semibold text-brand-800">{selected.size} selected</span>

          {/* What is in the batch. Amber once it spans grades, because that is
              the case where "Set grade level" stops meaning "move these up". */}
          {selectionGrades.length > 0 && (
            <span className={clsx(
              'text-xs px-2 py-1 rounded-lg border',
              mixedGrades ? 'bg-amber-50 border-amber-200 text-amber-800 font-medium'
                          : 'bg-white border-brand-200 text-brand-700'
            )}>
              {selectionGrades.map(([g, n]) => mixedGrades ? `${g} × ${n}` : g).join(', ')}
            </span>
          )}

          <select className="input w-auto py-1.5 text-sm" value={bulkStatus}
            onChange={e => { setBulkStatus(e.target.value); if (e.target.value) bulkSet({ status: e.target.value }) }}>
            <option value="">Set status...</option>
            {SELECTABLE_STATUSES.map(o => {
              const noRemove = o.id === NO_RECORD_ID && noRemoveCount > 0
              return (
                <option key={o.id} value={o.id} disabled={noRemove}>
                  {o.label}{noRemove ? ` — ${noRemoveCount} ${noRemoveWhy}` : ''}
                </option>
              )
            })}
          </select>
          <select className="input w-auto py-1.5 text-sm" value={bulkGrade}
            onChange={e => {
              const g = e.target.value
              // A mixed batch is confirmed, not applied: it collapses every
              // selected learner into one grade and clears their sections.
              if (g && mixedGrades) { setPendingBulkGrade(g); return }
              setBulkGrade(g)
              if (g) bulkSet({ grade_level: g })
            }}>
            <option value="">Set grade level...</option>
            {scopedGrades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <X size={14}/> Clear
          </button>
        </div>
      )}

      {/* Roster */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg"/></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Users}
          title={hasFilters ? 'No learners match these filters' : 'No learners yet'}
          description={hasFilters
            ? `Nobody in SY ${selectedSY?.label || ''} matches ${activeFilterLabels.join(' + ')}.`
            : `No learners have a record for SY ${selectedSY?.label || ''} yet.`}
          action={hasFilters
            ? <button className="btn-secondary" onClick={clearFilters}>Clear filters</button>
            : null}/>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10">
                  {!locked && (
                    <input type="checkbox" className="rounded border-slate-300"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}/>
                  )}
                </th>
                <th>Learner</th>
                <th className="whitespace-nowrap">Last attended</th>
                <th className="whitespace-nowrap">Grade level</th>
                <th className="whitespace-nowrap">Section</th>
                <th className="whitespace-nowrap">Status</th>
                <th className="whitespace-nowrap">Outcome</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const d = draftFor(row)
                const dirty = isDirty(row)
                const secOptions = sectionsFor(d.grade_level)
                // "Not enrolled" deletes the year's record, so the grade and
                // section are about to stop existing — grey them out rather
                // than letting the admin fill in values nothing will read.
                const removing = d.status === NO_RECORD_ID
                return (
                  <tr key={row.student_id} className={clsx(dirty && 'bg-brand-50/50')}>
                    <td>
                      {!locked && (
                        <input type="checkbox" className="rounded border-slate-300"
                          checked={selected.has(row.student_id)}
                          onChange={() => setSelected(prev => {
                            const n = new Set(prev)
                            n.has(row.student_id) ? n.delete(row.student_id) : n.add(row.student_id)
                            return n
                          })}/>
                      )}
                    </td>
                    <td>
                      <p className="font-medium text-slate-800">{formatName(row)}</p>
                      <p className="text-xs text-slate-400 font-mono">{row.lrn}</p>
                    </td>
                    <td className="text-xs whitespace-nowrap"><LastAttended row={row}/></td>
                    <td>
                      <select className="input py-1.5 text-sm min-w-[110px]" value={removing ? '' : (d.grade_level || '')}
                        onChange={e => setDraft(row, { grade_level: e.target.value })}
                        disabled={locked || removing}>
                        <option value="">—</option>
                        {scopedGrades.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input py-1.5 text-sm min-w-[110px]" value={removing ? '' : (d.section || '')}
                        onChange={e => setDraft(row, { section: e.target.value })}
                        disabled={locked || removing || !secOptions.length}>
                        <option value="">{secOptions.length ? 'Unassigned' : 'No sections'}</option>
                        {secOptions.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td>
                      {dirty ? (
                        <select className="input py-1.5 text-sm min-w-[130px]" value={d.status}
                          onChange={e => setDraft(row, { status: e.target.value })}>
                          {SELECTABLE_STATUSES.map(o => {
                            const why = o.id !== NO_RECORD_ID ? null
                              : row.outcome ? 'has a year-end outcome'
                              : row.has_academic_records ? 'has recorded work this year'
                              : null
                            return (
                              <option key={o.id} value={o.id} disabled={!!why}>
                                {o.label}{why ? ` — ${why}` : ''}
                              </option>
                            )
                          })}
                        </select>
                      ) : locked ? (
                        <StatusBadge status={statusOf(row)}/>
                      ) : (
                        <button onClick={() => setDraft(row, {})} title="Click to change">
                          <StatusBadge status={statusOf(row)}/>
                        </button>
                      )}
                    </td>
                    <td>
                      {row.outcome ? (
                        <span title={row.outcome_remarks || 'Recorded in Year-End Promotion'}
                          className={clsx('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap', statusClasses(row.outcome))}>
                          {statusLabel(row.outcome)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300"
                          title={`How SY ${selectedSY?.label} ended for this learner. Set in Year-End Promotion.`}>—</span>
                      )}
                    </td>
                    <td>
                      {dirty && (
                        <button onClick={() => clearDraft(row)} title="Discard this change"
                          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                          <RotateCcw size={13}/>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Collapsing a mixed batch into one grade — confirmed, not applied, and
          the section wipe is spelled out because nothing else on screen says so. */}
      <Modal open={!!pendingBulkGrade} onClose={() => setPendingBulkGrade(null)}
        title="Move learners across grade levels?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            The {selected.size} learners you selected are in <strong>{selectionGrades.length} different
            grade levels</strong>. Setting a grade level applies the same one to all of them.
          </p>
          <div className="p-4 bg-slate-50 rounded-xl space-y-1.5">
            {selectionGrades.map(([g, n]) => (
              <div key={g} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{g}</span>
                <span className="text-slate-400">
                  {n} learner{n === 1 ? '' : 's'} &rarr; <strong className="text-slate-700">{pendingBulkGrade}</strong>
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
            <p>
              All <strong>{selected.size}</strong> will move into <strong>{pendingBulkGrade}</strong>, and
              their <strong>sections will be cleared</strong> &mdash; a section belongs to one grade level.
              Nothing is written until you press Save, and Discard undoes it.
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setPendingBulkGrade(null)}
              className="btn-secondary flex-1">Cancel</button>
            <button type="button"
              onClick={() => { setBulkGrade(pendingBulkGrade); bulkSet({ grade_level: pendingBulkGrade }); setPendingBulkGrade(null) }}
              className="btn-primary flex-1 justify-center">
              Move all to {pendingBulkGrade}
            </button>
          </div>
        </div>
      </Modal>

      {/* Sticky save bar */}
      {dirtyCount > 0 && (
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-30 bg-white border-t border-slate-200 shadow-lg animate-slide-up">
          <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">
              {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'} for SY {selectedSY?.label}
              {removalCount > 0 && (
                <span className="text-slate-500 font-normal">
                  {' '}&middot; {removalCount} record{removalCount === 1 ? '' : 's'} will be removed
                </span>
              )}
            </span>
            <button onClick={() => { setDrafts({}); setSelected(new Set()) }}
              className="ml-auto btn-secondary text-sm">Discard</button>
            <button onClick={save} disabled={saving}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
              <Save size={15}/> {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

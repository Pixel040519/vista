import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Check, AlertTriangle, Info, ChevronDown, ChevronRight,
  GraduationCap, Search, Wand2, Loader2, Lock, Unlock,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { enrollmentApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState } from '../components/UI'
import { SYStatusPill, syStatus, isArchivedYear } from '../components/SchoolYearPicker'
import { useAuth } from '../context/AuthContext'
import { ALL_GRADES } from '../utils/roles'
import { statusLabel, statusClasses, PROMOTION_OUTCOMES, MOVES_ON_OUTCOMES } from '../utils/enrollment'
import { formatName } from '../utils/nameHelper'

const STEPS = ['Review results', 'Place learners', 'Confirm']

// The last grade level the school offers — the only one a learner can graduate
// from. Derived from the ladder, so retiring or adding a level moves it too.
const EXIT_GRADE = ALL_GRADES[ALL_GRADES.length - 1]

/**
 * The year a closing year hands over to: the next one in sequence, nothing else.
 *
 * This used to be a free choice defaulting to the earliest *upcoming* year,
 * which is not the same thing once a year has been activated. Re-running the
 * wizard on an older year then closed it into the year after next: the outcome
 * changed and a fresh placement appeared two years out, while the placement in
 * the year actually being handed to kept the grade level it had been given
 * before. Deriving it means a re-run always corrects the record it wrote first.
 */
/**
 * Where an outcome sends a learner, always derived from the grade level they are
 * leaving — never from whatever placement happens to be on file.
 *
 * `next_grade_level` is only a seed, and after a retention has been committed it
 * holds the *unchanged* grade. Reading it here meant flipping
 * Promoted -> Retained -> Promoted left the learner in the same grade level.
 */
const placementFor = (s, outcome) => {
  if (outcome === 'retained') return s.retained_grade_level || s.grade_level
  if (outcome === 'promoted') return s.promoted_grade_level || ''
  return ''   // a graduate has no placement at all
}

const nextYearAfter = (list, source) =>
  !source ? null : list.filter(sy => sy.label > source.label).sort((a, b) => a.label.localeCompare(b.label))[0] || null

// Only these two carry a learner into the next school year. A graduate leaves,
// and a placement for them would be a lie — which is why they stop appearing in
// later years' rosters.
const MOVES_ON = MOVES_ON_OUTCOMES

function StepBar({ step }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
            i === step ? 'bg-brand-500 text-white shadow-md shadow-brand-200'
              : i < step ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-400'
          )}>
            <span className={clsx(
              'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold',
              i === step ? 'bg-white/25' : i < step ? 'bg-emerald-200' : 'bg-slate-200'
            )}>
              {i < step ? <Check size={12}/> : i + 1}
            </span>
            {label}
          </div>
          {i < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300"/>}
        </div>
      ))}
    </div>
  )
}

/** The numbers the recommendation came from — this is the "why". */
function Evidence({ ev, open }) {
  if (!ev) return null

  if (ev.mode === 'descriptive') {
    const BAND_TONE = {
      ok: 'text-emerald-700', watch: 'text-amber-700',
      urgent: 'text-red-700', insufficient: 'text-slate-400',
    }
    return (
      <div className="text-xs">
        <span className={clsx('font-medium', BAND_TONE[ev.band])}>
          {ev.band === 'insufficient' ? 'Not enough ratings' : `Competency: ${ev.band}`}
        </span>
        <span className="text-slate-400"> · {ev.rated}/{ev.total_skills} rated</span>
        {open && ev.distribution && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(ev.distribution).map(([code, n]) => (
              <span key={code} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                {code} × {n}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!ev.subjects_graded) {
    return <span className="text-xs text-slate-400">No grades recorded</span>
  }

  return (
    <div className="text-xs">
      <span className="font-medium text-slate-700">Avg {ev.general_average}</span>
      <span className={clsx('ml-1.5', ev.subjects_failed ? 'text-red-600 font-medium' : 'text-slate-400')}>
        {ev.subjects_failed
          ? `${ev.subjects_failed} of ${ev.subjects_graded} below ${ev.passing_grade}`
          : `all ${ev.subjects_graded} passed`}
      </span>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ev.subjects.map(s => (
            <span key={s.subject_id}
              className={clsx(
                'px-1.5 py-0.5 rounded font-mono',
                s.final_grade < ev.passing_grade ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
              )}>
              {s.subject_name} {s.final_grade}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PromotionWizard() {
  const navigate = useNavigate()
  const { gradeScope } = useAuth()
  const scopedGrades = useMemo(
    () => (gradeScope?.length ? ALL_GRADES.filter(g => gradeScope.includes(g)) : ALL_GRADES),
    [gradeScope]
  )

  const [step, setStep] = useState(0)
  const [schoolYears, setSchoolYears] = useState([])
  const [sourceId, setSourceId] = useState('')

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  // Decisions live here, keyed by student_id, seeded from the recommendations.
  const [decisions, setDecisions] = useState({})
  const [expanded, setExpanded]   = useState(() => new Set())

  const [gradeFilter, setGradeFilter] = useState('')
  const [search, setSearch]           = useState('')
  const [reviewOnly, setReviewOnly]   = useState(false)

  // ── School years ───────────────────────────────────────────
  useEffect(() => {
    curriculumApi.getSchoolYears()
      .then(res => {
        const list = res.data.school_years || []
        setSchoolYears(list)
        // Close the year that is running. Where its learners go is derived.
        const active = list.find(s => s.is_active)
        setSourceId(active?.id || list[0]?.id || '')
      })
      .catch(() => toast.error('Failed to load school years.'))
  }, [])

  const source = schoolYears.find(s => s.id === sourceId) || null
  const target = nextYearAfter(schoolYears, source)
  const targetId = target?.id || ''

  // Keyed on the year learners move *into*, not the closing year. Writing an
  // outcome onto an already-archived closing year is the normal sequence — that
  // is what closing last year after activating this one does. What rewrites
  // history is the placement upsert and the graduated-row delete, and both land
  // on the target.
  const [unlocked, setUnlocked] = useState(false)
  const historical = isArchivedYear(target)
  const locked     = historical && !unlocked

  // ── Review data ────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!sourceId) return
    setLoading(true)
    try {
      const res = await enrollmentApi.promotionReview(sourceId, targetId || undefined)
      setData(res.data)
      // Seed every row: a decision already committed wins, then the
      // recommendation, and rows with neither stay blank for a human to fill.
      const seed = {}
      for (const s of res.data.students) {
        const outcome = s.decided_outcome || s.recommendation || ''
        seed[s.student_id] = {
          outcome,
          remarks: s.decided_remarks || '',
          // A placement already committed wins — it may have been hand-picked in
          // step 2 last time. Otherwise derive it from the outcome being seeded,
          // so the grade level always agrees with the decision shown next to it.
          next_grade_level: s.already_placed ? (s.next_grade_level || '') : placementFor(s, outcome),
          next_section: s.already_placed ? (s.next_section || '') : '',
        }
      }
      setDecisions(seed)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load the promotion review.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sourceId, targetId])

  useEffect(() => { load() }, [load])
  // Unlocking is per pair of years: it must not carry into the next one chosen.
  useEffect(() => { setStep(0); setUnlocked(false) }, [sourceId, targetId])

  const students = data?.students || []
  const set = (id, patch) => setDecisions(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  const setOutcome = (s, outcome) => {
    const next_grade_level = placementFor(s, outcome)
    // The section belongs to a grade level, so it cannot survive a move.
    const patch = { outcome, next_grade_level }
    if (next_grade_level !== (decisions[s.student_id] || {}).next_grade_level) patch.next_section = ''
    set(s.student_id, patch)
  }

  const acceptAll = () => {
    if (locked) { toast.error(`SY ${target?.label} is archived — unlock this wizard to correct records that are already history.`); return }
    const next = { ...decisions }
    let n = 0
    for (const s of students) {
      if (!s.recommendation) continue
      const next_grade_level = placementFor(s, s.recommendation)
      next[s.student_id] = {
        ...next[s.student_id],
        outcome: s.recommendation,
        next_grade_level,
        next_section: next_grade_level === (next[s.student_id] || {}).next_grade_level
          ? (next[s.student_id] || {}).next_section
          : '',
      }
      n++
    }
    setDecisions(next)
    toast.success(`Accepted ${n} recommendation${n === 1 ? '' : 's'}. Rows with no results still need a decision.`)
  }

  // ── Filtering (step 1 only) ────────────────────────────────
  const visible = students.filter(s => {
    if (gradeFilter && s.grade_level !== gradeFilter) return false
    if (reviewOnly && !s.needs_review) return false
    if (search) {
      const q = search.toLowerCase()
      if (!s.full_name?.toLowerCase().includes(q) && !s.lrn?.includes(q)) return false
    }
    return true
  })

  const undecided = students.filter(s => !decisions[s.student_id]?.outcome)

  // Overriding a retention recommendation into a promotion is a judgement the
  // data does not support, so it has to be justified in writing.
  const unjustified = students.filter(s =>
    s.recommendation === 'retained' &&
    decisions[s.student_id]?.outcome === 'promoted' &&
    !decisions[s.student_id]?.remarks?.trim()
  )

  const movers = students.filter(s => MOVES_ON.includes(decisions[s.student_id]?.outcome))
  const unplaced = movers.filter(s => !decisions[s.student_id]?.next_grade_level)

  const goStep2 = () => {
    if (locked) { toast.error(`SY ${target?.label} is archived — unlock this wizard to correct records that are already history.`); return }
    if (undecided.length) { toast.error(`${undecided.length} learner(s) still need a decision.`); return }
    if (unjustified.length) {
      toast.error(`${unjustified.length} learner(s) were promoted against the recommendation — add a reason first.`)
      setReviewOnly(false); setGradeFilter('')
      return
    }
    if (!targetId) {
      toast.error(`SY ${source?.label} is the most recent school year — create the next one in Curriculum Management first.`)
      return
    }
    setStep(1)
  }

  const goStep3 = () => {
    if (unplaced.length) { toast.error(`${unplaced.length} learner(s) have no grade level for SY ${target?.label}.`); return }
    setStep(2)
  }

  const commit = async () => {
    setSaving(true)
    try {
      const payload = students.map(s => {
        const d = decisions[s.student_id]
        const moves = MOVES_ON.includes(d.outcome)
        return {
          student_id: s.student_id,
          outcome: d.outcome,
          remarks: d.remarks?.trim() || undefined,
          next_grade_level: moves ? d.next_grade_level : undefined,
          next_section: moves ? (d.next_section || undefined) : undefined,
        }
      })
      const res = await enrollmentApi.promote(sourceId, targetId, payload, historical && unlocked)
      toast.success(res.data.message, { duration: 7000 })
      navigate('/enrollment')
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to commit the promotion.')
    } finally {
      setSaving(false)
    }
  }

  // Learners the API left out: they transferred out, dropped, or were never
  // confirmed, so there is no year for them to have an outcome from.
  const excluded = data?.excluded || {}
  const excludedTotal = Object.values(excluded).reduce((a, b) => a + b, 0)
  const excludedLabels = Object.entries(excluded).map(([id, n]) =>
    `${n} learner${n === 1 ? '' : 's'} ${statusLabel(id).toLowerCase()}`)

  const outcomeCounts = students.reduce((a, s) => {
    const o = decisions[s.student_id]?.outcome || 'undecided'
    a[o] = (a[o] || 0) + 1
    return a
  }, {})

  const sectionsFor = (grade) => (data?.target_sections?.[grade] || [])

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fade-in pb-24">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/enrollment" className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 mb-1">
            <ArrowLeft size={14}/> Back to Enrollment
          </Link>
          <h1 className="page-title flex items-center gap-2">
            <GraduationCap size={22} className="text-brand-500"/> Year-End Promotion
          </h1>
          <p className="page-subtitle">
            Close a school year and decide who moves up, who repeats, and who has left.
          </p>
        </div>
      </div>

      {/* Which year closes into which */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Closing school year</label>
          {/* Labelled with status, because the derived target beside it carries a
              pill and an unlabelled source made a closed year look like any other.
              An upcoming year has no results to judge, so it is not on offer. */}
          <select className="input w-auto min-w-[150px]" value={sourceId} onChange={e => setSourceId(e.target.value)}>
            {schoolYears.map(sy => (
              <option key={sy.id} value={sy.id} disabled={syStatus(sy) === 'upcoming'}>
                SY {sy.label} &middot; {syStatus(sy) === 'upcoming' ? 'not started' : syStatus(sy)}
              </option>
            ))}
          </select>
        </div>
        <ArrowRight size={18} className="text-slate-300 mb-2.5"/>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Learners move into</label>
          {/* Derived, not chosen: a year hands over to the next one in sequence.
              Choosing it was how a re-run could be committed into the wrong year,
              leaving the placements it wrote the first time behind. */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 min-w-[150px]">
            {target ? (
              <>
                <span className="text-sm font-semibold text-slate-800">SY {target.label}</span>
                <SYStatusPill sy={target}/>
              </>
            ) : (
              <span className="text-sm text-slate-400 italic">No later school year</span>
            )}
          </div>
        </div>
        <div className="ml-auto"><StepBar step={step}/></div>
      </div>

      {historical && (
        <div className={clsx(
          'flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 border',
          unlocked ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600'
        )}>
          {unlocked ? <AlertTriangle size={14} className="shrink-0 mt-0.5"/> : <Lock size={14} className="shrink-0 mt-0.5"/>}
          <p className="flex-1">
            {unlocked
              ? <>SY {source?.label} and SY {target?.label} are both <strong>archived</strong>, and you are editing
                  their history. Committing rewrites outcomes and placements that are already on record.</>
              : <>SY {source?.label} hands over to SY {target?.label}, and both are <strong>archived</strong>.
                  Closing one closed year into another rewrites records that are already history, so this is
                  read-only. Unlock only to correct a decision that is wrong.</>}
          </p>
          {locked && (
            <button onClick={() => setUnlocked(true)}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 font-medium hover:border-slate-400 transition-colors">
              <Unlock size={12}/> Edit historical records
            </button>
          )}
        </div>
      )}

      {source?.is_active && (
        <div className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2.5">
          <Info size={14} className="shrink-0 mt-0.5"/>
          <p>
            SY {source.label} is still the active year. Recording outcomes here does not move anyone yet &mdash;
            learners keep their current class until SY {target?.label || 'the next year'} is activated in
            Curriculum Management. Only the three &ldquo;left the school&rdquo; outcomes take effect immediately.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg"/></div>
      ) : !students.length ? (
        <EmptyState icon={GraduationCap} title="Nothing to promote"
          description={`No learners have an enrolment record for SY ${source?.label || ''}.`}
          action={<Link to="/enrollment" className="btn-primary">Go to Enrollment</Link>}/>
      ) : (
        <>
          {/* ── Step 1: review ────────────────────────────── */}
          {step === 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input className="input pl-9" placeholder="Search name or LRN..."
                    value={search} onChange={e => setSearch(e.target.value)}/>
                </div>
                <select className="input w-auto min-w-[150px]" value={gradeFilter}
                  onChange={e => setGradeFilter(e.target.value)}>
                  <option value="">All Grade Levels</option>
                  {scopedGrades.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <button onClick={() => setReviewOnly(v => !v)}
                  className={clsx('px-3 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2',
                    reviewOnly ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300')}>
                  <AlertTriangle size={14}/> Needs review ({data.summary.needs_review || 0})
                </button>
                <button onClick={acceptAll} disabled={locked}
                  className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Wand2 size={15}/> Accept all recommendations
                </button>
              </div>

              {excludedTotal > 0 && (
                <div className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2.5">
                  <Info size={14} className="shrink-0 mt-0.5"/>
                  <p>
                    {excludedLabels.join(', ')} in SY {source?.label}, so {excludedTotal === 1 ? 'it is' : 'they are'} not
                    part of promotion &mdash; {excludedTotal === 1 ? 'that learner' : 'those learners'} did not finish the year.
                    Their status is already recorded on the{' '}
                    <Link to="/enrollment" className="underline font-medium">Enrollment page</Link>.
                  </p>
                </div>
              )}

              {undecided.length > 0 && (
                <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
                  <p>
                    <strong>{undecided.length}</strong> learner{undecided.length === 1 ? ' has' : 's have'} no
                    recommendation because nothing was recorded for them this year. Decide those yourself &mdash;
                    VISTA will not guess.
                  </p>
                </div>
              )}

              <div className="card overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>Learner</th>
                      <th className="whitespace-nowrap">Class</th>
                      <th className="whitespace-nowrap">Results</th>
                      <th className="whitespace-nowrap">Recommendation</th>
                      <th className="whitespace-nowrap">Decision</th>
                      <th className="whitespace-nowrap">Moves into</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(s => {
                      const d = decisions[s.student_id] || {}
                      const open = expanded.has(s.student_id)
                      const overridden = s.recommendation && d.outcome && d.outcome !== s.recommendation
                      const needsReason = s.recommendation === 'retained' && d.outcome === 'promoted'
                      return (
                        <tr key={s.student_id}
                          className={clsx(s.needs_review && 'border-l-2 border-l-amber-400')}>
                          <td>
                            <button onClick={() => setExpanded(p => {
                              const n = new Set(p)
                              n.has(s.student_id) ? n.delete(s.student_id) : n.add(s.student_id)
                              return n
                            })}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                              {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                            </button>
                          </td>
                          <td>
                            <p className="font-medium text-slate-800">{formatName(s)}</p>
                            <p className="text-xs text-slate-400 font-mono">{s.lrn}</p>
                          </td>
                          <td className="text-xs text-slate-500 whitespace-nowrap">
                            {s.grade_level}{s.section ? ` — ${s.section}` : ''}
                            {s.is_exit_grade && (
                              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-700 font-medium">
                                final level
                              </span>
                            )}
                          </td>
                          <td className="min-w-[180px]"><Evidence ev={s.evidence} open={open}/></td>
                          <td className="max-w-[240px]">
                            {s.recommendation ? (
                              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap', statusClasses(s.recommendation))}>
                                {statusLabel(s.recommendation)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 italic">none</span>
                            )}
                            {open && <p className="text-xs text-slate-500 mt-1.5">{s.reason}</p>}
                          </td>
                          <td className="min-w-[170px]">
                            {/* Graduating is only on offer at the final grade
                                level. Anywhere else it is a mis-click that ends a
                                learner's schooling — it is the one outcome that
                                writes `students.enrollment_status`, and they drop
                                off every later roster. The API refuses it too. */}
                            <select className={clsx('input py-1.5 text-sm', !d.outcome && !locked && 'border-amber-300')}
                              disabled={locked}
                              value={d.outcome || ''} onChange={e => setOutcome(s, e.target.value)}>
                              <option value="">Decide...</option>
                              {PROMOTION_OUTCOMES.map(o => (
                                <option key={o} value={o} disabled={o === 'graduated' && !s.is_exit_grade}>
                                  {statusLabel(o)}
                                  {o === 'graduated' && !s.is_exit_grade ? ` — ${EXIT_GRADE} only` : ''}
                                </option>
                              ))}
                            </select>
                            {(overridden || needsReason) && (
                              <input
                                className={clsx('input py-1.5 text-xs mt-1.5',
                                  needsReason && !d.remarks?.trim() && 'border-red-300')}
                                placeholder={needsReason ? 'Reason required' : 'Reason (optional)'}
                                value={d.remarks || ''} maxLength={500} disabled={locked}
                                onChange={e => set(s.student_id, { remarks: e.target.value })}/>
                            )}
                          </td>
                          {/* The grade level the decision produces, shown where
                              the decision is made. Retained keeps the level,
                              promoted advances one, and a graduate has no
                              placement at all — the "Class" column beside it is
                              the level being left, which never moves. */}
                          <td className="whitespace-nowrap text-xs">
                            {!d.outcome ? (
                              <span className="text-slate-300">&mdash;</span>
                            ) : d.outcome === 'graduated' ? (
                              <span className="text-slate-500">Leaves the school</span>
                            ) : d.next_grade_level ? (
                              <span className="text-slate-700 font-medium">
                                {d.next_grade_level}
                                {d.next_grade_level === s.grade_level && (
                                  <span className="ml-1 text-slate-400 font-normal">(repeats)</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-amber-600 font-medium">No grade level</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!visible.length && (
                  <p className="text-sm text-slate-400 text-center py-8">No learners match these filters.</p>
                )}
              </div>
            </>
          )}

          {/* ── Step 2: placement ─────────────────────────── */}
          {step === 1 && (
            <>
              <div className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2.5">
                <Info size={14} className="shrink-0 mt-0.5"/>
                <p>
                  Where each learner lands in SY {target?.label}. Section is optional &mdash; you can assign it later
                  from the Enrollment page. Learners who left the school are not listed.
                </p>
              </div>

              {movers.length === 0 ? (
                <EmptyState icon={Info} title="Nobody moves on"
                  description="Every learner was recorded as having left the school."/>
              ) : (
                <div className="space-y-4">
                  {[...new Set(movers.map(s => decisions[s.student_id].next_grade_level || ''))]
                    .sort((a, b) => ALL_GRADES.indexOf(a) - ALL_GRADES.indexOf(b))
                    .map(grade => {
                      const rows = movers.filter(s => (decisions[s.student_id].next_grade_level || '') === grade)
                      const options = sectionsFor(grade)
                      // A learner can land here with no grade level — overriding
                      // "Graduated" to "Promoted" at the final level leaves
                      // nowhere to move up to. Give those rows their own group
                      // rather than letting them fall through silently.
                      if (!grade) {
                        return (
                          <div key="unset" className="card overflow-hidden border-2 border-amber-200">
                            <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
                              <AlertTriangle size={14} className="text-amber-600"/>
                              <p className="text-sm font-semibold text-amber-800">
                                No grade level chosen · {rows.length} learner{rows.length === 1 ? '' : 's'}
                              </p>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="table-base">
                                <thead>
                                  <tr><th>Learner</th><th className="whitespace-nowrap">Coming from</th><th className="whitespace-nowrap">Grade level</th></tr>
                                </thead>
                                <tbody>
                                  {rows.map(s => (
                                    <tr key={s.student_id}>
                                      <td className="font-medium text-slate-800">{formatName(s)}</td>
                                      <td className="text-xs text-slate-500 whitespace-nowrap">
                                        {s.grade_level}{s.section ? ` — ${s.section}` : ''}
                                      </td>
                                      <td>
                                        <select className="input py-1.5 text-sm min-w-[130px] border-amber-300"
                                          value="" disabled={locked}
                                          onChange={e => set(s.student_id, { next_grade_level: e.target.value, next_section: '' })}>
                                          <option value="">Choose...</option>
                                          {scopedGrades.map(g => <option key={g} value={g}>{g}</option>)}
                                        </select>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )
                      }
                      return (
                        <div key={grade} className="card overflow-hidden">
                          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
                            <p className="text-sm font-semibold text-slate-800">
                              {grade} <span className="text-slate-400 font-normal">· {rows.length} learner{rows.length === 1 ? '' : 's'}</span>
                            </p>
                            {options.length > 0 ? (
                              <select className="input w-auto py-1.5 text-sm ml-auto" value="" disabled={locked}
                                onChange={e => {
                                  if (!e.target.value) return
                                  rows.forEach(s => set(s.student_id, { next_section: e.target.value }))
                                  e.target.value = ''
                                }}>
                                <option value="">Assign all to section...</option>
                                {options.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            ) : (
                              <span className="ml-auto text-xs text-amber-700 flex items-center gap-1.5">
                                <AlertTriangle size={13}/>
                                No sections defined for {grade} in SY {target?.label} &mdash;{' '}
                                <Link to="/curriculum" className="underline font-medium">add some</Link>
                              </span>
                            )}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="table-base">
                              <thead>
                                <tr>
                                  <th>Learner</th>
                                  <th className="whitespace-nowrap">Coming from</th>
                                  <th className="whitespace-nowrap">Outcome</th>
                                  <th className="whitespace-nowrap">Grade level</th>
                                  <th className="whitespace-nowrap">Section</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(s => {
                                  const d = decisions[s.student_id]
                                  return (
                                    <tr key={s.student_id}>
                                      <td className="font-medium text-slate-800">{formatName(s)}</td>
                                      <td className="text-xs text-slate-500 whitespace-nowrap">
                                        {s.grade_level}{s.section ? ` — ${s.section}` : ''}
                                      </td>
                                      <td>
                                        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', statusClasses(d.outcome))}>
                                          {statusLabel(d.outcome)}
                                        </span>
                                      </td>
                                      <td>
                                        <select className="input py-1.5 text-sm min-w-[120px]"
                                          value={d.next_grade_level || ''} disabled={locked}
                                          onChange={e => set(s.student_id, { next_grade_level: e.target.value, next_section: '' })}>
                                          {scopedGrades.map(g => <option key={g} value={g}>{g}</option>)}
                                        </select>
                                      </td>
                                      <td>
                                        <select className="input py-1.5 text-sm min-w-[130px]"
                                          value={d.next_section || ''} disabled={locked || !options.length}
                                          onChange={e => set(s.student_id, { next_section: e.target.value })}>
                                          <option value="">{options.length ? 'Unassigned' : 'No sections'}</option>
                                          {options.map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </>
          )}

          {/* ── Step 3: confirm ───────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="card p-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Closing SY {source?.label} → SY {target?.label}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {PROMOTION_OUTCOMES.filter(o => outcomeCounts[o]).map(o => (
                    <div key={o} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <p className="text-2xl font-bold text-slate-800">{outcomeCounts[o]}</p>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', statusClasses(o))}>
                        {statusLabel(o)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
                <div className="space-y-1">
                  <p>
                    This records the outcome on every SY {source?.label} record and creates
                    <strong> {movers.length}</strong> record{movers.length === 1 ? '' : 's'} in SY {target?.label},
                    each marked <strong>Pending</strong>.
                  </p>
                  <p>
                    Pending means &ldquo;expected, not yet confirmed&rdquo;. Nobody appears on a teacher&rsquo;s class list
                    until you confirm them on the Students page or set them to Enrolled from Enrollment.
                  </p>
                  <p>Running this again later updates the same records rather than duplicating them.</p>
                </div>
              </div>

              {movers.some(s => !decisions[s.student_id].next_section) && (
                <div className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2.5">
                  <Info size={14} className="shrink-0 mt-0.5"/>
                  <p>
                    {movers.filter(s => !decisions[s.student_id].next_section).length} learner(s) have no section
                    yet. That is allowed &mdash; assign them from the Enrollment page whenever the sections exist.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Footer nav ────────────────────────────────── */}
          <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-30 bg-white border-t border-slate-200 shadow-lg">
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
              <span className="text-sm text-slate-500">
                {step === 0 && `${students.length - undecided.length} of ${students.length} decided`}
                {step === 1 && `${movers.length - unplaced.length} of ${movers.length} placed`}
                {step === 2 && `Ready to close SY ${source?.label}`}
              </span>
              {step > 0 && (
                <button onClick={() => setStep(step - 1)} className="ml-auto btn-secondary text-sm">
                  <ArrowLeft size={15}/> Back
                </button>
              )}
              {step === 0 && (
                <button onClick={goStep2} className="ml-auto btn-primary flex items-center gap-2 text-sm">
                  Place learners <ArrowRight size={15}/>
                </button>
              )}
              {step === 1 && (
                <button onClick={goStep3} className="btn-primary flex items-center gap-2 text-sm">
                  Review &amp; confirm <ArrowRight size={15}/>
                </button>
              )}
              {step === 2 && (
                <button onClick={commit} disabled={saving || locked}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin"/> : <Check size={15}/>}
                  {saving ? 'Closing...' : `Close SY ${source?.label}`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

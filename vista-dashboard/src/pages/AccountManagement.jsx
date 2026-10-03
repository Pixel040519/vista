import { useState, useEffect, useCallback } from 'react'
import {
  UserCog, Plus, Pencil, Trash2, ShieldOff, ShieldCheck, X, BookOpen, History,
  GraduationCap, RotateCcw, MailPlus, AlertTriangle, Phone, Mail, UserRound, CalendarDays,
} from 'lucide-react'
import { accountApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal, PhoneInput } from '../components/UI'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { formatName, nameInitial, titleCase } from '../utils/nameHelper'
import { useAuth } from '../context/AuthContext'
import { ROLES, ROLE_LABELS } from '../utils/roles'
import ParentAccounts from '../components/ParentAccounts'
import {
  STAFF_ACCESS_STATES, staffAccessOf, staffAccessDetail, canReissue, canCancel, canChangeStaffEmail,
} from '../utils/staffAccess'
import { invitationOpenUntil, fmtDate } from '../utils/accessDisplay'
import {
  RosterFilters, stateChips, PersonCell, AccessCell, RowActions, RowMenu, useRowMenus,
  WhatHappensNext, InvitationCreated, titled, AccountPanel, DiscardButton,
} from '../components/AccountRoster'

// ── School Data ───────────────────────────────────────────────
const GRADE_LEVELS = [
  'Kinder',
  'Grade 1', 'Grade 2', 'Grade 3',
  'Grade 4', 'Grade 5', 'Grade 6',
]

// Sections and subjects loaded live from curriculum API per grade level

// ── Assignment Row Component ──────────────────────────────────
function AssignmentRow({ row, index, onChange, onRemove, takenAssignments = [], gradeOptions = GRADE_LEVELS, locked = false }) {
  const [sections, setSections] = useState([])
  const [subjects, setSubjects] = useState([])

  // Fetch live sections + subjects whenever grade level changes
  useEffect(() => {
    if (!row.grade_level) { setSections([]); setSubjects([]); return }
    Promise.all([
      curriculumApi.getSections({ grade_level: row.grade_level }),
      curriculumApi.getSubjects({ grade_level: row.grade_level }),
    ]).then(([secRes, subRes]) => {
      setSections(secRes.data.sections || [])
      setSubjects(subRes.data.subjects || [])
    }).catch(() => { setSections([]); setSubjects([]) })
  }, [row.grade_level])

  const isTaken = (gradeLevel, section, subject) =>
    takenAssignments.some(a => a.grade_level === gradeLevel && a.section === section && a.subject === subject)

  const getTakenBy = (gradeLevel, section, subject) => {
    const match = takenAssignments.find(a => a.grade_level === gradeLevel && a.section === section && a.subject === subject)
    return match?.teacher_name || ''
  }

  const set = (field, val) => {
    const updated = { ...row, [field]: val }
    // Reset section/subject if grade changes
    if (field === 'grade_level') {
      updated.section = ''
      updated.subject = ''
    }
    if (field === 'section') {
      updated.subject = ''
    }
    onChange(index, updated)
  }

  return (
    <div className={clsx('grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center', locked && 'opacity-60')}>
      {/* Grade Level */}
      <select
        className="input text-xs py-2"
        value={row.grade_level}
        onChange={e => set('grade_level', e.target.value)}
        disabled={locked}
      >
        <option value="">Grade Level</option>
        {locked && row.grade_level && !gradeOptions.includes(row.grade_level) && (
          <option value={row.grade_level}>{row.grade_level}</option>
        )}
        {gradeOptions.map(g => <option key={g}>{g}</option>)}
      </select>

      {/* Section */}
      <select
        className="input text-xs py-2"
        value={row.section}
        onChange={e => set('section', e.target.value)}
        disabled={locked || !row.grade_level}
      >
        <option value="">Section</option>
        {locked && row.section && !sections.some(s => s.name === row.section) && (
          <option value={row.section}>{row.section}</option>
        )}
        {sections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
      </select>

      {/* Subject */}
      <select
        className={clsx('input text-xs py-2', !locked && row.subject && row.section && isTaken(row.grade_level, row.section, row.subject) && 'border-red-400 text-red-600')}
        value={row.subject}
        onChange={e => set('subject', e.target.value)}
        disabled={locked || !row.grade_level || !row.section}
      >
        <option value="" style={{ color: '#334155' }}>Subject</option>
        {locked && row.subject && !subjects.some(s => s.name === row.subject) && (
          <option value={row.subject}>{row.subject}</option>
        )}
        {subjects.map(s => {
          const taken = row.section && isTaken(row.grade_level, row.section, s.name)
          const takenBy = taken ? getTakenBy(row.grade_level, row.section, s.name) : ''
          return (
            <option key={s.id} value={s.name} disabled={taken}
              style={{ color: taken ? '#dc2626' : '#334155' }}>
              {s.name}{taken ? ` (${takenBy})` : ''}
            </option>
          )
        })}
      </select>

      {locked ? (
        <span
          className="text-[10px] font-medium text-slate-400 px-1.5 uppercase tracking-wide"
          title="Outside your grade scope — read-only"
        >
          Locked
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label="Remove assignment"
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <X size={15} />
        </button>
      )}
    </div>
  )
}

// ── Empty assignment row ──────────────────────────────────────
const emptyRow = () => ({ grade_level: '', section: '', subject: '' })


// ── Shared form pieces ────────────────────────────────────────
const LABEL = 'block text-sm font-medium text-slate-700 mb-1.5'
const OPTIONAL = <span className="text-slate-500 font-normal">(optional)</span>
const SECTION = 'text-xs font-semibold text-slate-500 uppercase tracking-wider'

// Name fields in one row, then sign-in email beside mobile — the same layout in
// both forms. Email is editable until the account holder activates (a typo is
// the likeliest reason an invitation goes unused); after that it is how they
// sign in, and the API refuses to change it.
function PersonFields({ form, setField, mode, emailEditable }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={LABEL} htmlFor="pf-surname">Surname</label>
          <input id="pf-surname" className="input" placeholder="Dela Cruz" value={form.surname}
            onChange={e => setField('surname', e.target.value)} onBlur={e => setField('surname', titleCase(e.target.value))} required />
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-first">First name</label>
          <input id="pf-first" className="input" placeholder="Juan" value={form.first_name}
            onChange={e => setField('first_name', e.target.value)} onBlur={e => setField('first_name', titleCase(e.target.value))} required />
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-middle">Middle name {OPTIONAL}</label>
          <input id="pf-middle" className="input" placeholder="Santos" value={form.middle_name}
            onChange={e => setField('middle_name', e.target.value)} onBlur={e => setField('middle_name', titleCase(e.target.value))} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_1fr] gap-3">
        <div>
          <label className={LABEL} htmlFor="pf-email">Sign-in email</label>
          <input id="pf-email" className="input" type="email" placeholder="name@school.edu.ph"
            value={form.email} onChange={e => setField('email', e.target.value)}
            required disabled={!emailEditable} />
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {!emailEditable
              ? "They've activated their account, so this is how they sign in and can't be changed here."
              : mode === 'edit'
                ? "Can still be corrected because they haven't activated yet. Saving a new address cancels any code already sent."
                : "They'll sign in with this address. You can still correct it until they activate."}
          </p>
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-phone">Mobile number {OPTIONAL}</label>
          <PhoneInput id="pf-phone" className="input pr-10" value={form.phone}
            onChange={v => setField('phone', v)} />
        </div>
      </div>
    </>
  )
}

// What saving a staff invitation does, said once where it is decided.
const STAFF_NEXT = [
  <>Saving sends nothing. The account waits as <b className="text-blue-700">Pending Activation</b> for 30 days.</>,
  <>Tell them to open VISTA's sign-in page and choose <b className="text-slate-800">Activate your account</b>.</>,
  <>They enter this email, receive a 6-digit code, and create their password.</>,
]

// `onDiscard` (edit only) adds Discard changes on the left: it puts the form
// back to how it opened and stays disabled until something differs from that.
// An edit's Save is held the same way, as the Parents tab's is — there is
// nothing to save yet. A create form passes no `onDiscard` and is unaffected.
function FormFooter({ onClose, saving, label, savingLabel, onDiscard, dirty }) {
  const unchanged = !!onDiscard && !dirty
  return (
    <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
      {onDiscard && <DiscardButton onClick={onDiscard} disabled={!dirty || saving} />}
      <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
      <button type="submit" disabled={saving || unchanged} className="btn-primary justify-center disabled:opacity-60">
        {saving ? savingLabel : label}
      </button>
    </div>
  )
}

/** The fields an edit actually sends: email only while it can still change, and only if it did. */
const trimForEdit = (payload, initial, emailEditable) => {
  if (!emailEditable || payload.email.trim().toLowerCase() === (initial?.email || '').toLowerCase()) delete payload.email
  delete payload.full_name
  return payload
}

// ── Teacher Form (shared by create + edit) ────────────────────
function TeacherForm({ initial, onSubmit, onClose, mode }) {
  const { user, gradeScope, isSuperAdmin } = useAuth()
  const activeSY = user?.active_school_year || ''
  const effectiveScope = (isSuperAdmin || !gradeScope?.length) ? GRADE_LEVELS : gradeScope
  const gradeOptions = GRADE_LEVELS.filter(g => effectiveScope.includes(g))
  const isRowLocked = (row) => !isSuperAdmin && !!row.grade_level && !effectiveScope.includes(row.grade_level)
  const teacherId = initial?.id || null
  const emailEditable = mode === 'create' || canChangeStaffEmail(initial)
  // What the form opened with — Discard changes goes back to it, and it is
  // what "has anything changed" is measured against.
  const [start] = useState(() => ({
    surname:     initial?.surname     || '',
    first_name:  initial?.first_name   || '',
    middle_name: initial?.middle_name  || '',
    email:       initial?.email      || '',
    phone:       initial?.phone      || '',
    assignments: initial?.assignments?.length
      ? initial.assignments.map(a => ({
          grade_level: a.grade_level,
          section:     a.section,
          subject:     a.subject,
        }))
      : [emptyRow()],
  }))
  const [form, setForm] = useState(start)
  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const [saving, setSaving]   = useState(false)
  const [takenAssignments, setTakenAssignments] = useState([])
  const [pastYears, setPastYears] = useState({}) // { "2024-2025": [{grade_level,section,subject},...] }
  // The year last copied from, so the select shows it. It was pinned to "",
  // which snapped back to "Select year..." and left no sign a copy had happened.
  const [copiedFrom, setCopiedFrom] = useState('')

  useEffect(() => {
    accountApi.getAssignments()
      .then(res => {
        const all = res.data.assignments || []
        setTakenAssignments(teacherId ? all.filter(a => a.teacher_id !== teacherId) : all)
      })
      .catch(() => setTakenAssignments([]))

    // Fetch assignment history for "Copy from" (edit mode only)
    if (mode === 'edit' && teacherId) {
      accountApi.assignmentHistory(teacherId)
        .then(res => {
          const grouped = {}
          for (const a of (res.data.assignments || [])) {
            if (!grouped[a.school_year]) grouped[a.school_year] = []
            grouped[a.school_year].push({ grade_level: a.grade_level, section: a.section, subject: a.subject })
          }
          setPastYears(grouped)
        })
        .catch(() => setPastYears({}))
    }
  }, [])

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const addRow    = () => setForm(p => ({ ...p, assignments: [...p.assignments, emptyRow()] }))
  const removeRow = (i) => setForm(p => {
    if (isRowLocked(p.assignments[i])) return p
    return { ...p, assignments: p.assignments.filter((_, idx) => idx !== i) }
  })
  const updateRow = (i, val) => setForm(p => {
    if (isRowLocked(p.assignments[i])) return p
    const rows = [...p.assignments]
    rows[i] = val
    return { ...p, assignments: rows }
  })

  const handleSubmit = async e => {
    e.preventDefault()

    // Only send in-scope rows. Locked (out-of-scope) rows are omitted because
    // the backend's scope-aware DELETE preserves them — sending them back would
    // trip assertAssignmentsInScope with a 403.
    const validAssignments = form.assignments
      .filter(a => !isRowLocked(a) && a.grade_level && a.section && a.subject)
      .map(a => ({ grade_level: a.grade_level, section: a.section, subject: a.subject }))

    setSaving(true)
    try {
      const payload = { ...form, assignments: validAssignments }
      await onSubmit(mode === 'edit' ? trimForEdit(payload, initial, emailEditable) : payload)
    } catch { /* the interceptor toasts the API's reason; the form stays open */ } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <p className={SECTION}>Teacher details</p>
        <PersonFields form={form} setField={setField} mode={mode} emailEditable={emailEditable} />
      </div>

      {/* Assignments */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <p className={SECTION}>
            Teaching assignments{mode === 'create' && <span className="normal-case tracking-normal font-normal"> (optional)</span>}
          </p>
          <button type="button" onClick={addRow}
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition-colors">
            <Plus size={13} /> Add row
          </button>
        </div>

        {mode === 'edit' && (() => {
          const copyableYears = Object.keys(pastYears)
            .filter(sy => pastYears[sy].length > 0 && sy !== activeSY)
            .sort((a, b) => b.localeCompare(a))
          if (!copyableYears.length) return null
          return (
            <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
              <History size={14} className="text-slate-400 shrink-0" />
              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                <span className="text-xs text-slate-500 whitespace-nowrap">Copy assignments from a previous school year</span>
                <select
                  className="input text-xs py-1 w-auto pr-7"
                  value={copiedFrom}
                  onChange={e => {
                    const sy = e.target.value
                    if (!sy || !pastYears[sy]) return
                    setCopiedFrom(sy)
                    const copied = pastYears[sy]
                      .filter(a => isSuperAdmin || effectiveScope.includes(a.grade_level))
                      .map(a => ({
                        grade_level: a.grade_level,
                        section: a.section,
                        subject: a.subject,
                      }))
                    setForm(p => {
                      const preserved = p.assignments.filter(isRowLocked)
                      return { ...p, assignments: [...preserved, ...copied] }
                    })
                    toast.success(`Copied ${copied.length} assignment${copied.length !== 1 ? 's' : ''} from SY ${sy}`)
                  }}
                >
                  <option value="" disabled={!!copiedFrom}>Select year...</option>
                  {copyableYears.map(sy => (
                    <option key={sy} value={sy}>SY {sy} ({pastYears[sy].length})</option>
                  ))}
                </select>
              </div>
            </div>
          )
        })()}

        <div className="space-y-2">
          {/* Header */}
          <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-0.5">
            {['Grade Level', 'Section', 'Subject', ''].map((h, i) => (
              <p key={i} className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</p>
            ))}
          </div>

          {form.assignments.map((row, i) => (
            <AssignmentRow
              key={i}
              row={row}
              index={i}
              onChange={updateRow}
              onRemove={removeRow}
              takenAssignments={takenAssignments}
              gradeOptions={gradeOptions}
              locked={isRowLocked(row)}
            />
          ))}

          {form.assignments.length === 0 && (
            <p className="text-xs text-slate-500 py-2 text-center">
              No assignments. Use "Add row" to assign subjects — or add them later.
            </p>
          )}
        </div>

        {/* Read-only, and deliberately so. `sections.adviser_id` is written on
            the Curriculum page's Sections tab; adding a second control here
            would be a second surface for one rule, which this codebase has been
            bitten by before. The note exists so an admin editing a teacher knows
            the advisory is there and where to go to change it, rather than
            hunting for a control that is missing on purpose. */}
        {initial?.advisory?.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <GraduationCap size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <span className="font-semibold">
                Class adviser of {initial.advisory.map(v => `${v.grade_level} · ${v.section}`).join(', ')}
              </span>{' '}
              this school year. That is separate from the subjects above and is set on the
              Curriculum page's Sections tab.
            </p>
          </div>
        )}
      </div>

      {mode === 'create' && <WhatHappensNext steps={STAFF_NEXT} />}

      <FormFooter onClose={onClose} saving={saving}
        onDiscard={mode === 'edit' ? () => { setForm(start); setCopiedFrom('') } : null} dirty={dirty}
        label={mode === 'create' ? 'Create invitation' : 'Save changes'}
        savingLabel={mode === 'create' ? 'Creating…' : 'Saving…'} />
    </form>
  )
}

// ── Assignment Tags ───────────────────────────────────────────
function AssignmentTags({ assignments = [], advisory = [] }) {
  const [expanded, setExpanded] = useState(false)

  // The advisory is one chip per advised class — "Grade 1 · Makabayan · Adviser"
  // — never a marker repeated on every subject the teacher has in that class,
  // which read as one advisory per subject. It always leads and is never folded
  // behind "+N more": it is the most significant thing in this column.
  const visible = expanded ? assignments : assignments.slice(0, 2)
  const extra   = assignments.length - 2

  // A teacher can hold either fact without the other, so the empty state has to
  // consider both — otherwise someone who advises a class but teaches nothing
  // in the active year reads as "No assignments".
  if (!assignments.length && !advisory.length) {
    return <span className="text-slate-400 text-xs">No assignments</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {advisory.map(v => (
        <span key={v.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-xs font-semibold border border-amber-200"
          title="Class adviser — set on the Curriculum page">
          <GraduationCap size={10} />
          {v.grade_level} · {v.section} · Adviser
        </span>
      ))}
      {visible.map((a, i) => (
        <span key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-xs font-medium border border-brand-100">
          <BookOpen size={10} />
          {a.grade_level} · {a.section} · {a.subject}
        </span>
      ))}
      {!expanded && extra > 0 && (
        <button onClick={() => setExpanded(true)}
          className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium hover:bg-slate-200 transition-colors">
          +{extra} more
        </button>
      )}
    </div>
  )
}

/** One advised class, as a row — the history modal and the account panel. */
function AdvisoryRow({ v }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
      <GraduationCap size={12} className="text-amber-600 flex-shrink-0" />
      <span className="text-sm text-amber-900">
        {v.grade_level} &middot; {v.section} &middot; <span className="font-semibold">Class adviser</span>
      </span>
    </div>
  )
}

/** One subject assignment, as a row — never marked as the advisory. */
function SubjectRow({ a }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-50 border-slate-100">
      <BookOpen size={12} className="text-brand-500 flex-shrink-0" />
      <span className="text-sm text-slate-700">
        {a.grade_level} &middot; {a.section} &middot; <span className="font-medium">{a.subject}</span>
      </span>
    </div>
  )
}

// ── Delete Confirm Modal ──────────────────────────────────────
function DeleteConfirm({ teacher, onConfirm, onClose, initialMode = 'deactivate' }) {
  const [mode, setMode]       = useState(initialMode) // 'deactivate' | 'permanent'
  const [deleting, setDeleting] = useState(false)

  const handle = async () => {
    setDeleting(true)
    try { await onConfirm(mode) } finally { setDeleting(false) }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 rounded-xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold">
          {nameInitial(teacher)}
        </div>
        <div>
          <p className="font-semibold text-slate-800">{formatName(teacher)}</p>
          <p className="text-xs text-slate-500">{teacher.email}</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className={clsx(
          'flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all',
          mode === 'deactivate' ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-slate-300'
        )}>
          <input type="radio" name="deleteMode" value="deactivate"
            checked={mode === 'deactivate'} onChange={() => setMode('deactivate')} className="mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <ShieldOff size={14} className="text-amber-500" /> Deactivate Account
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Account is hidden and login disabled. Can be reactivated later. Data is preserved.
            </p>
          </div>
        </label>

        <label className={clsx(
          'flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all',
          mode === 'permanent' ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
        )}>
          <input type="radio" name="deleteMode" value="permanent"
            checked={mode === 'permanent'} onChange={() => setMode('permanent')} className="mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <Trash2 size={14} className="text-red-500" /> Permanently Delete
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Completely removes the account and all assignments. This cannot be undone.
            </p>
          </div>
        </label>
      </div>

      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button
          onClick={handle}
          disabled={deleting}
          className={clsx('flex-1 justify-center', mode === 'permanent' ? 'btn-danger' : 'inline-flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-xl transition-all active:scale-95')}
        >
          {deleting ? 'Processing...' : mode === 'permanent' ? 'Delete Permanently' : 'Deactivate'}
        </button>
      </div>
    </div>
  )
}

// ── Assignment History Modal Content ─────────────────────────
function AssignmentHistory({ teacher, onClose }) {
  const [history, setHistory]   = useState([])
  const [advisory, setAdvisory] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    accountApi.assignmentHistory(teacher.id)
      .then(res => {
        setHistory(res.data.assignments || [])
        setAdvisory(res.data.advisory || [])
      })
      .catch(() => { setHistory([]); setAdvisory([]) })
      .finally(() => setLoading(false))
  }, [teacher.id])

  // Group both by school year. The year list is the **union** of the two, not
  // the assignment years alone: a teacher can advise a class in a year they
  // taught no subject in, and that year would otherwise vanish from their
  // history entirely.
  const grouped = {}
  for (const a of history) {
    if (!grouped[a.school_year]) grouped[a.school_year] = []
    grouped[a.school_year].push(a)
  }
  const advisoryBy = {}
  for (const v of advisory) {
    if (!advisoryBy[v.school_year]) advisoryBy[v.school_year] = []
    advisoryBy[v.school_year].push(v)
  }
  const years = [...new Set([...Object.keys(grouped), ...Object.keys(advisoryBy)])]
    .sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 rounded-xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold">
          {nameInitial(teacher)}
        </div>
        <div>
          <p className="font-semibold text-slate-800">{formatName(teacher)}</p>
          <p className="text-xs text-slate-500">{teacher.email}</p>
        </div>
      </div>

      {loading ? <LoadingSpinner /> : years.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">No assignment history found.</p>
      ) : (
        <div className="space-y-4 max-h-[400px] overflow-y-auto">
          {years.map(sy => (
            <div key={sy}>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                SY {sy}
              </h3>
              <div className="space-y-1.5">
                {/* Same rule as the tag row: one row for the advised class,
                    then the subjects, none of them marked. */}
                {(advisoryBy[sy] || []).map(v => <AdvisoryRow key={v.id} v={v} />)}
                {(grouped[sy] || []).map(a => <SubjectRow key={a.id} a={a} />)}
                {!grouped[sy] && (
                  <p className="text-xs text-slate-400 px-3">No subjects taught this school year.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={onClose} className="btn-secondary w-full">Close</button>
    </div>
  )
}

// ── Admin Form ────────────────────────────────────────────────
// Super Admin can be invited here, behind the two guards the API enforces: a
// warning that says what the role reaches, and the inviting super admin's own
// password. It is a creation-time choice only — an existing admin's role moves
// between the two scoped tiers and never to or from Super Admin.
const ADMIN_ROLE_OPTIONS = [
  { id: ROLES.ADMIN_ECE,   label: ROLE_LABELS[ROLES.ADMIN_ECE],   desc: 'Kinder learners, teachers and curriculum' },
  { id: ROLES.ADMIN_ELEM,  label: ROLE_LABELS[ROLES.ADMIN_ELEM],  desc: 'Grades 1–6 learners, teachers and curriculum' },
  { id: ROLES.SUPER_ADMIN, label: ROLE_LABELS[ROLES.SUPER_ADMIN], desc: 'The whole school, including school years and admin accounts' },
]

function AdminForm({ initial, onSubmit, onClose, mode, superAdminCount }) {
  const emailEditable = mode === 'create' || canChangeStaffEmail(initial)
  const isExistingSuper = mode === 'edit' && initial?.role === ROLES.SUPER_ADMIN
  const [start] = useState(() => ({
    surname:     initial?.surname     || '',
    first_name:  initial?.first_name  || '',
    middle_name: initial?.middle_name || '',
    email:       initial?.email       || '',
    phone:       initial?.phone       || '',
    role:        initial?.role        || '',
    confirm_password: '',
  }))
  const [form, setForm] = useState(start)
  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const setField = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError('') }
  const grantingSuper = mode === 'create' && form.role === ROLES.SUPER_ADMIN

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.role) { setError('Choose a role.'); return }
    setSaving(true)
    try {
      const payload = { ...form }
      if (!grantingSuper) delete payload.confirm_password
      if (mode === 'edit') {
        trimForEdit(payload, initial, emailEditable)
        if (isExistingSuper) delete payload.role
      }
      await onSubmit(payload)
    } catch (err) {
      // createAdmin is a silent call, so its refusal (a wrong confirming
      // password, an email already in use) is shown here instead of a toast.
      // Edits are not silent — the interceptor has already toasted them.
      if (mode === 'create') setError(err?.response?.data?.error || 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const roleChoices = mode === 'create'
    ? ADMIN_ROLE_OPTIONS
    : ADMIN_ROLE_OPTIONS.filter(o => isExistingSuper ? o.id === ROLES.SUPER_ADMIN : o.id !== ROLES.SUPER_ADMIN)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <p className={SECTION}>Admin details</p>
        <PersonFields form={form} setField={setField} mode={mode} emailEditable={emailEditable} />
      </div>

      <fieldset className="space-y-2">
        <legend className={clsx(SECTION, 'mb-3')}>Role</legend>
        {roleChoices.map(o => {
          const on = form.role === o.id
          return (
            <label key={o.id}
              className={clsx('flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-colors',
                isExistingSuper ? 'cursor-default' : 'cursor-pointer',
                on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50')}>
              <input type="radio" name="admin-role" value={o.id} checked={on} disabled={isExistingSuper}
                onChange={() => setField('role', o.id)} className="w-4 h-4 accent-brand-500 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{o.label}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{o.desc}</span>
              </span>
              {o.id === ROLES.SUPER_ADMIN && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">Full access</span>
              )}
            </label>
          )
        })}
        {isExistingSuper && (
          <p className="text-xs text-slate-500">A Super Admin's role can't be changed.</p>
        )}
      </fieldset>

      {grantingSuper && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3.5">
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">This gives full control of VISTA</p>
              <p className="text-[13px] text-amber-800 leading-relaxed mt-0.5">
                A Super Admin can change school years, enrolment status, every admin account and the
                public website. Keep it to the principal and one backup. VISTA has{' '}
                <b>{superAdminCount}</b> Super Admin{superAdminCount === 1 ? '' : 's'} now.
              </p>
            </div>
          </div>
          <div className="sm:pl-[30px]">
            <label htmlFor="confirm-pw" className="block text-sm font-medium text-amber-900 mb-1.5">
              Enter your password to confirm
            </label>
            <input id="confirm-pw" type="password" autoComplete="current-password" required
              className="input !border-amber-300" value={form.confirm_password}
              onChange={e => setField('confirm_password', e.target.value)} />
          </div>
        </div>
      )}

      {mode === 'create' && !grantingSuper && <WhatHappensNext steps={STAFF_NEXT} />}

      {error && <p className="text-sm text-red-600 -mt-2" role="alert">{error}</p>}

      <FormFooter onClose={onClose} saving={saving}
        onDiscard={mode === 'edit' ? () => { setForm(start); setError('') } : null} dirty={dirty}
        label={mode === 'edit' ? 'Save changes' : grantingSuper ? 'Create Super Admin invitation' : 'Create invitation'}
        savingLabel={mode === 'edit' ? 'Saving…' : 'Creating…'} />
    </form>
  )
}

// ── Account details (the panel's view) ───────────────────────
// What the Parents tab's account panel shows for a parent, for a staff member:
// contact, then what the account covers (classes or role), then access. Read
// only — Edit details swaps the panel to the form, and the access actions stay
// on the ⋯ menu, as they do for parents.
const PANEL_SECTION = 'text-xs font-semibold uppercase tracking-wider text-slate-500'

function StaffDetails({ staff, kind, isMe, onEdit, onHistory }) {
  const assignments = staff.assignments || []
  const advisory = staff.advisory || []
  const role = ADMIN_ROLE_OPTIONS.find(o => o.id === staff.role)

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h4 className={PANEL_SECTION}>Contact</h4>
          <button onClick={onEdit} className="text-xs font-semibold text-brand-600">Edit details</button>
        </div>
        <div className="flex items-center gap-2.5 text-sm text-slate-700">
          <Phone size={15} className="text-slate-400" />{staff.phone || '—'}
        </div>
        <div className="flex items-center gap-2.5 text-sm text-slate-700">
          <Mail size={15} className="text-slate-400" />{staff.email}
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[11px] text-slate-500">Sign-in email</span>
        </div>
        {staff.created_at && (
          <div className="flex items-center gap-2.5 text-sm text-slate-700">
            <CalendarDays size={15} className="text-slate-400" />Account created {fmtDate(staff.created_at, true)}
          </div>
        )}
      </section>

      {kind === 'teacher' ? (
        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h4 className={PANEL_SECTION}>Assignments · {assignments.length}</h4>
            <span className="text-xs text-slate-500">This school year</span>
          </div>
          {/* The tag row's rule: one row for the advised class, then the subjects. */}
          {advisory.map(v => <AdvisoryRow key={v.id} v={v} />)}
          {assignments.map((a, i) => <SubjectRow key={a.id || i} a={a} />)}
          {!assignments.length && !advisory.length && (
            <p className="text-sm text-slate-500">No assignments this school year.</p>
          )}
          {advisory.length > 0 && (
            <p className="text-xs text-slate-500">Class advisers are set on the Curriculum page's Sections tab.</p>
          )}
          {onHistory && (
            <button onClick={onHistory}
              className="w-full h-10 flex items-center justify-center gap-2 text-sm font-semibold text-brand-600
                         border border-dashed border-slate-300 rounded-xl hover:bg-slate-50">
              <History size={16} /> Assignment history
            </button>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          <h4 className={PANEL_SECTION}>Role</h4>
          <div className="px-3.5 py-3 border border-slate-200 rounded-xl">
            <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold',
              staff.role === ROLES.SUPER_ADMIN ? 'bg-slate-800 text-white' : 'bg-purple-50 text-purple-700')}>
              {ROLE_LABELS[staff.role] || staff.role}
            </span>
            {role && <p className="text-sm text-slate-600 mt-2">{role.desc}</p>}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h4 className={PANEL_SECTION}>Account access</h4>
        <div className="px-3.5 py-3 border border-slate-200 rounded-xl">
          <p className="text-xs leading-relaxed text-slate-500">
            {canChangeStaffEmail(staff)
              ? 'They haven’t activated yet, so the sign-in email can still be corrected.'
              : 'Activated with this address, so it can’t be changed here.'}
            {' '}Reissue, cancel, deactivate and reactivate are on the ⋯ menu in the list.
            {isMe && ' This is your own account, so it can’t be deactivated from here.'}
          </p>
        </div>
      </section>
    </div>
  )
}

// ── Row menu items ────────────────────────────────────────────
// Only the actions the account's state allows. Anything that ends access
// (cancel, deactivate, delete) goes below the divider in red and confirms first.
function staffMenu(staff, actions) {
  const state = staffAccessOf(staff).id
  const items = []
  if (canReissue(state)) items.push({ key: 'reissue', icon: RotateCcw, label: 'Reissue invitation', hint: 'Opens it again for 30 days', run: actions.reissue })
  if (state === 'deactivated' && actions.reactivate) {
    items.push({
      key: 'reactivate', icon: ShieldCheck, label: 'Reactivate',
      hint: staff.has_password ? 'They can sign in again with their password' : 'Reopens their invitation for 30 days',
      run: actions.reactivate,
    })
  }
  items.push({ key: 'view', icon: UserRound, label: 'View account', hint: actions.viewHint, run: actions.view })
  if (actions.edit) items.push({ key: 'edit', icon: Pencil, label: 'Edit details', run: actions.edit })
  if (actions.history) items.push({ key: 'history', icon: History, label: 'Assignment history', run: actions.history })

  const danger = []
  if (canCancel(state)) danger.push({ key: 'cancel', icon: X, label: 'Cancel invitation', run: actions.cancel })
  if (state === 'active' && actions.deactivate) danger.push({ key: 'deactivate', icon: ShieldOff, label: 'Deactivate', run: actions.deactivate })
  if (state === 'deactivated' && actions.remove) danger.push({ key: 'remove', icon: Trash2, label: 'Delete permanently', run: actions.remove })
  return { items, danger }
}

// ── Cancel invitation confirm ─────────────────────────────────
function CancelInvitation({ staff, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 leading-relaxed">
        <b className="text-slate-900">{formatName(staff)}</b> will no longer be able to activate their account,
        and any code already sent stops working. The account is deactivated rather than deleted — reactivate it
        later to invite them again.
      </p>
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button onClick={onClose} className="btn-secondary">Keep invitation</button>
        <button disabled={busy}
          onClick={async () => { setBusy(true); try { await onConfirm() } catch { /* interceptor toasts */ } finally { setBusy(false) } }}
          className="btn-primary !bg-red-600 hover:!bg-red-700">Cancel invitation</button>
      </div>
    </div>
  )
}

/** The steps a staff member follows — on the dashboard's own sign-in page. */
const staffSteps = (email) => [
  `Open ${window.location.origin}/login`,
  'Choose "Activate your account"',
  `Enter ${email} and follow the code sent there`,
]

const notActivated = (rows) =>
  rows.filter(r => ['pending', 'in_progress', 'expired'].includes(staffAccessOf(r).id)).length

/** "19 teachers · 4 haven't activated yet" — the same sentence on every tab. */
const countLine = (n, noun, waiting) =>
  `${n} ${noun}${n !== 1 ? 's' : ''}${waiting ? ` · ${waiting} haven't activated yet` : ''}`

const staffCounts = (rows) => rows.reduce((acc, r) => {
  const id = staffAccessOf(r).id
  acc[id] = (acc[id] || 0) + 1
  return acc
}, {})

export default function AccountManagement() {
  const { user, isSuperAdmin } = useAuth()
  const meId = user?.id
  const [tab, setTab] = useState('teachers')
  const menus = useRowMenus()

  // ── Teachers ───────────────────────────────────────────────
  const [teachers, setTeachers]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [teacherState, setTeacherState] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteMode, setDeleteMode] = useState('deactivate')   // which option the dialog opens on
  const [historyTarget, setHistoryTarget] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)   // { kind, staff }
  const [created, setCreated] = useState(null)             // { kind, account }
  // The account open in the right-hand panel, as the Parents tab does it:
  // { kind: 'teacher' | 'admin', id, mode: 'view' | 'edit', back }. `back` is
  // set when an edit was started from the view, so Cancel and Save return there
  // instead of closing the panel.
  const [panel, setPanel] = useState(null)
  const openView = (kind, p) => setPanel({ kind, id: p.id, mode: 'view', back: false })
  const openEdit = (kind, p) => setPanel({ kind, id: p.id, mode: 'edit', back: false })
  const leaveEdit = () => setPanel(p => (p?.back ? { ...p, mode: 'view', back: false } : null))

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (search) params.search = search
      const res = await accountApi.listTeachers(params)
      setTeachers(res.data.teachers)
    } catch {}
    setLoading(false)
  }, [search])

  useEffect(() => {
    const t = setTimeout(fetch_, 300)
    return () => clearTimeout(t)
  }, [fetch_])

  // Every write answers with a sentence saying what happened; show that.
  const announce = (res, fallback) => toast.success(res?.data?.message || fallback, { duration: 6000 })

  const handleCreate = async (data) => {
    const res = await accountApi.createTeacher(data)
    setShowCreate(false)
    setCreated({ kind: 'teacher', account: res.data.teacher })
    fetch_()
  }

  const handleEdit = async (data) => {
    const res = await accountApi.updateTeacher(panel.id, data)
    announce(res, 'Account updated.')
    leaveEdit()
    fetch_()
  }

  const handleReactivate = async (teacher) => {
    try {
      const res = await accountApi.updateTeacher(teacher.id, { is_active: true })
      announce(res, `${formatName(teacher)}'s account reactivated.`)
      fetch_()
    } catch {}
  }

  const handleDelete = async (mode) => {
    if (mode === 'permanent') {
      await accountApi.deletePermanent(deleteTarget.id)
      toast.success(`${formatName(deleteTarget)} permanently deleted.`)
    } else {
      await accountApi.deactivate(deleteTarget.id)
      toast.success(`${formatName(deleteTarget)}'s account deactivated.`)
    }
    setDeleteTarget(null)
    fetch_()
  }

  // ── Admins (super_admin only) ─────────────────────────────
  const [admins, setAdmins] = useState([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [adminSearch, setAdminSearch] = useState('')
  const [adminState, setAdminState] = useState('')
  const [showAdminCreate, setShowAdminCreate] = useState(false)
  const [adminDeleteTarget, setAdminDeleteTarget] = useState(null)
  // Counted over every admin, not the search result: the warning in the invite
  // form states how many Super Admins VISTA has, whatever the list is showing.
  const [superAdminCount, setSuperAdminCount] = useState(0)

  const fetchAdmins = useCallback(async () => {
    if (!isSuperAdmin) return
    setAdminsLoading(true)
    try {
      const params = {}
      if (adminSearch) params.search = adminSearch
      const res = await accountApi.listAdmins(params)
      setAdmins(res.data.admins || [])
    } catch {}
    setAdminsLoading(false)
  }, [isSuperAdmin, adminSearch])

  const fetchSuperAdminCount = useCallback(async () => {
    if (!isSuperAdmin) return
    try {
      const res = await accountApi.listAdmins({})
      setSuperAdminCount((res.data.admins || [])
        .filter(a => a.role === ROLES.SUPER_ADMIN && staffAccessOf(a).id === 'active').length)
    } catch {}
  }, [isSuperAdmin])

  useEffect(() => {
    if (tab !== 'admins') return
    const t = setTimeout(fetchAdmins, 300)
    return () => clearTimeout(t)
  }, [tab, fetchAdmins])

  useEffect(() => { if (showAdminCreate) fetchSuperAdminCount() }, [showAdminCreate, fetchSuperAdminCount])

  const handleCreateAdmin = async (data) => {
    const res = await accountApi.createAdmin(data)
    setShowAdminCreate(false)
    setCreated({ kind: 'admin', account: res.data.admin })
    fetchAdmins()
  }
  const handleEditAdmin = async (data) => {
    const res = await accountApi.updateAdmin(panel.id, data)
    announce(res, 'Admin account updated.')
    leaveEdit()
    fetchAdmins()
  }
  const handleDeleteAdmin = async () => {
    try {
      await accountApi.deleteAdmin(adminDeleteTarget.id)
      toast.success(`${formatName(adminDeleteTarget)} deactivated.`)
      setAdminDeleteTarget(null)
      fetchAdmins()
    } catch {}
  }
  const handleReactivateAdmin = async (admin) => {
    try {
      const res = await accountApi.updateAdmin(admin.id, { is_active: true })
      announce(res, `${formatName(admin)}'s admin account reactivated.`)
      fetchAdmins()
    } catch {}
  }

  // ── Invitations (both staff kinds) ─────────────────────────
  const refetch = (kind) => (kind === 'admin' ? fetchAdmins() : fetch_())
  const handleReissue = async (kind, staff) => {
    try {
      const res = kind === 'admin'
        ? await accountApi.reissueAdminInvitation(staff.id)
        : await accountApi.reissueTeacherInvitation(staff.id)
      announce(res, 'Invitation reissued.')
      refetch(kind)
    } catch {}
  }
  const handleCancelInvitation = async () => {
    const { kind, staff } = cancelTarget
    const res = kind === 'admin'
      ? await accountApi.cancelAdminInvitation(staff.id)
      : await accountApi.cancelTeacherInvitation(staff.id)
    announce(res, 'Invitation cancelled.')
    setCancelTarget(null)
    refetch(kind)
  }

  // ── Parents (their own component; it reports its counts up) ──
  const [showParentCreate, setShowParentCreate] = useState(false)
  const [parentCounts, setParentCounts] = useState(null)   // null until the tab has loaded once

  const shownTeachers = teacherState ? teachers.filter(t => staffAccessOf(t).id === teacherState) : teachers
  const shownAdmins   = adminState ? admins.filter(a => staffAccessOf(a).id === adminState) : admins

  // One header, one primary action, the same sentence under the title.
  const HEADER = {
    teachers: { line: countLine(teachers.length, 'teacher', notActivated(teachers)), action: 'Invite Teacher', open: () => setShowCreate(true) },
    admins:   { line: countLine(admins.length, 'admin', notActivated(admins)),       action: 'Invite Admin',   open: () => setShowAdminCreate(true) },
    parents:  { line: parentCounts ? countLine(parentCounts.total, 'parent', parentCounts.waiting) : ' ', action: 'Invite Parent', open: () => setShowParentCreate(true) },
  }[tab]

  // Every admin sees Teachers and Parents — both are scoped by grade on the
  // server. Admins is the super admin's alone.
  const TABS = [['teachers', 'Teachers'], ...(isSuperAdmin ? [['admins', 'Admins']] : []), ['parents', 'Parents']]

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Account Management</h1>
          <p className="page-subtitle">{HEADER.line}</p>
        </div>
        <button onClick={HEADER.open} className="btn-primary">
          <MailPlus size={16} /> {HEADER.action}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx(
              'px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === id
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'parents' && (
        <ParentAccounts
          createOpen={showParentCreate}
          onOpenCreate={() => setShowParentCreate(true)}
          onCloseCreate={() => setShowParentCreate(false)}
          onCountsChange={setParentCounts}
        />
      )}

      {tab === 'teachers' && <>
        <RosterFilters search={search} onSearch={setSearch}
          placeholder="Search by name or email" label="Search teachers"
          chips={stateChips(STAFF_ACCESS_STATES, staffCounts(teachers), teachers.length)}
          value={teacherState} onChange={setTeacherState} />

        <div className="card overflow-visible">
          {loading ? <LoadingSpinner /> : shownTeachers.length === 0 ? (
            teachers.length ? (
              <NoMatch onClear={() => setTeacherState('')} />
            ) : (
              <EmptyState icon={UserCog} title="No teacher accounts yet"
                description="Invite a teacher with their email. They choose their own password when they activate."
                action={<button onClick={() => setShowCreate(true)} className="btn-primary">Invite Teacher</button>} />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Assignments</th>
                    <th>Account access</th>
                    <th className="!text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownTeachers.map(t => {
                    const key = `teacher:${t.id}`
                    return (
                      // The row opens the account panel, as on the Parents tab.
                      // `!` because `.table-base tbody tr:hover` outranks a
                      // bare `hover:bg-…` (see "Tables" in the dashboard CLAUDE.md).
                      <tr key={t.id} className="hover:!bg-brand-50/60 cursor-pointer transition-colors"
                        onClick={() => openView('teacher', t)}>
                        <td><PersonCell person={t} muted={staffAccessOf(t).id === 'deactivated'} /></td>
                        <td className="max-w-xs"><AssignmentTags assignments={t.assignments} advisory={t.advisory} /></td>
                        <td><AccessCell state={staffAccessOf(t)} detail={staffAccessDetail(t, { meId })} /></td>
                        <td>
                          <RowActions editLabel={`Edit ${formatName(t)}`} onEdit={() => openEdit('teacher', t)}
                            menu={<RowMenu label={`More actions for ${formatName(t)}`}
                              open={menus.isOpen(key)} onToggle={menus.toggle(key)}
                              {...staffMenu(t, {
                                reissue:    () => handleReissue('teacher', t),
                                reactivate: () => handleReactivate(t),
                                view:       () => openView('teacher', t),
                                viewHint:   'Contact details and assignments',
                                edit:       () => openEdit('teacher', t),
                                history:    () => setHistoryTarget(t),
                                cancel:     () => setCancelTarget({ kind: 'teacher', staff: t }),
                                deactivate: () => { setDeleteMode('deactivate'); setDeleteTarget(t) },
                                remove:     () => { setDeleteMode('permanent'); setDeleteTarget(t) },
                              })} />} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>}

      {tab === 'admins' && isSuperAdmin && <>
        <RosterFilters search={adminSearch} onSearch={setAdminSearch}
          placeholder="Search by name or email" label="Search admins"
          chips={stateChips(STAFF_ACCESS_STATES, staffCounts(admins), admins.length)}
          value={adminState} onChange={setAdminState} />

        <div className="card overflow-visible">
          {adminsLoading ? <LoadingSpinner /> : shownAdmins.length === 0 ? (
            admins.length ? (
              <NoMatch onClear={() => setAdminState('')} />
            ) : (
              <EmptyState icon={UserCog} title="No admin accounts yet"
                description="Invite an ECE or Elementary admin to delegate grade-scoped management."
                action={<button onClick={() => setShowAdminCreate(true)} className="btn-primary">Invite Admin</button>} />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Admin</th>
                    <th>Role</th>
                    <th>Account access</th>
                    <th className="!text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownAdmins.map(a => {
                    const key = `admin:${a.id}`
                    const isMe = a.id === meId
                    return (
                      <tr key={a.id} className="hover:!bg-brand-50/60 cursor-pointer transition-colors"
                        onClick={() => openView('admin', a)}>
                        <td>
                          <PersonCell person={a} tone="purple" muted={staffAccessOf(a).id === 'deactivated'}
                            suffix={isMe && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>} />
                        </td>
                        <td>
                          <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold',
                            a.role === ROLES.SUPER_ADMIN ? 'bg-slate-800 text-white' : 'bg-purple-50 text-purple-700')}>
                            {ROLE_LABELS[a.role] || a.role}
                          </span>
                        </td>
                        <td><AccessCell state={staffAccessOf(a)} detail={staffAccessDetail(a, { meId })} /></td>
                        <td>
                          <RowActions editLabel={`Edit ${formatName(a)}`} onEdit={isMe ? null : () => openEdit('admin', a)}
                            menu={<RowMenu label={`More actions for ${formatName(a)}`}
                              open={menus.isOpen(key)} onToggle={menus.toggle(key)}
                              {...staffMenu(a, {
                                reissue:    () => handleReissue('admin', a),
                                reactivate: () => handleReactivateAdmin(a),
                                view:       () => openView('admin', a),
                                viewHint:   'Contact details and role',
                                // Not on your own row — your own details are Profile's.
                                edit:       isMe ? null : () => openEdit('admin', a),
                                cancel:     () => setCancelTarget({ kind: 'admin', staff: a }),
                                // Never yourself — the API refuses it too.
                                deactivate: isMe ? null : () => setAdminDeleteTarget(a),
                              })} />} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>}

      {/* ── Admin Create / Edit / Delete Modals ─────────────── */}
      <Modal open={showAdminCreate} onClose={() => setShowAdminCreate(false)}
        title={titled('Invite Admin', "They'll choose their own password when they activate the account.")} size="lg">
        <AdminForm mode="create" onSubmit={handleCreateAdmin} onClose={() => setShowAdminCreate(false)}
          superAdminCount={superAdminCount} />
      </Modal>
      <Modal open={!!adminDeleteTarget} onClose={() => setAdminDeleteTarget(null)}
        title="Deactivate Admin Account">
        {adminDeleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Deactivate <b>{formatName(adminDeleteTarget)}</b>'s account? They won't be able to sign in. Historical records are preserved.
            </p>
            {adminDeleteTarget.role === ROLES.SUPER_ADMIN && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                This is a Super Admin account. VISTA always keeps at least one active Super Admin.
              </p>
            )}
            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setAdminDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={handleDeleteAdmin} className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700">
                Deactivate
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Teacher Create / Edit ──────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}
        title={titled('Invite Teacher', "They'll choose their own password when they activate the account.")} size="lg">
        <TeacherForm mode="create" onSubmit={handleCreate} onClose={() => setShowCreate(false)} />
      </Modal>

      {/* ── The account panel (view or edit), on the right ───── */}
      {panel && (() => {
        const isAdmin = panel.kind === 'admin'
        const person = (isAdmin ? admins : teachers).find(x => x.id === panel.id)
        const editing = panel.mode === 'edit'
        return (
          <AccountPanel open={!!person} onClose={() => setPanel(null)}
            eyebrow={editing ? (isAdmin ? 'Edit Admin' : 'Edit Teacher') : (isAdmin ? ROLE_LABELS[person?.role] : 'Teacher')}
            person={person} tone={isAdmin ? 'purple' : 'brand'}
            suffix={person?.id === meId && <span className="ml-1.5 text-sm font-normal text-slate-500">(you)</span>}
            state={person && staffAccessOf(person)}
            detail={person && staffAccessDetail(person, { meId })}
            // Not while a form is open, nor under the history dialog it can open.
            closeOnEscape={!editing && !historyTarget}>
            {person && (editing
              ? (isAdmin
                  ? <AdminForm key={person.id} mode="edit" initial={person} onSubmit={handleEditAdmin} onClose={leaveEdit} />
                  : <TeacherForm key={person.id} mode="edit" initial={person} onSubmit={handleEdit} onClose={leaveEdit} />)
              : <StaffDetails staff={person} kind={panel.kind} isMe={person.id === meId}
                  onEdit={() => setPanel(p => ({ ...p, mode: 'edit', back: true }))}
                  onHistory={isAdmin ? null : () => setHistoryTarget(person)} />)}
          </AccountPanel>
        )
      })()}

      {/* ── Invitation created (staff; Parents shows its own) ── */}
      <Modal open={!!created} onClose={() => setCreated(null)}
        title={created?.kind === 'admin' ? 'Invite Admin' : 'Invite Teacher'}>
        {created && (
          <InvitationCreated
            name={formatName(created.account)}
            email={created.account.email}
            roleLabel={ROLE_LABELS[created.account.role] || 'Staff'}
            state={staffAccessOf(created.account)}
            openUntil={invitationOpenUntil(created.account.invitation)}
            steps={staffSteps(created.account.email)}
            onDone={() => setCreated(null)}
            onAnother={() => {
              const kind = created.kind
              setCreated(null)
              if (kind === 'admin') setShowAdminCreate(true); else setShowCreate(true)
            }} />
        )}
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel invitation?" size="sm">
        {cancelTarget && (
          <CancelInvitation staff={cancelTarget.staff} onConfirm={handleCancelInvitation} onClose={() => setCancelTarget(null)} />
        )}
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title={deleteMode === 'permanent' ? 'Delete Teacher Account' : 'Remove Teacher Account'}>
        {deleteTarget && (
          <DeleteConfirm teacher={deleteTarget} initialMode={deleteMode}
            onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} />
        )}
      </Modal>

      <Modal open={!!historyTarget} onClose={() => setHistoryTarget(null)} title="Assignment History">
        {historyTarget && (
          <AssignmentHistory teacher={historyTarget} onClose={() => setHistoryTarget(null)} />
        )}
      </Modal>
    </div>
  )
}

function NoMatch({ onClear }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-slate-500">No accounts match this filter.</p>
      <button onClick={onClear} className="mt-2 text-sm font-semibold text-brand-600">Show all</button>
    </div>
  )
}

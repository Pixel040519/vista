import { useState, useEffect, useCallback } from 'react'
import {
  UserCog, Plus, Search, Pencil, Trash2, ShieldOff,
  ShieldCheck, Eye, EyeOff, X, BookOpen, ChevronDown, History, Shield, GraduationCap
} from 'lucide-react'
import { accountApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal, PhoneInput } from '../components/UI'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { formatName, nameInitial, titleCase } from '../utils/nameHelper'
import { useAuth } from '../context/AuthContext'
import { ROLES, ROLE_LABELS } from '../utils/roles'
import ParentAccounts from '../components/ParentAccounts'

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

// ── Teacher Form (shared by create + edit) ────────────────────
function TeacherForm({ initial, onSubmit, onClose, mode }) {
  const { user, gradeScope, isSuperAdmin } = useAuth()
  const activeSY = user?.active_school_year || ''
  const effectiveScope = (isSuperAdmin || !gradeScope?.length) ? GRADE_LEVELS : gradeScope
  const gradeOptions = GRADE_LEVELS.filter(g => effectiveScope.includes(g))
  const isRowLocked = (row) => !isSuperAdmin && !!row.grade_level && !effectiveScope.includes(row.grade_level)
  const teacherId = initial?.id || null
  const [form, setForm] = useState({
    surname:     initial?.surname     || '',
    first_name:  initial?.first_name   || '',
    middle_name: initial?.middle_name  || '',
    email:       initial?.email      || '',
    phone:       initial?.phone      || '',
    password:    '',
    assignments: initial?.assignments?.length
      ? initial.assignments.map(a => ({
          grade_level: a.grade_level,
          section:     a.section,
          subject:     a.subject,
        }))
      : [emptyRow()],
  })
  const [showPw, setShowPw]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [takenAssignments, setTakenAssignments] = useState([])
  const [pastYears, setPastYears] = useState({}) // { "2024-2025": [{grade_level,section,subject},...] }

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
      // Strip email on edit — backend updateSchema does not accept it
      const payload = { ...form, assignments: validAssignments }
      if (mode === 'edit') delete payload.email
      // strip generated field — backend computes it
      delete payload.full_name
      // Strip empty password on edit so it doesn't trigger min-length validation
      if (mode === 'edit' && !payload.password) delete payload.password
      await onSubmit(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Basic Info */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Account Information
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Surname *</label>
            <input className="input" placeholder="Dela Cruz" value={form.surname}
              onChange={e => setField('surname', e.target.value)} onBlur={e => setField('surname', titleCase(e.target.value))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">First Name *</label>
            <input className="input" placeholder="Juan" value={form.first_name}
              onChange={e => setField('first_name', e.target.value)} onBlur={e => setField('first_name', titleCase(e.target.value))} required />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Middle Name <span className="text-slate-400 font-normal">(optional)</span></label>
            <input className="input" placeholder="Santos" value={form.middle_name}
              onChange={e => setField('middle_name', e.target.value)} onBlur={e => setField('middle_name', titleCase(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address *</label>
            <input className="input" type="email" placeholder="teacher@school.edu.ph"
              value={form.email} onChange={e => setField('email', e.target.value)}
              required disabled={mode === 'edit'} />
            {mode === 'edit' && (
              <p className="text-xs text-slate-400 mt-1">Email cannot be changed.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone *</label>
            <PhoneInput className="input pr-10" value={form.phone}
              onChange={v => setField('phone', v)} required />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {mode === 'edit' ? 'New Password (leave blank to keep current)' : 'Password *'}
            </label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'edit' ? '••••••••' : 'Min. 8 characters'}
                value={form.password}
                onChange={e => setField('password', e.target.value)}
                required={mode === 'create'}
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Assignments */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Teaching Assignments
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Grade level, section and subject this teacher handles
            </p>
          </div>
          <button type="button" onClick={addRow}
            className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition-colors">
            <Plus size={13} /> Add Row
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
                  value=""
                  onChange={e => {
                    const sy = e.target.value
                    if (!sy || !pastYears[sy]) return
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
                  <option value="">Select year...</option>
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
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-0.5">
            {['Grade Level', 'Section', 'Subject', ''].map((h, i) => (
              <p key={i} className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</p>
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
            <p className="text-xs text-slate-400 py-2 text-center">
              No assignments added. Click "Add Row" to assign subjects.
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

      {/* Actions */}
      <div className="flex gap-3 pt-1 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
          {saving
            ? (mode === 'create' ? 'Creating...' : 'Saving...')
            : (mode === 'create' ? 'Create Teacher' : 'Save Changes')
          }
        </button>
      </div>
    </form>
  )
}

// ── Assignment Tags ───────────────────────────────────────────
// Which (grade_level, section) pairs this teacher advises. Shared by the tag
// row and the history modal so the two mark the same thing the same way.
const advisoryKeys = (advisory = []) =>
  new Set(advisory.map(v => `${v.grade_level}|||${v.section}`))

// Advisories with no assignment row to attach to — the teacher advises the class
// but teaches no subject in it. They need a chip of their own, because there is
// nothing to append the marker to and dropping them would lose the fact.
const unattachedAdvisory = (advisory = [], rows = []) =>
  advisory.filter(v => !rows.some(a => a.grade_level === v.grade_level && a.section === v.section))

function AssignmentTags({ assignments = [], advisory = [] }) {
  const [expanded, setExpanded] = useState(false)

  // The advisory is a property **of a class**, so it rides on the assignment
  // chips for that class rather than sitting beside them as a separate entry —
  // one class, one chip, reading "Grade · Section · Subject · Adviser".
  const keys   = advisoryKeys(advisory)
  const marked = assignments.map(a => ({ ...a, adviser: keys.has(`${a.grade_level}|||${a.section}`) }))
  // Advised classes sort first so the marker cannot end up hidden behind
  // "+N more" — it is the most significant thing in this column.
  const ordered = [...marked.filter(a => a.adviser), ...marked.filter(a => !a.adviser)]
  const orphans = unattachedAdvisory(advisory, assignments)

  const visible = expanded ? ordered : ordered.slice(0, 2)
  const extra   = ordered.length - 2

  // A teacher can hold either fact without the other, so the empty state has to
  // consider both — otherwise someone who advises a class but teaches nothing
  // in the active year reads as "No assignments".
  if (!assignments.length && !advisory.length) {
    return <span className="text-slate-400 text-xs">No assignments</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {orphans.map(v => (
        <span key={v.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-xs font-semibold border border-amber-200"
          title="Class adviser, with no subject taught in this class — set on the Curriculum page">
          <GraduationCap size={10} />
          {v.grade_level} · {v.section} · Adviser
        </span>
      ))}
      {visible.map((a, i) => (
        <span key={i}
          className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border',
            a.adviser
              ? 'bg-amber-50 text-amber-800 font-semibold border-amber-200'
              : 'bg-brand-50 text-brand-700 font-medium border-brand-100')}
          title={a.adviser ? 'Class adviser — set on the Curriculum page' : undefined}>
          {a.adviser ? <GraduationCap size={10} /> : <BookOpen size={10} />}
          {a.grade_level} · {a.section} · {a.subject}{a.adviser && ' · Adviser'}
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

// ── Delete Confirm Modal ──────────────────────────────────────
function DeleteConfirm({ teacher, onConfirm, onClose }) {
  const [mode, setMode]       = useState('deactivate') // 'deactivate' | 'permanent'
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
                {/* Same rule as the tag row: the advisory marks the subject rows
                    for that class rather than sitting above them as its own
                    entry, and only stands alone when there is no such row. */}
                {unattachedAdvisory(advisoryBy[sy], grouped[sy]).map(v => (
                  <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                    <GraduationCap size={12} className="text-amber-600 flex-shrink-0" />
                    <span className="text-sm text-amber-900">
                      {v.grade_level} &middot; {v.section} &middot; <span className="font-semibold">Class adviser</span>
                    </span>
                  </div>
                ))}
                {(grouped[sy] || []).map(a => {
                  const adviser = advisoryKeys(advisoryBy[sy]).has(`${a.grade_level}|||${a.section}`)
                  return (
                    <div key={a.id}
                      className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border',
                        adviser ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100')}>
                      {adviser
                        ? <GraduationCap size={12} className="text-amber-600 flex-shrink-0" />
                        : <BookOpen size={12} className="text-brand-500 flex-shrink-0" />}
                      <span className={clsx('text-sm', adviser ? 'text-amber-900' : 'text-slate-700')}>
                        {a.grade_level} &middot; {a.section} &middot; <span className="font-medium">{a.subject}</span>
                        {adviser && <> &middot; <span className="font-semibold">Adviser</span></>}
                      </span>
                    </div>
                  )
                })}
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

// ── Main Page ─────────────────────────────────────────────────
// ── Admin Form ────────────────────────────────────────────────
function AdminForm({ initial, onSubmit, onClose, mode }) {
  const [form, setForm] = useState({
    surname:     initial?.surname     || '',
    first_name:  initial?.first_name  || '',
    middle_name: initial?.middle_name || '',
    email:       initial?.email       || '',
    phone:       initial?.phone       || '',
    password:    '',
    role:        initial?.role        || ROLES.ADMIN_ECE,
  })
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      if (mode === 'edit') {
        delete payload.email
        if (!payload.password) delete payload.password
      }
      await onSubmit(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Account Information</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Surname *</label>
            <input className="input" value={form.surname}
              onChange={e => setField('surname', e.target.value)}
              onBlur={e => setField('surname', titleCase(e.target.value))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">First Name *</label>
            <input className="input" value={form.first_name}
              onChange={e => setField('first_name', e.target.value)}
              onBlur={e => setField('first_name', titleCase(e.target.value))} required />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Middle Name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input className="input" value={form.middle_name}
              onChange={e => setField('middle_name', e.target.value)}
              onBlur={e => setField('middle_name', titleCase(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email *</label>
            <input className="input" type="email" value={form.email}
              onChange={e => setField('email', e.target.value)}
              required disabled={mode === 'edit'} />
            {mode === 'edit' && <p className="text-xs text-slate-400 mt-1">Email cannot be changed.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone *</label>
            <PhoneInput className="input pr-10" value={form.phone}
              onChange={v => setField('phone', v)} required />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Role *</label>
            <select className="input" value={form.role}
              onChange={e => setField('role', e.target.value)}
              disabled={mode === 'edit' && initial?.role === ROLES.SUPER_ADMIN}
              required>
              <option value={ROLES.ADMIN_ECE}>{ROLE_LABELS[ROLES.ADMIN_ECE]} (Kinder)</option>
              <option value={ROLES.ADMIN_ELEM}>{ROLE_LABELS[ROLES.ADMIN_ELEM]} (Grade 1 – Grade 6)</option>
              {mode === 'edit' && initial?.role === ROLES.SUPER_ADMIN && (
                <option value={ROLES.SUPER_ADMIN}>{ROLE_LABELS[ROLES.SUPER_ADMIN]}</option>
              )}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Super Admin accounts cannot be created from this UI.
            </p>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {mode === 'edit' ? 'New Password (leave blank to keep current)' : 'Password *'}
            </label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'edit' ? '••••••••' : 'Min. 8 characters'}
                value={form.password}
                onChange={e => setField('password', e.target.value)}
                required={mode === 'create'}
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
          {saving ? 'Saving...' : (mode === 'edit' ? 'Save Changes' : 'Create Admin')}
        </button>
      </div>
    </form>
  )
}

// ── Guard Form ───────────────────────────────────────────────
function GuardForm({ initial, onSubmit, onClose, mode }) {
  const [form, setForm] = useState({
    surname:     initial?.surname     || '',
    first_name:  initial?.first_name  || '',
    middle_name: initial?.middle_name || '',
    email:       initial?.email       || '',
    phone:       initial?.phone       || '',
    password:    '',
  })
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      if (mode === 'edit') {
        delete payload.email
        if (!payload.password) delete payload.password
      }
      await onSubmit(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Account Information</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Surname *</label>
            <input className="input" value={form.surname}
              onChange={e => setField('surname', e.target.value)}
              onBlur={e => setField('surname', titleCase(e.target.value))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">First Name *</label>
            <input className="input" value={form.first_name}
              onChange={e => setField('first_name', e.target.value)}
              onBlur={e => setField('first_name', titleCase(e.target.value))} required />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Middle Name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input className="input" value={form.middle_name}
              onChange={e => setField('middle_name', e.target.value)}
              onBlur={e => setField('middle_name', titleCase(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email *</label>
            <input className="input" type="email" value={form.email}
              onChange={e => setField('email', e.target.value)}
              required disabled={mode === 'edit'} />
            {mode === 'edit' && <p className="text-xs text-slate-400 mt-1">Email cannot be changed.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone *</label>
            <PhoneInput className="input pr-10" value={form.phone}
              onChange={v => setField('phone', v)} required />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {mode === 'edit' ? 'New Password (leave blank to keep current)' : 'Password *'}
            </label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'edit' ? '••••••••' : 'Min. 8 characters'}
                value={form.password}
                onChange={e => setField('password', e.target.value)}
                required={mode === 'create'}
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Guard accounts sign in to the VISTA Guard mobile app to scan pickup QRs at the gate. They have no access to grades, attendance, or admin features.
        </p>
      </div>

      <div className="flex gap-3 pt-2 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
          {saving ? 'Saving...' : (mode === 'edit' ? 'Save Changes' : 'Create Guard')}
        </button>
      </div>
    </form>
  )
}

export default function AccountManagement() {
  const { isSuperAdmin } = useAuth()
  const [tab, setTab] = useState('teachers')
  const [showParentCreate, setShowParentCreate] = useState(false)
  const [parentCount, setParentCount] = useState(0)
  const [teachers, setTeachers]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterActive, setFilterActive] = useState('all')

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (search) params.search = search
      if (filterActive !== 'all') params.is_active = filterActive
      const res = await accountApi.listTeachers(params)
      setTeachers(res.data.teachers)
    } catch {}
    setLoading(false)
  }, [search, filterActive])

  useEffect(() => {
    const t = setTimeout(fetch_, 300)
    return () => clearTimeout(t)
  }, [fetch_])

  // ── Create ─────────────────────────────────────────────────
  const handleCreate = async (data) => {
    await accountApi.createTeacher(data)
    toast.success(`${formatName(data)}'s account created!`)
    setShowCreate(false)
    fetch_()
  }

  // ── Edit ───────────────────────────────────────────────────
  const handleEdit = async (data) => {
    await accountApi.updateTeacher(editTarget.id, data)
    toast.success('Account updated successfully.')
    setEditTarget(null)
    fetch_()
  }

  // ── Reactivate ─────────────────────────────────────────────
  const handleReactivate = async (teacher) => {
    await accountApi.updateTeacher(teacher.id, { is_active: true })
    toast.success(`${formatName(teacher)}'s account reactivated.`)
    fetch_()
  }

  // ── Delete / Deactivate ────────────────────────────────────
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

  const active   = teachers.filter(t => t.is_active)
  const inactive = teachers.filter(t => !t.is_active)

  // ── Admins (super_admin only) ─────────────────────────────
  const [admins, setAdmins] = useState([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [adminSearch, setAdminSearch] = useState('')
  const [adminFilterActive, setAdminFilterActive] = useState('all')
  const [showAdminCreate, setShowAdminCreate] = useState(false)
  const [adminEditTarget, setAdminEditTarget] = useState(null)
  const [adminDeleteTarget, setAdminDeleteTarget] = useState(null)

  const fetchAdmins = useCallback(async () => {
    if (!isSuperAdmin) return
    setAdminsLoading(true)
    try {
      const params = {}
      if (adminSearch) params.search = adminSearch
      if (adminFilterActive !== 'all') params.is_active = adminFilterActive
      const res = await accountApi.listAdmins(params)
      setAdmins(res.data.admins || [])
    } catch {}
    setAdminsLoading(false)
  }, [isSuperAdmin, adminSearch, adminFilterActive])

  useEffect(() => {
    if (tab !== 'admins') return
    const t = setTimeout(fetchAdmins, 300)
    return () => clearTimeout(t)
  }, [tab, fetchAdmins])

  const handleCreateAdmin = async (data) => {
    await accountApi.createAdmin(data)
    toast.success(`${formatName(data)}'s admin account created!`)
    setShowAdminCreate(false)
    fetchAdmins()
  }
  const handleEditAdmin = async (data) => {
    await accountApi.updateAdmin(adminEditTarget.id, data)
    toast.success('Admin account updated.')
    setAdminEditTarget(null)
    fetchAdmins()
  }
  const handleDeleteAdmin = async () => {
    await accountApi.deleteAdmin(adminDeleteTarget.id)
    toast.success(`${formatName(adminDeleteTarget)} deactivated.`)
    setAdminDeleteTarget(null)
    fetchAdmins()
  }
  const handleReactivateAdmin = async (admin) => {
    await accountApi.updateAdmin(admin.id, { is_active: true })
    toast.success(`${formatName(admin)}'s admin account reactivated.`)
    fetchAdmins()
  }

  // ── Security Guards (super_admin only) ────────────────────
  const [guards, setGuards] = useState([])
  const [guardsLoading, setGuardsLoading] = useState(false)
  const [guardSearch, setGuardSearch] = useState('')
  const [guardFilterActive, setGuardFilterActive] = useState('all')
  const [showGuardCreate, setShowGuardCreate] = useState(false)
  const [guardEditTarget, setGuardEditTarget] = useState(null)
  const [guardDeleteTarget, setGuardDeleteTarget] = useState(null)

  const fetchGuards = useCallback(async () => {
    if (!isSuperAdmin) return
    setGuardsLoading(true)
    try {
      const params = {}
      if (guardSearch) params.search = guardSearch
      if (guardFilterActive !== 'all') params.is_active = guardFilterActive
      const res = await accountApi.listGuards(params)
      setGuards(res.data.guards || [])
    } catch {}
    setGuardsLoading(false)
  }, [isSuperAdmin, guardSearch, guardFilterActive])

  useEffect(() => {
    if (tab !== 'guards') return
    const t = setTimeout(fetchGuards, 300)
    return () => clearTimeout(t)
  }, [tab, fetchGuards])

  const handleCreateGuard = async (data) => {
    await accountApi.createGuard(data)
    toast.success(`${formatName(data)}'s guard account created!`)
    setShowGuardCreate(false)
    fetchGuards()
  }
  const handleEditGuard = async (data) => {
    await accountApi.updateGuard(guardEditTarget.id, data)
    toast.success('Guard account updated.')
    setGuardEditTarget(null)
    fetchGuards()
  }
  const handleDeleteGuard = async () => {
    await accountApi.deleteGuard(guardDeleteTarget.id)
    toast.success(`${formatName(guardDeleteTarget)} deactivated.`)
    setGuardDeleteTarget(null)
    fetchGuards()
  }
  const handleReactivateGuard = async (g) => {
    await accountApi.updateGuard(g.id, { is_active: true })
    toast.success(`${formatName(g)}'s guard account reactivated.`)
    fetchGuards()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Account Management</h1>
          <p className="page-subtitle">
            {tab === 'teachers'
              ? `${active.length} active · ${inactive.length} inactive teacher${teachers.length !== 1 ? 's' : ''}`
              : tab === 'admins'
              ? `${admins.length} admin account${admins.length !== 1 ? 's' : ''}`
              : tab === 'guards'
              ? `${guards.length} guard account${guards.length !== 1 ? 's' : ''}`
              : `${parentCount} parent account${parentCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        {tab === 'teachers' && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> Add Teacher
          </button>
        )}
        {tab === 'admins' && (
          <button onClick={() => setShowAdminCreate(true)} className="btn-primary">
            <Plus size={16} /> Add Admin
          </button>
        )}
        {tab === 'guards' && (
          <button onClick={() => setShowGuardCreate(true)} className="btn-primary">
            <Plus size={16} /> Add Guard
          </button>
        )}
        {tab === 'parents' && (
          <button onClick={() => setShowParentCreate(true)} className="btn-primary">
            <Plus size={16} /> Add Parent
          </button>
        )}
      </div>

      {/* Tabs (Admins tab only for super_admin) */}
      {isSuperAdmin && (
        <div className="flex items-center gap-2 border-b border-slate-200">
          <button onClick={() => setTab('teachers')}
            className={clsx(
              'px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === 'teachers'
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            Teachers
          </button>
          <button onClick={() => setTab('admins')}
            className={clsx(
              'px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === 'admins'
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            Admins
          </button>
          <button onClick={() => setTab('guards')}
            className={clsx(
              'px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === 'guards'
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            Guards
          </button>
          <button onClick={() => setTab('parents')}
            className={clsx(
              'px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === 'parents'
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            Parents
          </button>
        </div>
      )}

      {/* The Parents tab is its own component — a roster of parent portal
          accounts, plus the one thing a learner's page cannot do: attach
          another learner to an account that already exists. */}
      {tab === 'parents' && (
        <ParentAccounts
          createOpen={showParentCreate}
          onCloseCreate={() => setShowParentCreate(false)}
          onCountChange={setParentCount}
        />
      )}

      {tab === 'teachers' && <>
      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search by name or email..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-medium">
          {[
            { val: 'all',  label: 'All'      },
            { val: 'true', label: 'Active'   },
            { val: 'false',label: 'Inactive' },
          ].map(opt => (
            <button
              key={opt.val}
              onClick={() => setFilterActive(opt.val)}
              className={clsx(
                'px-4 py-2 transition-colors',
                filterActive === opt.val
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? <LoadingSpinner /> : teachers.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title="No teacher accounts found"
            description="Create a teacher account to get started."
            action={<button onClick={() => setShowCreate(true)} className="btn-primary">Add Teacher</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Contact</th>
                  <th>Assignments</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map(t => (
                  <tr key={t.id} className={!t.is_active ? 'opacity-50' : ''}>
                    {/* Teacher info */}
                    <td>
                      <div className="flex items-center gap-3">
                        <div className={clsx(
                          'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
                          t.is_active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'
                        )}>
                          {nameInitial(t)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{formatName(t)}</p>
                          <p className="text-xs text-slate-400">{t.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="text-sm text-slate-500">{t.phone || '—'}</td>

                    {/* Assignments */}
                    <td className="max-w-xs">
                      <AssignmentTags assignments={t.assignments} advisory={t.advisory} />
                    </td>

                    {/* Status badge */}
                    <td>
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                        t.is_active
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      )}>
                        <span className={clsx(
                          'w-1.5 h-1.5 rounded-full',
                          t.is_active ? 'bg-emerald-500' : 'bg-slate-400'
                        )} />
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="text-xs text-slate-400 font-mono whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="flex items-center gap-1 justify-start">
                        <button
                          onClick={() => setHistoryTarget(t)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Assignment History"
                        >
                          <History size={15} />
                        </button>

                        <button
                          onClick={() => setEditTarget(t)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={15} />
                        </button>

                        {!t.is_active && (
                          <button
                            onClick={() => handleReactivate(t)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title="Reactivate"
                          >
                            <ShieldCheck size={15} />
                          </button>
                        )}

                        <button
                          onClick={() => setDeleteTarget(t)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete / Deactivate"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>}

      {/* Admins tab body (super_admin only) */}
      {tab === 'admins' && isSuperAdmin && (<>
        <div className="card p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10" placeholder="Search by name or email..."
              value={adminSearch} onChange={e => setAdminSearch(e.target.value)} />
          </div>
          <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-medium">
            {[
              { val: 'all',  label: 'All'      },
              { val: 'true', label: 'Active'   },
              { val: 'false',label: 'Inactive' },
            ].map(opt => (
              <button
                key={opt.val}
                onClick={() => setAdminFilterActive(opt.val)}
                className={clsx(
                  'px-4 py-2 transition-colors',
                  adminFilterActive === opt.val
                    ? 'bg-brand-500 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          {adminsLoading ? <LoadingSpinner /> : admins.length === 0 ? (
            <EmptyState
              icon={UserCog}
              title="No admin accounts yet"
              description="Create an ECE or Elementary admin to delegate grade-scoped management."
              action={<button onClick={() => setShowAdminCreate(true)} className="btn-primary">Add Admin</button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Admin</th>
                    <th>Contact</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map(a => (
                    <tr key={a.id} className={!a.is_active ? 'opacity-50' : ''}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
                            a.is_active ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-400'
                          )}>
                            {nameInitial(a)}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">{formatName(a)}</p>
                            <p className="text-xs text-slate-400">{a.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm text-slate-500">{a.phone || '—'}</td>
                      <td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                          {ROLE_LABELS[a.role] || a.role}
                        </span>
                      </td>
                      <td>
                        <span className={clsx(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                          a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        )}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', a.is_active ? 'bg-emerald-500' : 'bg-slate-400')} />
                          {a.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-xs text-slate-400 font-mono whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td>
                        <div className="flex items-center gap-1 justify-start">
                          <button onClick={() => setAdminEditTarget(a)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            title="Edit">
                            <Pencil size={15} />
                          </button>
                          {a.role !== ROLES.SUPER_ADMIN && !a.is_active && (
                            <button onClick={() => handleReactivateAdmin(a)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Reactivate">
                              <ShieldCheck size={15} />
                            </button>
                          )}
                          {a.role !== ROLES.SUPER_ADMIN && a.is_active && (
                            <button onClick={() => setAdminDeleteTarget(a)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Deactivate">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}

      {/* Guards tab body (super_admin only) */}
      {tab === 'guards' && isSuperAdmin && (<>
        <div className="card p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10" placeholder="Search by name or email..."
              value={guardSearch} onChange={e => setGuardSearch(e.target.value)} />
          </div>
          <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-medium">
            {[
              { val: 'all',  label: 'All'      },
              { val: 'true', label: 'Active'   },
              { val: 'false',label: 'Inactive' },
            ].map(opt => (
              <button
                key={opt.val}
                onClick={() => setGuardFilterActive(opt.val)}
                className={clsx(
                  'px-4 py-2 transition-colors',
                  guardFilterActive === opt.val
                    ? 'bg-brand-500 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          {guardsLoading ? <LoadingSpinner /> : guards.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No guard accounts yet"
              description="Create a security-guard account to issue credentials for the VISTA Guard mobile app."
              action={<button onClick={() => setShowGuardCreate(true)} className="btn-primary">Add Guard</button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Guard</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {guards.map(g => (
                    <tr key={g.id} className={!g.is_active ? 'opacity-50' : ''}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
                            g.is_active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'
                          )}>
                            {nameInitial(g)}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">{formatName(g)}</p>
                            <p className="text-xs text-slate-400">{g.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm text-slate-500">{g.phone || '—'}</td>
                      <td>
                        <span className={clsx(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                          g.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        )}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', g.is_active ? 'bg-emerald-500' : 'bg-slate-400')} />
                          {g.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-xs text-slate-400 font-mono whitespace-nowrap">
                        {new Date(g.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td>
                        <div className="flex items-center gap-1 justify-start">
                          <button onClick={() => setGuardEditTarget(g)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            title="Edit">
                            <Pencil size={15} />
                          </button>
                          {!g.is_active && (
                            <button onClick={() => handleReactivateGuard(g)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Reactivate">
                              <ShieldCheck size={15} />
                            </button>
                          )}
                          {g.is_active && (
                            <button onClick={() => setGuardDeleteTarget(g)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Deactivate">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}

      {/* ── Guard Create / Edit / Delete Modals ──────────────── */}
      <Modal open={showGuardCreate} onClose={() => setShowGuardCreate(false)}
        title="Create Guard Account" size="lg">
        <GuardForm mode="create" onSubmit={handleCreateGuard} onClose={() => setShowGuardCreate(false)} />
      </Modal>
      <Modal open={!!guardEditTarget} onClose={() => setGuardEditTarget(null)}
        title="Edit Guard Account" size="lg">
        {guardEditTarget && (
          <GuardForm mode="edit" initial={guardEditTarget} onSubmit={handleEditGuard} onClose={() => setGuardEditTarget(null)} />
        )}
      </Modal>
      <Modal open={!!guardDeleteTarget} onClose={() => setGuardDeleteTarget(null)}
        title="Deactivate Guard Account">
        {guardDeleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Deactivate <b>{formatName(guardDeleteTarget)}</b>'s account? They won't be able to sign in to the VISTA Guard app. Historical dismissal logs are preserved.
            </p>
            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setGuardDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={handleDeleteGuard} className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700">
                Deactivate
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Admin Create / Edit / Delete Modals ─────────────── */}
      <Modal open={showAdminCreate} onClose={() => setShowAdminCreate(false)}
        title="Create Admin Account" size="lg">
        <AdminForm mode="create" onSubmit={handleCreateAdmin} onClose={() => setShowAdminCreate(false)} />
      </Modal>
      <Modal open={!!adminEditTarget} onClose={() => setAdminEditTarget(null)}
        title="Edit Admin Account" size="lg">
        {adminEditTarget && (
          <AdminForm mode="edit" initial={adminEditTarget} onSubmit={handleEditAdmin} onClose={() => setAdminEditTarget(null)} />
        )}
      </Modal>
      <Modal open={!!adminDeleteTarget} onClose={() => setAdminDeleteTarget(null)}
        title="Deactivate Admin Account">
        {adminDeleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Deactivate <b>{formatName(adminDeleteTarget)}</b>'s account? They won't be able to sign in. Historical records are preserved.
            </p>
            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setAdminDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={handleDeleteAdmin} className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700">
                Deactivate
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create Modal ───────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}
        title="Create Teacher Account" size="lg">
        <TeacherForm
          mode="create"
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      </Modal>

      {/* ── Edit Modal ─────────────────────────────────────── */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)}
        title="Edit Teacher Account" size="lg">
        {editTarget && (
          <TeacherForm
            mode="edit"
            initial={editTarget}
            onSubmit={handleEdit}
            onClose={() => setEditTarget(null)}
          />
        )}
      </Modal>

      {/* ── Delete Modal ───────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title="Remove Teacher Account">
        {deleteTarget && (
          <DeleteConfirm
            teacher={deleteTarget}
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </Modal>

      {/* ── Assignment History Modal ──────────────────────── */}
      <Modal open={!!historyTarget} onClose={() => setHistoryTarget(null)}
        title="Assignment History">
        {historyTarget && (
          <AssignmentHistory
            teacher={historyTarget}
            onClose={() => setHistoryTarget(null)}
          />
        )}
      </Modal>
    </div>
  )
}
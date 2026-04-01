import { useState, useEffect, useCallback } from 'react'
import {
  UserCog, Plus, Search, Pencil, Trash2, ShieldOff,
  ShieldCheck, Eye, EyeOff, X, BookOpen, ChevronDown
} from 'lucide-react'
import { accountApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal, PhoneInput } from '../components/UI'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { formatName, nameInitial, titleCase } from '../utils/nameHelper'

// ── School Data ───────────────────────────────────────────────
const GRADE_LEVELS = [
  'Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder',
  'Grade 1', 'Grade 2', 'Grade 3',
  'Grade 4', 'Grade 5', 'Grade 6',
]

// Sections and subjects loaded live from curriculum API per grade level

// ── Assignment Row Component ──────────────────────────────────
function AssignmentRow({ row, index, onChange, onRemove, takenAssignments = [] }) {
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
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
      {/* Grade Level */}
      <select
        className="input text-xs py-2"
        value={row.grade_level}
        onChange={e => set('grade_level', e.target.value)}
      >
        <option value="">Grade Level</option>
        {GRADE_LEVELS.map(g => <option key={g}>{g}</option>)}
      </select>

      {/* Section */}
      <select
        className="input text-xs py-2"
        value={row.section}
        onChange={e => set('section', e.target.value)}
        disabled={!row.grade_level}
      >
        <option value="">Section</option>
        {sections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
      </select>

      {/* Subject */}
      <select
        className={clsx('input text-xs py-2', row.subject && row.section && isTaken(row.grade_level, row.section, row.subject) && 'border-red-400 text-red-600')}
        value={row.subject}
        onChange={e => set('subject', e.target.value)}
        disabled={!row.grade_level || !row.section}
      >
        <option value="">Subject</option>
        {subjects.map(s => {
          const taken = row.section && isTaken(row.grade_level, row.section, s.name)
          const takenBy = taken ? getTakenBy(row.grade_level, row.section, s.name) : ''
          return (
            <option key={s.id} value={s.name} disabled={taken}>
              {s.name}{taken ? ` (${takenBy})` : ''}
            </option>
          )
        })}
      </select>

      <button
        type="button"
        onClick={() => onRemove(index)}
        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  )
}

// ── Empty assignment row ──────────────────────────────────────
const emptyRow = () => ({ grade_level: '', section: '', subject: '' })

// ── Teacher Form (shared by create + edit) ────────────────────
function TeacherForm({ initial, onSubmit, onClose, mode }) {
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

  useEffect(() => {
    accountApi.getAssignments()
      .then(res => {
        // Exclude current teacher's own assignments (they can keep theirs)
        const all = res.data.assignments || []
        setTakenAssignments(teacherId ? all.filter(a => a.teacher_id !== teacherId) : all)
      })
      .catch(() => setTakenAssignments([]))
  }, [])

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const addRow    = () => setForm(p => ({ ...p, assignments: [...p.assignments, emptyRow()] }))
  const removeRow = (i) => setForm(p => ({ ...p, assignments: p.assignments.filter((_, idx) => idx !== i) }))
  const updateRow = (i, val) => setForm(p => {
    const rows = [...p.assignments]
    rows[i] = val
    return { ...p, assignments: rows }
  })

  const handleSubmit = async e => {
    e.preventDefault()

    // Validate all assignment rows are complete
    const validAssignments = form.assignments.filter(
      a => a.grade_level && a.section && a.subject
    )

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
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Teaching Assignments
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Grade level, section and subject this teacher handles
            </p>
          </div>
          <button type="button" onClick={addRow}
            className="flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 px-2.5 py-1.5 rounded-lg hover:bg-teal-50 transition-colors">
            <Plus size={13} /> Add Row
          </button>
        </div>

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
            />
          ))}

          {form.assignments.length === 0 && (
            <p className="text-xs text-slate-400 py-2 text-center">
              No assignments added. Click "Add Row" to assign subjects.
            </p>
          )}
        </div>
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
function AssignmentTags({ assignments = [] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? assignments : assignments.slice(0, 2)
  const extra   = assignments.length - 2

  if (!assignments.length) return <span className="text-slate-400 text-xs">No assignments</span>

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 text-xs font-medium border border-teal-100">
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

// ── Main Page ─────────────────────────────────────────────────
export default function AccountManagement() {
  const [teachers, setTeachers]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterActive, setFilterActive] = useState('all')

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

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

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Account Management</h1>
          <p className="page-subtitle">
            {active.length} active · {inactive.length} inactive teacher{teachers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} /> Add Teacher
        </button>
      </div>

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
                  ? 'bg-teal-500 text-white'
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
                          t.is_active ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-400'
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
                      <AssignmentTags assignments={t.assignments} />
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
                          onClick={() => setEditTarget(t)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
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
    </div>
  )
}
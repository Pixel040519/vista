import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Pencil, Trash2, BookOpen, LayoutGrid,
  ChevronDown, ChevronRight, X, Check, CalendarDays,
  ChevronDown as ChevDown, Copy, SlidersHorizontal, ClipboardList, Lock, Users
} from 'lucide-react'
import { curriculumApi } from '../api/client'
import { LoadingSpinner, Modal } from '../components/UI'
import GradingConfigModal from '../components/GradingConfigModal'
import toast from 'react-hot-toast'
import { PERIOD_MODEL_OPTIONS, GRADING_POLICY_OPTIONS } from '../utils/grading'
import clsx from 'clsx'
import SchoolYearPicker from '../components/SchoolYearPicker'
import { useAuth } from '../context/AuthContext'

// ── School year validation helper ────────────────────────────
const validateSY = (label, start_date, end_date) => {
  const match = label && label.trim().match(/^(\d{4})-(\d{4})$/)
  if (!match) return 'Format must be YYYY-YYYY (e.g. 2025-2026)'
  const y1 = parseInt(match[1])
  const y2 = parseInt(match[2])
  if (y2 !== y1 + 1) return `Second year must be exactly one after the first — use ${y1}-${y1+1}`
  if (start_date) {
    const sy = new Date(start_date).getFullYear()
    if (sy !== y1) return `Start date year (${sy}) must match the first year of the label (${y1})`
  }
  if (end_date) {
    const ey = new Date(end_date).getFullYear()
    if (ey !== y2) return `End date year (${ey}) must match the second year of the label (${y2})`
  }
  return null
}

const GRADE_LEVELS = [
  'Kinder',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'
]
const ECE_GRADES = new Set(['Kinder'])

const GRADE_COLORS = {
  'Kinder':      { bg:'bg-purple-50',  border:'border-purple-200',  badge:'bg-purple-100 text-purple-700',  dot:'bg-purple-400'  },
  'Grade 1':     { bg:'bg-blue-50',    border:'border-blue-200',    badge:'bg-blue-100 text-blue-700',      dot:'bg-blue-400'    },
  'Grade 2':     { bg:'bg-sky-50',     border:'border-sky-200',     badge:'bg-sky-100 text-sky-700',        dot:'bg-sky-400'     },
  'Grade 3':     { bg:'bg-brand-50',    border:'border-brand-200',    badge:'bg-brand-100 text-brand-700',      dot:'bg-brand-400'    },
  'Grade 4':     { bg:'bg-emerald-50', border:'border-emerald-200', badge:'bg-emerald-100 text-emerald-700',dot:'bg-emerald-400' },
  'Grade 5':     { bg:'bg-amber-50',   border:'border-amber-200',   badge:'bg-amber-100 text-amber-700',    dot:'bg-amber-400'   },
  'Grade 6':     { bg:'bg-orange-50',  border:'border-orange-200',  badge:'bg-orange-100 text-orange-700',  dot:'bg-orange-400'  },
}

// ── Inline editable item ──────────────────────────────────────
function EditableItem({ item, onSave, onDelete, type, onGradingConfig }) {
  const [editing, setEditing]   = useState(false)
  const [name, setName]         = useState(item.name)
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave(item.id, { name:name.trim() })
      setEditing(false)
      toast.success(`${type === 'subject' ? 'Subject' : 'Section'} updated.`)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Update failed.')
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Remove "${item.name}"?`)) return
    setDeleting(true)
    try {
      await onDelete(item.id)
      toast.success(`"${item.name}" removed.`)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Cannot delete.')
      setDeleting(false)
    }
  }

  const handleKey = e => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false); setName(item.name) }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 p-2 bg-white rounded-lg border-2 border-brand-300 shadow-sm">
        <input autoFocus
          className="text-sm font-medium text-slate-800 bg-transparent outline-none border-b border-slate-200 pb-1"
          value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKey} placeholder="Name"/>
        <div className="flex gap-1 justify-end mt-0.5">
          <button onClick={() => { setEditing(false); setName(item.name) }}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={13}/></button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="p-1 rounded text-brand-600 hover:text-brand-700 hover:bg-brand-50 disabled:opacity-40"><Check size={13}/></button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-200">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-slate-700 truncate">{item.name}</p>
          {type === 'subject' && item.has_grading && onGradingConfig && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand-400" title="Grading structure configured" />
          )}
        </div>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
        {type === 'subject' && onGradingConfig && (
          <button onClick={() => onGradingConfig(item)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-50 transition-colors"
            title="Configure grading structure">
            <SlidersHorizontal size={12}/>
          </button>
        )}
        <button onClick={() => setEditing(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
          <Pencil size={12}/>
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={12}/>
        </button>
      </div>
    </div>
  )
}

// ── Add Item inline form ──────────────────────────────────────
function AddItemForm({ gradeLevel, type, syId, onAdd, onClose }) {
  const [name, setName]   = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onAdd({ name:name.trim(), grade_level:gradeLevel, sy_id:syId })
      toast.success(`${type === 'subject' ? 'Subject' : 'Section'} added to ${gradeLevel}.`)
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to add.')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit}
      className="flex flex-col gap-1.5 p-2 bg-white rounded-lg border-2 border-brand-300 shadow-sm mt-1">
      <input autoFocus
        className="text-sm font-medium text-slate-800 outline-none border-b border-slate-200 pb-1 bg-transparent"
        value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        placeholder={type === 'subject' ? 'Subject name...' : 'Section name...'} required/>
      <div className="flex gap-1 justify-end mt-0.5">
        <button type="button" onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={13}/></button>
        <button type="submit" disabled={saving || !name.trim()}
          className="p-1 rounded text-brand-600 hover:text-brand-700 hover:bg-brand-50 disabled:opacity-40"><Check size={13}/></button>
      </div>
    </form>
  )
}

// ── Grade Level Card ──────────────────────────────────────────
function GradeCard({ grade, items, type, syId, onAdd, onSave, onDelete, onGradingConfig }) {
  const [open, setOpen]     = useState(true)
  const [adding, setAdding] = useState(false)
  const colors = GRADE_COLORS[grade] || GRADE_COLORS['Grade 1']

  return (
    <div className={clsx('rounded-2xl border-2 overflow-hidden bg-white flex flex-col', colors.border)}>
    <div className={clsx('w-full flex items-center justify-between px-4 py-3 cursor-pointer', colors.bg)}
        onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3">
          <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', colors.dot)}/>
          <span className="font-semibold text-slate-800">{grade}</span>
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', colors.badge)}>
            {items.length} {type === 'subject' ? 'subject' : 'section'}{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); setAdding(true); setOpen(true) }}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600 px-2 py-1 rounded-lg hover:bg-white/60 transition-colors">
            <Plus size={13}/> Add
          </button>
          {open ? <ChevronDown size={15} className="text-slate-400"/> : <ChevronRight size={15} className="text-slate-400"/>}
        </div>
      </div>
      {open && (
        <div className="p-3 space-y-1 bg-white flex-1">
          {items.length === 0 && !adding && (
            <p className="text-xs text-slate-400 text-center py-3">
              No {type === 'subject' ? 'subjects' : 'sections'} yet.{' '}
              <button onClick={() => setAdding(true)} className="text-brand-600 font-medium hover:text-brand-700">Add one</button>
            </p>
          )}
          {items.map(item => (
            <EditableItem key={item.id} item={item} type={type} onSave={onSave} onDelete={onDelete} onGradingConfig={onGradingConfig}/>
          ))}
          {adding && (
            <AddItemForm gradeLevel={grade} type={type} syId={syId} onAdd={onAdd} onClose={() => setAdding(false)}/>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create School Year Modal ──────────────────────────────────
function CreateSYModal({ schoolYears, onClose, onCreate }) {
  const [form, setForm] = useState({
    label:'', start_date:'', end_date:'', copy_from_id:'',
    // A year created here is normally next year's; the very first year of a fresh
    // install has to be the active one or the school has nothing to work in.
    status: schoolYears.length ? 'upcoming' : 'active',
    period_model:'4Q', grading_policy:'DO8_2015',
  })
  const [copyEnabled, setCopyEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // The API refuses to tag a past year as upcoming, so mirror that here instead of
  // letting the user walk into a 422. A half-typed label still counts as allowed —
  // demoting mid-keystroke would make the select jump around.
  const labelMatch = form.label.trim().match(/^(\d{4})-(\d{4})$/)
  const canBeUpcoming = !labelMatch || parseInt(labelMatch[2]) > new Date().getFullYear()
  const status = form.status === 'upcoming' && !canBeUpcoming ? 'archived' : form.status

  const handleSubmit = async e => {
    e.preventDefault()
    const err = validateSY(form.label, form.start_date, form.end_date)
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      await onCreate({
        label:       form.label.trim(),
        start_date:  form.start_date || null,
        end_date:    form.end_date   || null,
        is_active:   status === 'active',
        is_upcoming: status === 'upcoming',
        period_model:   form.period_model,
        grading_policy: form.grading_policy,
        copy_from_id: copyEnabled && form.copy_from_id ? form.copy_from_id : null,
      })
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to create.')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">School Year Name *</label>
        <input className="input font-mono" placeholder="e.g., 2026-2027"
          value={form.label} onChange={e => set('label', e.target.value)} maxLength={9} required/>
        <p className="text-xs text-slate-400 mt-1">Format: YYYY-YYYY</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date</label>
          <input type="date" className="input" value={form.start_date} onChange={e => set('start_date', e.target.value)}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">End Date</label>
          <input type="date" className="input" value={form.end_date} onChange={e => set('end_date', e.target.value)}/>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
        <select className="input" value={status} onChange={e => set('status', e.target.value)}>
          <option value="active">Active</option>
          <option value="upcoming" disabled={!canBeUpcoming}>Upcoming</option>
          <option value="archived">Archived</option>
        </select>
        <p className="text-xs text-slate-400 mt-1">
          Active is the year everyone works in now — setting it archives the current one.
          Upcoming is pre-built for later; archived is historical.
          {!canBeUpcoming && ' A past school year cannot be tagged as upcoming.'}
        </p>
      </div>

      {/* Grading model — DepEd DO 009 / DO 015, s. 2026 */}
      <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50 space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-800">Grading model</p>
          <p className="text-xs text-slate-500">
            Select grading periods and final grade transmutation for this school year.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Grading periods</label>
            <select className="input" value={form.period_model} onChange={e => set('period_model', e.target.value)}>
              {PERIOD_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Final grade</label>
            <select className="input" value={form.grading_policy} onChange={e => set('grading_policy', e.target.value)}>
              {GRADING_POLICY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Copy from previous year */}
      <div className={clsx('p-4 rounded-xl border-2 transition-colors', copyEnabled ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-slate-50')}>
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2.5">
            <Copy size={15} className={copyEnabled ? 'text-brand-600' : 'text-slate-400'}/>
            <div>
              <p className="text-sm font-medium text-slate-800">Copy from previous year</p>
              <p className="text-xs text-slate-500">Copy subjects &amp; sections</p>
            </div>
          </div>
          {/* Toggle switch */}
          <button type="button" onClick={() => setCopyEnabled(!copyEnabled)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
              copyEnabled ? 'bg-brand-500' : 'bg-slate-300'
            )}>
            <span className={clsx(
              'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
              copyEnabled ? 'translate-x-5' : 'translate-x-0'
            )}/>
          </button>
        </label>

        {copyEnabled && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Copy from</label>
            <select className="input text-sm" value={form.copy_from_id}
              onChange={e => set('copy_from_id', e.target.value)}>
              <option value="">Select school year</option>
              {schoolYears.map(sy => (
                <option key={sy.id} value={sy.id}>SY {sy.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-1 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
          {saving ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  )
}

// ── Edit School Year Modal ────────────────────────────────────
function EditSYModal({ sy, onClose, onSave, onDelete }) {
  const getStatus = s => s.is_active ? 'active' : s.is_upcoming ? 'upcoming' : 'archived'
  const [form, setForm] = useState({
    label:      sy.label,
    start_date: sy.start_date ? sy.start_date.split('T')[0] : '',
    end_date:   sy.end_date   ? sy.end_date.split('T')[0]   : '',
    status:     getStatus(sy),
    period_model:   sy.period_model   || '4Q',
    grading_policy: sy.grading_policy || 'DO8_2015',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // An archived year is closed: its grading model is frozen so nothing can
  // re-transmute grades that were already issued. The model is chosen at creation.
  const gradingLocked = getStatus(sy) === 'archived'

  // Activating a year is the moment students move: everyone with an enrolment
  // record for it adopts that record's grade and section, and everyone without
  // one is marked pending and drops off the class lists. That is worth saying
  // out loud before it happens, so load the counts when Active is selected.
  const activating = form.status === 'active' && !sy.is_active
  const [readiness, setReadiness] = useState(null)
  useEffect(() => {
    if (!activating) { setReadiness(null); return }
    let cancelled = false
    curriculumApi.enrollmentReadiness(sy.id)
      .then(res => { if (!cancelled) setReadiness(res.data) })
      .catch(() => { if (!cancelled) setReadiness(null) })
    return () => { cancelled = true }
  }, [activating, sy.id])

  const handleSave = async e => {
    e.preventDefault()
    const err = validateSY(form.label, form.start_date, form.end_date)
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      await onSave(sy.id, {
        label:       form.label,
        start_date:  form.start_date || null,
        end_date:    form.end_date   || null,
        is_active:   form.status === 'active',
        is_upcoming: form.status === 'upcoming',
        period_model:   form.period_model,
        grading_policy: form.grading_policy,
      })
      onClose()
    }
    catch (e) { toast.error(e?.response?.data?.error || 'Failed.') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">School Year Name *</label>
        <input className="input font-mono" value={form.label}
          onChange={e => set('label', e.target.value)} maxLength={9} required/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date</label>
          <input type="date" className="input" value={form.start_date} onChange={e => set('start_date', e.target.value)}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">End Date</label>
          <input type="date" className="input" value={form.end_date} onChange={e => set('end_date', e.target.value)}/>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
        <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
          <option value="active">Active</option>
          <option value="upcoming">Upcoming</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Pre-flight: what activating this year will do to the students */}
      {activating && (
        <div className={clsx(
          'p-3 rounded-xl border text-xs space-y-1.5',
          readiness?.without_record ? 'bg-amber-50 border-amber-200 text-amber-800'
                                    : 'bg-slate-50 border-slate-200 text-slate-600'
        )}>
          <p className="font-semibold flex items-center gap-1.5">
            <Users size={13}/> Switching to SY {sy.label}
          </p>
          {!readiness ? (
            <p>Checking enrolment records&hellip;</p>
          ) : readiness.total_students === 0 ? (
            <p>There are no students on the books yet, so nothing moves.</p>
          ) : (
            <>
              <p>
                <strong>{readiness.with_record}</strong> of {readiness.total_students} learners have an
                enrolment record for this school year and will move to the grade level and section it names.
              </p>
              {readiness.without_record > 0 && (
                <p>
                  The other <strong>{readiness.without_record}</strong> will be marked <strong>Pending</strong> and
                  hidden from class lists until you enrol them.{' '}
                  <Link to="/enrollment" className="underline font-medium">Open Enrollment</Link> to set them up first.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Grading model — DepEd DO 009 / DO 015, s. 2026 */}
      <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50 space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-800">Grading model</p>
            {gradingLocked && (
              <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 font-medium">
                <Lock size={10}/> Locked
              </span>
            )}
          </div>
          {gradingLocked ? (
            <p className="text-xs text-slate-500">
              This school year is archived, so its grading model can no longer be
              changed &mdash; the grades it already issued stay reproducible.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Change this only before teachers start recording &mdash; it changes how
              grades are computed for this school year.
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Grading periods</label>
            <select className="input disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
              value={form.period_model} disabled={gradingLocked}
              onChange={e => set('period_model', e.target.value)}>
              {PERIOD_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Final grade</label>
            <select className="input disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
              value={form.grading_policy} disabled={gradingLocked}
              onChange={e => set('grading_policy', e.target.value)}>
              {GRADING_POLICY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>


      <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
        {!sy.is_active && (
          <button type="button" onClick={() => { onDelete(sy); onClose() }}
            className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 border border-red-200 transition-colors">
            <Trash2 size={13}/> Delete
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm justify-center">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ── Main Page ─────────────────────────────────────────────────
// ── Assessment mode per grade level ───────────────────────────
// DO 015, s. 2026 moves KS1 off numeric grading one grade level per year. The
// schedule is configuration rather than code: NRYS is private (DO 015 only
// "encourages" adoption), so the school sets its own pace.
function AssessmentCard({ entry, scales, onSave, onReset }) {
  const [mode, setMode]   = useState(entry.assessment_mode)
  const [scale, setScale] = useState(entry.rating_scale || 'EGFNA')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMode(entry.assessment_mode)
    setScale(entry.rating_scale || 'EGFNA')
  }, [entry.assessment_mode, entry.rating_scale, entry.grade_level])

  const dirty = mode !== entry.assessment_mode ||
    (mode === 'descriptive' && scale !== (entry.rating_scale || 'EGFNA'))

  const activeScale = scales.find(s => s.id === scale)

  const submit = async () => {
    setSaving(true)
    try { await onSave(entry.grade_level, mode, mode === 'descriptive' ? scale : null) }
    finally { setSaving(false) }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{entry.grade_level}</h3>
        {entry.configured
          ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-600 font-medium">configured</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-medium">default</span>}
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
        {[['numeric', 'Numeric'], ['descriptive', 'Descriptive']].map(([v, label]) => (
          <button key={v} type="button" onClick={() => setMode(v)}
            className={clsx('flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              mode === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'descriptive' ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">Rating scale</label>
          <select className="input" value={scale} onChange={e => setScale(e.target.value)}>
            {scales.map(s => <option key={s.id} value={s.id}>{s.short}</option>)}
          </select>
          {activeScale && (
            <>
              <p className="text-[11px] text-slate-400">{activeScale.source}</p>
              <div className="flex flex-wrap gap-1">
                {activeScale.levels.map(lv => (
                  <span key={lv.code}
                    title={lv.description || lv.label}
                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                    {lv.code} · {lv.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">
          Weighted scores in Score Entry, converted by this school year's transmutation table.
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={submit} disabled={!dirty || saving}
          className={clsx('btn-primary text-xs px-3 py-1.5', (!dirty || saving) && 'opacity-50 cursor-not-allowed')}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {entry.configured && (
          <button type="button" onClick={() => onReset(entry.grade_level)}
            className="text-xs text-slate-400 hover:text-slate-600">
            Reset to default
          </button>
        )}
      </div>
    </div>
  )
}

export default function CurriculumManagement() {
  const { isSuperAdmin, gradeScope } = useAuth()
  const visibleGrades = isSuperAdmin || !gradeScope?.length
    ? GRADE_LEVELS
    : GRADE_LEVELS.filter(g => gradeScope.includes(g))
  const [schoolYears, setSchoolYears]   = useState([])
  const [selectedSY, setSelectedSY]     = useState(null)
  const [tab, setTab]                   = useState('subjects')
  const [subjects, setSubjects]         = useState({})
  const [sections, setSections]         = useState({})
  const [loadingContent, setLoadingContent] = useState(false)
  const [showCreate, setShowCreate]     = useState(false)
  const [editSY, setEditSY]             = useState(null)
  const [gradingSubject, setGradingSubject] = useState(null)
  const [assessment, setAssessment] = useState({ config: [], scales: [] })

  // ── Load school years ──────────────────────────────────────
  const fetchSchoolYears = useCallback(async () => {
    try {
      const res = await curriculumApi.getSchoolYears()
      const syl = res.data.school_years
      setSchoolYears(syl)
      // Auto-select current year on first load; refresh selected SY data on subsequent calls
      setSelectedSY(prev => {
        if (!prev) return syl.find(s => s.is_active) || syl[0] || null
        return syl.find(s => s.id === prev.id) || prev
      })
    } catch {}
  }, []) // eslint-disable-line

  useEffect(() => { fetchSchoolYears() }, [fetchSchoolYears])

  // ── Assessment configuration for the selected SY ──────────
  const loadAssessment = useCallback(async (syId) => {
    if (!syId) { setAssessment({ config: [], scales: [] }); return }
    try {
      const res = await curriculumApi.getAssessmentConfig({ sy_id: syId })
      setAssessment({ config: res.data.config || [], scales: res.data.scales || [] })
    } catch { setAssessment({ config: [], scales: [] }) }
  }, [])

  useEffect(() => { loadAssessment(selectedSY?.id) }, [selectedSY?.id, loadAssessment])

  const handleSaveAssessment = async (grade_level, assessment_mode, rating_scale) => {
    try {
      await curriculumApi.saveAssessmentConfig({
        sy_id: selectedSY.id,
        entries: [{ grade_level, assessment_mode, rating_scale }],
      })
      toast.success(`${grade_level} set to ${assessment_mode} assessment.`)
      await loadAssessment(selectedSY.id)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save.')
    }
  }

  const handleResetAssessment = async (grade_level) => {
    try {
      await curriculumApi.resetAssessmentConfig(grade_level, { sy_id: selectedSY.id })
      toast.success(`${grade_level} reverted to the default.`)
      await loadAssessment(selectedSY.id)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to reset.')
    }
  }

  // A descriptive grade level has no weighted components, so the grading-weights
  // modal does not apply to it. This used to be keyed on a hardcoded ECE list.
  const descriptiveGrades = new Set(
    assessment.config.filter(c => c.assessment_mode === 'descriptive').map(c => c.grade_level)
  )

  // ── Load subjects + sections when SY or tab changes ────────
  const fetchContent = useCallback(async () => {
    if (!selectedSY) return
    setLoadingContent(true)
    try {
      const [subRes, secRes] = await Promise.all([
        curriculumApi.getSubjectsGrouped(selectedSY.id),
        curriculumApi.getSectionsGrouped(selectedSY.id),
      ])
      setSubjects(subRes.data.grouped)
      setSections(secRes.data.grouped)
    } catch {} finally { setLoadingContent(false) }
  }, [selectedSY])

  useEffect(() => { fetchContent() }, [fetchContent])

  // ── Subject handlers ───────────────────────────────────────
  const handleAddSubject = async (payload) => {
    const res = await curriculumApi.createSubject(payload)
    setSubjects(prev => ({
      ...prev,
      [payload.grade_level]: [...(prev[payload.grade_level] || []), res.data.subject]
    }))
  }

  const handleUpdateSubject = async (id, payload) => {
    const res = await curriculumApi.updateSubject(id, payload)
    const updated = res.data.subject
    setSubjects(prev => {
      const next = { ...prev }
      for (const gl of GRADE_LEVELS) next[gl] = (next[gl]||[]).map(s => s.id === id ? updated : s)
      return next
    })
  }

  const handleDeleteSubject = async (id) => {
    const res = await curriculumApi.deleteSubject(id)
    toast.success(res.data.message)
    setSubjects(prev => {
      const next = { ...prev }
      for (const gl of GRADE_LEVELS) next[gl] = (next[gl]||[]).filter(s => s.id !== id)
      return next
    })
  }

  // ── Section handlers ───────────────────────────────────────
  const handleAddSection = async (payload) => {
    const res = await curriculumApi.createSection(payload)
    setSections(prev => ({
      ...prev,
      [payload.grade_level]: [...(prev[payload.grade_level] || []), res.data.section]
    }))
  }

  const handleUpdateSection = async (id, payload) => {
    const res = await curriculumApi.updateSection(id, payload)
    const updated = res.data.section
    setSections(prev => {
      const next = { ...prev }
      for (const gl of GRADE_LEVELS) next[gl] = (next[gl]||[]).map(s => s.id === id ? updated : s)
      return next
    })
  }

  const handleDeleteSection = async (id) => {
    const res = await curriculumApi.deleteSection(id)
    toast.success(res.data.message)
    setSections(prev => {
      const next = { ...prev }
      for (const gl of GRADE_LEVELS) next[gl] = (next[gl]||[]).filter(s => s.id !== id)
      return next
    })
  }

  // ── School year handlers ───────────────────────────────────
  const handleCreateSY = async (data) => {
    const res = await curriculumApi.createSchoolYear(data)
    const newSY = res.data.school_year
    toast.success(`School year "${newSY.label}" created!`)
    await fetchSchoolYears()
    setSelectedSY(newSY)
  }

  const handleUpdateSY = async (id, data) => {
    const res = await curriculumApi.updateSchoolYear(id, data)
    // `rollover` is only present when this call actually switched the active
    // year -- the moment students move -- so report what happened to them.
    const roll = res.data.rollover
    if (roll) {
      toast.success(
        `School year switched. ${roll.adopted} learner${roll.adopted === 1 ? '' : 's'} moved into their enrolled class` +
        (roll.pending ? `, ${roll.pending} marked pending.` : '.'),
        { duration: 6000 }
      )
    } else {
      toast.success('School year updated.')
    }
    await fetchSchoolYears()
  }


  const handleDeleteSY = async (sy) => {
    if (!window.confirm(`Delete school year "${sy.label}"? This will also delete all its subjects and sections.`)) return
    try {
      const res = await curriculumApi.deleteSchoolYear(sy.id)
      toast.success(res.data.message)
      setSchoolYears(p => p.filter(y => y.id !== sy.id))
      if (selectedSY?.id === sy.id) {
        const remaining = schoolYears.filter(y => y.id !== sy.id)
        setSelectedSY(remaining[0] || null)
      }
    } catch (err) { toast.error(err?.response?.data?.error || 'Cannot delete.') }
  }

  const totalSubjects = Object.values(subjects).reduce((a, b) => a + b.length, 0)
  const totalSections = Object.values(sections).reduce((a, b) => a + b.length, 0)

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="page-title">Curriculum Management</h1>
        <p className="page-subtitle">
          Manage subjects and sections for Kinder through Grade 6
        </p>
      </div>

      {/* SY selector + tabs row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* School Year Selector */}
        <SchoolYearPicker
          schoolYears={schoolYears}
          selectedSY={selectedSY}
          onSelect={setSelectedSY}
          onManage={() => setShowCreate(true)}
          canManage={isSuperAdmin}
        />

        {/* Edit current SY button (super_admin only) */}
        {selectedSY && isSuperAdmin && (
          <button onClick={() => setEditSY(selectedSY)}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Edit school year settings">
            <Pencil size={15}/>
          </button>
        )}

        <div className="w-px h-6 bg-slate-200 mx-1"/>

        {/* Subjects tab */}
        <button onClick={() => setTab('subjects')}
          className={clsx(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            tab === 'subjects'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300 hover:text-brand-600'
          )}>
          <BookOpen size={15}/>
          Subjects
          <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium',
            tab === 'subjects' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>
            {totalSubjects}
          </span>
        </button>

        {/* Sections tab */}
        <button onClick={() => setTab('sections')}
          className={clsx(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            tab === 'sections'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300 hover:text-brand-600'
          )}>
          <LayoutGrid size={15}/>
          Sections
          <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium',
            tab === 'sections' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>
            {totalSections}
          </span>
        </button>

        {/* Assessment tab */}
        <button onClick={() => setTab('assessment')}
          className={clsx(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            tab === 'assessment'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300 hover:text-brand-600'
          )}>
          <ClipboardList size={15}/>
          Assessment
        </button>

      </div>

      {/* Hint */}
      <p className="text-xs text-slate-400">
        Click the <span className="font-semibold text-slate-500">✏️</span> icon to edit an item inline,
        the <span className="font-semibold text-slate-500">sliders</span> icon to configure grading weights,
        or click <span className="font-semibold text-slate-500">+ Add</span> on any grade card to add a new one.
      </p>

      {/* Content */}
      {!selectedSY ? (
        <div className="card p-8 text-center text-slate-400">
          <CalendarDays size={32} className="mx-auto mb-3 opacity-40"/>
          <p className="font-medium">No school year selected</p>
          <p className="text-sm mt-1">Create a school year to get started.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
            <Plus size={15}/> Create School Year
          </button>
        </div>
      ) : loadingContent ? <LoadingSpinner/> : (
        <>
          {/* ── Subjects ─────────────────────────────────── */}
          {tab === 'subjects' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Default grid stretch: every card in a row takes the height of the
                  tallest card in that row, and each row is measured on its own. */}
              {visibleGrades.map(grade => (
                <GradeCard key={grade} grade={grade}
                  items={subjects[grade] || []} type="subject" syId={selectedSY.id}
                  onAdd={handleAddSubject} onSave={handleUpdateSubject} onDelete={handleDeleteSubject}
                  onGradingConfig={descriptiveGrades.has(grade) ? undefined : setGradingSubject}/>
              ))}
            </div>
          )}

          {/* ── Assessment ───────────────────────────────── */}
          {tab === 'assessment' && (
            <div className="space-y-4">
              <div className="card p-4">
                <p className="text-sm text-slate-600">
                  How each grade level is assessed in <span className="font-semibold">{selectedSY.label}</span>.
                  <span className="text-slate-400"> Numeric levels use Score Entry and the transmutation table;
                  descriptive levels are rated against competencies on the scale you pick.</span>
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {assessment.config.map(entry => (
                  <AssessmentCard key={entry.grade_level} entry={entry} scales={assessment.scales}
                    onSave={handleSaveAssessment} onReset={handleResetAssessment}/>
                ))}
              </div>
            </div>
          )}

          {/* ── Sections ─────────────────────────────────── */}
          {tab === 'sections' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Default grid stretch: every card in a row takes the height of the
                  tallest card in that row, and each row is measured on its own. */}
              {visibleGrades.map(grade => (
                <GradeCard key={grade} grade={grade}
                  items={sections[grade] || []} type="section" syId={selectedSY.id}
                  onAdd={handleAddSection} onSave={handleUpdateSection} onDelete={handleDeleteSection}/>
              ))}
            </div>
          )}

        </>
      )}

      {/* ── Create SY Modal ─────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New School Year">
        <CreateSYModal
          schoolYears={schoolYears}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateSY}
        />
      </Modal>

      {/* ── Edit SY Modal ───────────────────────────────── */}
      <Modal open={!!editSY} onClose={() => setEditSY(null)} title="Edit School Year">
        {editSY && (
          <EditSYModal
            sy={editSY}
            onClose={() => setEditSY(null)}
            onSave={handleUpdateSY}
            onDelete={handleDeleteSY}
          />
        )}
      </Modal>

      {/* ── Grading Structure Modal ───────────────────── */}
      <GradingConfigModal
        open={!!gradingSubject}
        onClose={() => setGradingSubject(null)}
        subject={gradingSubject}
        onSaved={fetchContent}
      />
    </div>
  )
}

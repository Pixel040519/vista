import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, BookOpen, LayoutGrid,
  ChevronDown, ChevronRight, X, Check, CalendarDays,
  ChevronDown as ChevDown, Copy, SlidersHorizontal, Baby
} from 'lucide-react'
import { curriculumApi, eceApi } from '../api/client'
import { LoadingSpinner, Modal } from '../components/UI'
import GradingConfigModal from '../components/GradingConfigModal'
import toast from 'react-hot-toast'
import clsx from 'clsx'

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
  'Pre-Nursery','Nursery','Pre-Kinder','Kinder',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'
]

const GRADE_COLORS = {
  'Pre-Nursery': { bg:'bg-rose-50',    border:'border-rose-200',    badge:'bg-rose-100 text-rose-700',      dot:'bg-rose-400'    },
  'Pre-Kinder':  { bg:'bg-fuchsia-50', border:'border-fuchsia-200', badge:'bg-fuchsia-100 text-fuchsia-700', dot:'bg-fuchsia-400' },
  'Nursery':     { bg:'bg-pink-50',    border:'border-pink-200',    badge:'bg-pink-100 text-pink-700',      dot:'bg-pink-400'    },
  'Kinder':      { bg:'bg-purple-50',  border:'border-purple-200',  badge:'bg-purple-100 text-purple-700',  dot:'bg-purple-400'  },
  'Grade 1':     { bg:'bg-blue-50',    border:'border-blue-200',    badge:'bg-blue-100 text-blue-700',      dot:'bg-blue-400'    },
  'Grade 2':     { bg:'bg-sky-50',     border:'border-sky-200',     badge:'bg-sky-100 text-sky-700',        dot:'bg-sky-400'     },
  'Grade 3':     { bg:'bg-teal-50',    border:'border-teal-200',    badge:'bg-teal-100 text-teal-700',      dot:'bg-teal-400'    },
  'Grade 4':     { bg:'bg-emerald-50', border:'border-emerald-200', badge:'bg-emerald-100 text-emerald-700',dot:'bg-emerald-400' },
  'Grade 5':     { bg:'bg-amber-50',   border:'border-amber-200',   badge:'bg-amber-100 text-amber-700',    dot:'bg-amber-400'   },
  'Grade 6':     { bg:'bg-orange-50',  border:'border-orange-200',  badge:'bg-orange-100 text-orange-700',  dot:'bg-orange-400'  },
}

// ── Inline editable item ──────────────────────────────────────
function EditableItem({ item, onSave, onDelete, type, onGradingConfig }) {
  const [editing, setEditing]   = useState(false)
  const [name, setName]         = useState(item.name)
  const [desc, setDesc]         = useState(item.description || '')
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = type === 'subject' ? { name:name.trim(), description:desc.trim() } : { name:name.trim() }
      await onSave(item.id, payload)
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
    if (e.key === 'Escape') { setEditing(false); setName(item.name); setDesc(item.description||'') }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 p-2 bg-white rounded-lg border-2 border-teal-300 shadow-sm">
        <input autoFocus
          className="text-sm font-medium text-slate-800 bg-transparent outline-none border-b border-slate-200 pb-1"
          value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKey} placeholder="Name"/>
        {type === 'subject' && (
          <input className="text-xs text-slate-500 bg-transparent outline-none"
            value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={handleKey} placeholder="Description (optional)"/>
        )}
        <div className="flex gap-1 justify-end mt-0.5">
          <button onClick={() => { setEditing(false); setName(item.name); setDesc(item.description||'') }}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={13}/></button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="p-1 rounded text-teal-600 hover:text-teal-700 hover:bg-teal-50 disabled:opacity-40"><Check size={13}/></button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-200">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-slate-700 truncate">{item.name}</p>
          {type === 'subject' && item.has_grading && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-teal-400" title="Grading structure configured" />
          )}
        </div>
        {type === 'subject' && item.description && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{item.description}</p>
        )}
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
        {type === 'subject' && onGradingConfig && (
          <button onClick={() => onGradingConfig(item)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-teal-50 transition-colors"
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
  const [desc, setDesc]   = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = type === 'subject'
        ? { name:name.trim(), grade_level:gradeLevel, description:desc.trim(), sy_id:syId }
        : { name:name.trim(), grade_level:gradeLevel, sy_id:syId }
      await onAdd(payload)
      toast.success(`${type === 'subject' ? 'Subject' : 'Section'} added to ${gradeLevel}.`)
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to add.')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit}
      className="flex flex-col gap-1.5 p-2 bg-white rounded-lg border-2 border-teal-300 shadow-sm mt-1">
      <input autoFocus
        className="text-sm font-medium text-slate-800 outline-none border-b border-slate-200 pb-1 bg-transparent"
        value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        placeholder={type === 'subject' ? 'Subject name...' : 'Section name...'} required/>
      {type === 'subject' && (
        <input className="text-xs text-slate-500 outline-none bg-transparent"
          value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)"/>
      )}
      <div className="flex gap-1 justify-end mt-0.5">
        <button type="button" onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={13}/></button>
        <button type="submit" disabled={saving || !name.trim()}
          className="p-1 rounded text-teal-600 hover:text-teal-700 hover:bg-teal-50 disabled:opacity-40"><Check size={13}/></button>
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
    <div className={clsx('rounded-2xl border-2 overflow-hidden', colors.border)}>
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
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600 px-2 py-1 rounded-lg hover:bg-white/60 transition-colors">
            <Plus size={13}/> Add
          </button>
          {open ? <ChevronDown size={15} className="text-slate-400"/> : <ChevronRight size={15} className="text-slate-400"/>}
        </div>
      </div>
      {open && (
        <div className="p-3 space-y-1 bg-white">
          {items.length === 0 && !adding && (
            <p className="text-xs text-slate-400 text-center py-3">
              No {type === 'subject' ? 'subjects' : 'sections'} yet.{' '}
              <button onClick={() => setAdding(true)} className="text-teal-600 font-medium hover:text-teal-700">Add one</button>
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

// ── School Year Selector Dropdown ─────────────────────────────
function SYSelector({ schoolYears, selectedSY, onSelect, onManage }) {
  const [open, setOpen] = useState(false)
  const current = selectedSY

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 hover:border-teal-300 transition-colors shadow-sm"
      >
        <CalendarDays size={15} className="text-teal-500"/>
        SY {current?.label || '—'}
        {current?.is_active
          ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">active</span>
          : current?.is_upcoming
            ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">upcoming</span>
            : current
              ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">archived</span>
              : null
        }
        <ChevDown size={13} className={clsx('text-slate-400 transition-transform', open && 'rotate-180')}/>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)}/>
          <div className="absolute top-full left-0 mt-1 z-20 w-64 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
            {schoolYears.map(sy => (
              <button key={sy.id}
                onClick={() => { onSelect(sy); setOpen(false) }}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors',
                  sy.id === selectedSY?.id && 'bg-teal-50'
                )}>
                <CalendarDays size={14} className="text-slate-400 flex-shrink-0"/>
                <span className="flex-1 text-sm font-medium text-slate-800">SY {sy.label}</span>
                {sy.is_active
                  ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">active</span>
                  : sy.is_upcoming
                    ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">upcoming</span>
                    : <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">archived</span>
                }
              </button>
            ))}
            <div className="border-t border-slate-100">
              <button onClick={() => { setOpen(false); onManage() }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-teal-600 hover:bg-teal-50 transition-colors font-medium">
                <Plus size={14}/> Create New School Year
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Create School Year Modal ──────────────────────────────────
function CreateSYModal({ schoolYears, onClose, onCreate }) {
  const [form, setForm] = useState({ label:'', start_date:'', end_date:'', copy_from_id:'' })
  const [copyEnabled, setCopyEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

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

      {/* Copy from previous year */}
      <div className={clsx('p-4 rounded-xl border-2 transition-colors', copyEnabled ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50')}>
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2.5">
            <Copy size={15} className={copyEnabled ? 'text-teal-600' : 'text-slate-400'}/>
            <div>
              <p className="text-sm font-medium text-slate-800">Copy from previous year</p>
              <p className="text-xs text-slate-500">Copy subjects &amp; sections</p>
            </div>
          </div>
          {/* Toggle switch */}
          <button type="button" onClick={() => setCopyEnabled(!copyEnabled)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
              copyEnabled ? 'bg-teal-500' : 'bg-slate-300'
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
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

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
export default function CurriculumManagement() {
  const [schoolYears, setSchoolYears]   = useState([])
  const [selectedSY, setSelectedSY]     = useState(null)
  const [tab, setTab]                   = useState('subjects')
  const [subjects, setSubjects]         = useState({})
  const [sections, setSections]         = useState({})
  const [loadingContent, setLoadingContent] = useState(false)
  const [showCreate, setShowCreate]     = useState(false)
  const [editSY, setEditSY]             = useState(null)
  const [gradingSubject, setGradingSubject] = useState(null)

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
    await curriculumApi.updateSchoolYear(id, data)
    toast.success('School year updated.')
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
          Manage subjects and sections for Pre-Nursery through Grade 6
        </p>
      </div>

      {/* SY selector + tabs row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* School Year Selector */}
        <SYSelector
          schoolYears={schoolYears}
          selectedSY={selectedSY}
          onSelect={setSelectedSY}
          onManage={() => setShowCreate(true)}
        />

        {/* Edit current SY button */}
        {selectedSY && (
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
              ? 'bg-teal-500 text-white shadow-md shadow-teal-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-600'
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
              ? 'bg-teal-500 text-white shadow-md shadow-teal-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-600'
          )}>
          <LayoutGrid size={15}/>
          Sections
          <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium',
            tab === 'sections' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>
            {totalSections}
          </span>
        </button>

        {/* ECE Catalog tab */}
        <button onClick={() => setTab('ece')}
          className={clsx(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            tab === 'ece'
              ? 'bg-teal-500 text-white shadow-md shadow-teal-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-600'
          )}>
          <Baby size={15}/>
          ECE Catalog
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
              {GRADE_LEVELS.map(grade => (
                <GradeCard key={grade} grade={grade}
                  items={subjects[grade] || []} type="subject" syId={selectedSY.id}
                  onAdd={handleAddSubject} onSave={handleUpdateSubject} onDelete={handleDeleteSubject}
                  onGradingConfig={setGradingSubject}/>
              ))}
            </div>
          )}

          {/* ── Sections ─────────────────────────────────── */}
          {tab === 'sections' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {GRADE_LEVELS.map(grade => (
                <GradeCard key={grade} grade={grade}
                  items={sections[grade] || []} type="section" syId={selectedSY.id}
                  onAdd={handleAddSection} onSave={handleUpdateSection} onDelete={handleDeleteSection}/>
              ))}
            </div>
          )}

          {/* ── ECE Catalog ──────────────────────────────── */}
          {tab === 'ece' && <EceCatalogPanel/>}
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

// ──────────────────────────────────────────────────────────────
// ECE Competency Catalog Panel (admin CRUD for domains + skills)
// ──────────────────────────────────────────────────────────────
function EceCatalogPanel() {
  const [domains, setDomains]   = useState([])
  const [skills,  setSkills]    = useState([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState({})  // domainId -> bool
  const [adding, setAdding]     = useState(null) // 'domain' | domainId
  const [newName, setNewName]   = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([eceApi.getDomains(), eceApi.getSkills()])
      .then(([dRes, sRes]) => {
        setDomains(dRes.data.domains || [])
        setSkills(sRes.data.skills || [])
      })
      .catch(() => toast.error('Failed to load catalog'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleAddDomain = async () => {
    if (!newName.trim()) return
    try {
      await eceApi.createDomain({ name: newName.trim(), display_order: domains.length + 1 })
      toast.success('Domain added')
      setNewName(''); setAdding(null); load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add domain')
    }
  }

  const handleAddSkill = async (domainId) => {
    if (!newName.trim()) return
    const skillCount = skills.filter(s => s.domain_id === domainId).length
    try {
      await eceApi.createSkill({
        domain_id: domainId,
        name: newName.trim(),
        display_order: skillCount + 1,
      })
      toast.success('Skill added')
      setNewName(''); setAdding(null); load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add skill')
    }
  }

  const handleUpdateDomain = async (id, name) => {
    if (!name.trim()) return
    try {
      await eceApi.updateDomain(id, { name: name.trim() })
      toast.success('Updated'); load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed')
    }
  }

  const handleUpdateSkill = async (id, name) => {
    if (!name.trim()) return
    try {
      await eceApi.updateSkill(id, { name: name.trim() })
      toast.success('Updated'); load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed')
    }
  }

  const handleDeleteDomain = async (id) => {
    if (!window.confirm('Delete this domain? Skills with existing ratings will be archived.')) return
    try {
      await eceApi.deleteDomain(id)
      toast.success('Deleted'); load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed')
    }
  }

  const handleDeleteSkill = async (id) => {
    if (!window.confirm('Delete this skill? If it has ratings it will be archived instead.')) return
    try {
      await eceApi.deleteSkill(id)
      toast.success('Deleted'); load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed')
    }
  }

  if (loading) return <LoadingSpinner/>

  return (
    <div className="space-y-3">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Competency Domains & Skills</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Used by ECE teachers (Pre-Nursery to Kinder) for quarterly developmental tracking
          </p>
        </div>
        {adding === 'domain' ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="input py-1.5 text-sm"
              placeholder="Domain name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddDomain()
                if (e.key === 'Escape') { setAdding(null); setNewName('') }
              }}
            />
            <button onClick={handleAddDomain} className="p-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600">
              <Check size={14}/>
            </button>
            <button onClick={() => { setAdding(null); setNewName('') }}
              className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200">
              <X size={14}/>
            </button>
          </div>
        ) : (
          <button onClick={() => { setAdding('domain'); setNewName('') }} className="btn-primary">
            <Plus size={15}/> Add Domain
          </button>
        )}
      </div>

      {domains.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-400">
          No domains yet. Click "Add Domain" to start.
        </div>
      )}

      {domains.map(domain => {
        const domainSkills = skills.filter(s => s.domain_id === domain.id)
        const open = expanded[domain.id] !== false // default open
        return (
          <div key={domain.id} className="card overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <button
                onClick={() => setExpanded(e => ({ ...e, [domain.id]: !open }))}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
              </button>
              <EditableCatalogRow
                value={domain.name}
                onSave={name => handleUpdateDomain(domain.id, name)}
                bold
              />
              <span className="ml-auto text-xs text-slate-400">{domainSkills.length} skill{domainSkills.length !== 1 ? 's' : ''}</span>
              <button onClick={() => handleDeleteDomain(domain.id)}
                className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50">
                <Trash2 size={14}/>
              </button>
            </div>

            {open && (
              <div className="p-4 space-y-2">
                {domainSkills.map(skill => (
                  <div key={skill.id} className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"/>
                    <EditableCatalogRow
                      value={skill.name}
                      onSave={name => handleUpdateSkill(skill.id, name)}
                    />
                    <button onClick={() => handleDeleteSkill(skill.id)}
                      className="p-1 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 ml-auto">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))}
                {adding === domain.id ? (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      autoFocus
                      className="input py-1 text-sm"
                      placeholder="Skill name (e.g. Counts from 1 to 10)"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddSkill(domain.id)
                        if (e.key === 'Escape') { setAdding(null); setNewName('') }
                      }}
                    />
                    <button onClick={() => handleAddSkill(domain.id)}
                      className="p-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600">
                      <Check size={14}/>
                    </button>
                    <button onClick={() => { setAdding(null); setNewName('') }}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200">
                      <X size={14}/>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAdding(domain.id); setNewName('') }}
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1 mt-2"
                  >
                    <Plus size={13}/> Add skill
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function EditableCatalogRow({ value, onSave, bold }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={clsx(
          'text-sm text-left hover:text-teal-600',
          bold ? 'font-semibold text-slate-800' : 'text-slate-600'
        )}
      >
        {value}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-1">
      <input
        autoFocus
        className="input py-1 text-sm flex-1"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onSave(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
      />
      <button
        onClick={() => { onSave(draft); setEditing(false) }}
        className="p-1 rounded-md text-teal-600 hover:bg-teal-50"
      >
        <Check size={14}/>
      </button>
      <button
        onClick={() => { setDraft(value); setEditing(false) }}
        className="p-1 rounded-md text-slate-400 hover:bg-slate-100"
      >
        <X size={14}/>
      </button>
    </div>
  )
}
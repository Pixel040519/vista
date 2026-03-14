import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, BookOpen, LayoutGrid, ChevronDown, ChevronRight, X, Check } from 'lucide-react'
import { curriculumApi } from '../api/client'
import { LoadingSpinner } from '../components/UI'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const GRADE_LEVELS = ['Pre-Nursery','Nursery', 'Pre-Kinder', 'Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']

const GRADE_COLORS = {
  'Pre-Nursery': { bg: 'bg-rose-50',   border: 'border-rose-200',   badge: 'bg-rose-100 text-rose-700',     dot: 'bg-rose-400'   },
  'Pre-Kinder':  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', badge: 'bg-fuchsia-100 text-fuchsia-700',dot: 'bg-fuchsia-400' },
  'Nursery': { bg: 'bg-pink-50',   border: 'border-pink-200',   badge: 'bg-pink-100 text-pink-700',   dot: 'bg-pink-400'   },
  'Kinder':  { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700',dot: 'bg-purple-400' },
  'Grade 1': { bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400'   },
  'Grade 2': { bg: 'bg-sky-50',    border: 'border-sky-200',    badge: 'bg-sky-100 text-sky-700',     dot: 'bg-sky-400'    },
  'Grade 3': { bg: 'bg-teal-50',   border: 'border-teal-200',   badge: 'bg-teal-100 text-teal-700',   dot: 'bg-teal-400'   },
  'Grade 4': { bg: 'bg-emerald-50',border: 'border-emerald-200',badge: 'bg-emerald-100 text-emerald-700',dot:'bg-emerald-400'},
  'Grade 5': { bg: 'bg-amber-50',  border: 'border-amber-200',  badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400'  },
  'Grade 6': { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700',dot:'bg-orange-400' },
}

// ── Inline editable item ──────────────────────────────────────
function EditableItem({ item, onSave, onDelete, type }) {
  const [editing, setEditing]   = useState(false)
  const [name, setName]         = useState(item.name)
  const [desc, setDesc]         = useState(item.description || '')
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = type === 'subject' ? { name: name.trim(), description: desc.trim() } : { name: name.trim() }
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
    if (e.key === 'Escape') { setEditing(false); setName(item.name); setDesc(item.description || '') }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 p-2 bg-white rounded-lg border-2 border-teal-300 shadow-sm">
        <input
          autoFocus
          className="text-sm font-medium text-slate-800 bg-transparent outline-none border-b border-slate-200 pb-1"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Name"
        />
        {type === 'subject' && (
          <input
            className="text-xs text-slate-500 bg-transparent outline-none"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Description (optional)"
          />
        )}
        <div className="flex gap-1 justify-end mt-0.5">
          <button onClick={() => { setEditing(false); setName(item.name); setDesc(item.description||'') }}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={13}/>
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="p-1 rounded text-teal-600 hover:text-teal-700 hover:bg-teal-50 disabled:opacity-40">
            <Check size={13}/>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-200">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate">{item.name}</p>
        {type === 'subject' && item.description && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{item.description}</p>
        )}
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
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
function AddItemForm({ gradeLevel, type, onAdd, onClose }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = type === 'subject'
        ? { name: name.trim(), grade_level: gradeLevel, description: desc.trim() }
        : { name: name.trim(), grade_level: gradeLevel }
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
      <input
        autoFocus
        className="text-sm font-medium text-slate-800 outline-none border-b border-slate-200 pb-1 bg-transparent"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        placeholder={type === 'subject' ? 'Subject name...' : 'Section name...'}
        required
      />
      {type === 'subject' && (
        <input
          className="text-xs text-slate-500 outline-none bg-transparent"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Description (optional)"
        />
      )}
      <div className="flex gap-1 justify-end mt-0.5">
        <button type="button" onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <X size={13}/>
        </button>
        <button type="submit" disabled={saving || !name.trim()}
          className="p-1 rounded text-teal-600 hover:text-teal-700 hover:bg-teal-50 disabled:opacity-40">
          <Check size={13}/>
        </button>
      </div>
    </form>
  )
}

// ── Grade Level Card ──────────────────────────────────────────
function GradeCard({ grade, items, type, onAdd, onSave, onDelete }) {
  const [open, setOpen]       = useState(true)
  const [adding, setAdding]   = useState(false)
  const colors = GRADE_COLORS[grade] || GRADE_COLORS['Grade 1']

  const handleAdd = async (payload) => {
    await onAdd(payload)
  }

  return (
    <div className={clsx('rounded-2xl border-2 overflow-hidden transition-all', colors.border)}>
      {/* Card header */}
      <button
        onClick={() => setOpen(!open)}
        className={clsx('w-full flex items-center justify-between px-4 py-3', colors.bg)}
      >
        <div className="flex items-center gap-3">
          <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', colors.dot)}/>
          <span className="font-semibold text-slate-800">{grade}</span>
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', colors.badge)}>
            {items.length} {type === 'subject' ? 'subject' : 'section'}{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); setAdding(true); setOpen(true) }}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600 px-2 py-1 rounded-lg hover:bg-white/60 transition-colors"
          >
            <Plus size={13}/> Add
          </button>
          {open ? <ChevronDown size={15} className="text-slate-400"/> : <ChevronRight size={15} className="text-slate-400"/>}
        </div>
      </button>

      {/* Card body */}
      {open && (
        <div className="p-3 space-y-1 bg-white">
          {items.length === 0 && !adding && (
            <p className="text-xs text-slate-400 text-center py-3">
              No {type === 'subject' ? 'subjects' : 'sections'} yet.{' '}
              <button onClick={() => setAdding(true)} className="text-teal-600 font-medium hover:text-teal-700">
                Add one
              </button>
            </p>
          )}

          {items.map(item => (
            <EditableItem
              key={item.id}
              item={item}
              type={type}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}

          {adding && (
            <AddItemForm
              gradeLevel={grade}
              type={type}
              onAdd={handleAdd}
              onClose={() => setAdding(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function CurriculumManagement() {
  const [tab, setTab]               = useState('subjects')
  const [subjects, setSubjects]     = useState({})
  const [sections, setSections]     = useState({})
  const [loadingS, setLoadingS]     = useState(true)
  const [loadingSec, setLoadingSec] = useState(true)

  const initGrouped = () => {
    const g = {}
    for (const gl of GRADE_LEVELS) g[gl] = []
    return g
  }

  const fetchSubjects = useCallback(async () => {
    setLoadingS(true)
    try {
      const res = await curriculumApi.getSubjectsGrouped()
      setSubjects(res.data.grouped)
    } catch {} finally { setLoadingS(false) }
  }, [])

  const fetchSections = useCallback(async () => {
    setLoadingSec(true)
    try {
      const res = await curriculumApi.getSectionsGrouped()
      setSections(res.data.grouped)
    } catch {} finally { setLoadingSec(false) }
  }, [])

  useEffect(() => { fetchSubjects() }, [fetchSubjects])
  useEffect(() => { fetchSections() }, [fetchSections])

  // ── Subject handlers ────────────────────────────────────────
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
      for (const gl of GRADE_LEVELS) {
        next[gl] = (next[gl] || []).map(s => s.id === id ? updated : s)
      }
      return next
    })
  }

  const handleDeleteSubject = async (id) => {
    const res = await curriculumApi.deleteSubject(id)
    toast.success(res.data.message)
    setSubjects(prev => {
      const next = { ...prev }
      for (const gl of GRADE_LEVELS) {
        next[gl] = (next[gl] || []).filter(s => s.id !== id)
      }
      return next
    })
  }

  // ── Section handlers ────────────────────────────────────────
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
      for (const gl of GRADE_LEVELS) {
        next[gl] = (next[gl] || []).map(s => s.id === id ? updated : s)
      }
      return next
    })
  }

  const handleDeleteSection = async (id) => {
    const res = await curriculumApi.deleteSection(id)
    toast.success(res.data.message)
    setSections(prev => {
      const next = { ...prev }
      for (const gl of GRADE_LEVELS) {
        next[gl] = (next[gl] || []).filter(s => s.id !== id)
      }
      return next
    })
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

      {/* Tab bar */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => setTab('subjects')}
          className={clsx(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            tab === 'subjects'
              ? 'bg-teal-500 text-white shadow-md shadow-teal-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-600'
          )}
        >
          <BookOpen size={15}/>
          Subjects
          <span className={clsx(
            'text-xs px-1.5 py-0.5 rounded-full font-medium',
            tab === 'subjects' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
          )}>
            {totalSubjects}
          </span>
        </button>

        <button
          onClick={() => setTab('sections')}
          className={clsx(
            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            tab === 'sections'
              ? 'bg-teal-500 text-white shadow-md shadow-teal-200'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-600'
          )}
        >
          <LayoutGrid size={15}/>
          Sections
          <span className={clsx(
            'text-xs px-1.5 py-0.5 rounded-full font-medium',
            tab === 'sections' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
          )}>
            {totalSections}
          </span>
        </button>
      </div>

      {/* Hint */}
      <p className="text-xs text-slate-400">
        Click the <span className="font-semibold text-slate-500">✏️</span> icon to edit an item inline,
        or click <span className="font-semibold text-slate-500">+ Add</span> on any grade card to add a new one.
        Changes take effect immediately.
      </p>

      {/* ── Subjects tab ─────────────────────────────────────── */}
      {tab === 'subjects' && (
        loadingS ? <LoadingSpinner/> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {GRADE_LEVELS.map(grade => (
              <GradeCard
                key={grade}
                grade={grade}
                items={subjects[grade] || []}
                type="subject"
                onAdd={handleAddSubject}
                onSave={handleUpdateSubject}
                onDelete={handleDeleteSubject}
              />
            ))}
          </div>
        )
      )}

      {/* ── Sections tab ─────────────────────────────────────── */}
      {tab === 'sections' && (
        loadingSec ? <LoadingSpinner/> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {GRADE_LEVELS.map(grade => (
              <GradeCard
                key={grade}
                grade={grade}
                items={sections[grade] || []}
                type="section"
                onAdd={handleAddSection}
                onSave={handleUpdateSection}
                onDelete={handleDeleteSection}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}
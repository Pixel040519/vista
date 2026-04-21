import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { eceApi, curriculumApi } from '../api/client'
import { LoadingSpinner } from '../components/UI'
import { Baby, Save, Info, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import toast from 'react-hot-toast'

const ECE_GRADES = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']
const QUARTERS = [1, 2, 3, 4]
const RATINGS = [
  { value: 'E',  label: 'Excellent',       color: 'bg-emerald-500 text-white border-emerald-600' },
  { value: 'G',  label: 'Good',            color: 'bg-brand-500 text-white border-brand-600' },
  { value: 'F',  label: 'Fair',            color: 'bg-amber-500 text-white border-amber-600' },
  { value: 'NA', label: 'Needs Assistance', color: 'bg-red-500 text-white border-red-600' },
]

// ── Inline skill add/edit form ────────────────────────────────
function SkillForm({ initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '')

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return toast.error('Description is required')
    onSave({ name: trimmed, description: '' })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 px-5 py-3 bg-slate-50 border-b border-slate-100">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <input
          className="input text-sm"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          placeholder="e.g. Recognizes letters"
          autoFocus
        />
      </div>
      <div className="flex gap-1">
        <button type="submit" disabled={saving} className="p-2 rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
          <Check size={14} />
        </button>
        <button type="button" onClick={onCancel} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
          <X size={14} />
        </button>
      </div>
    </form>
  )
}

// ── Skill list item (shown in manage mode) ───────────────────
function SkillItem({ skill, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-2 px-5 py-1.5 hover:bg-slate-50 group transition-colors">
      <div className="min-w-0">
        <span className="text-sm text-slate-700">{skill.name}</span>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button onClick={() => onEdit(skill)} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
          <Pencil size={12} />
        </button>
        <button onClick={() => onDelete(skill)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

export default function EceCompetency() {
  const { user, activeAssignments, isAnyAdmin } = useAuth()
  const isReadOnly = isAnyAdmin

  // Admin: load all ECE sections school-wide (they have no activeAssignments).
  // Teacher: build class list from activeAssignments filtered to ECE grades.
  const [adminSections, setAdminSections] = useState([])
  useEffect(() => {
    if (!isReadOnly) return
    curriculumApi.getSections()
      .then(res => setAdminSections(res.data.sections || []))
      .catch(() => setAdminSections([]))
  }, [isReadOnly])

  const eceClasses = useMemo(() => {
    const seen = new Set()
    const out = []
    const source = isReadOnly
      ? adminSections.map(s => ({ grade_level: s.grade_level, section: s.name }))
      : (activeAssignments || [])
    for (const a of source) {
      if (!ECE_GRADES.includes(a.grade_level)) continue
      const key = `${a.grade_level}||${a.section}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ grade_level: a.grade_level, section: a.section, key })
    }
    return out
  }, [isReadOnly, activeAssignments, adminSections])

  const [selectedClass, setSelectedClass] = useState('')
  const [quarter, setQuarter] = useState(1)
  const [ratingFilter, setRatingFilter] = useState(null) // null | 'E' | 'G' | 'F' | 'NA'
  const [subjects, setSubjects] = useState([])  // subjects for the selected grade level (used as domains)
  const [skills, setSkills] = useState([])
  const [students, setStudents] = useState([])
  const [grid, setGrid] = useState({}) // grid[studentId][skillId] = rating
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Skill management state
  const [addingToSubject, setAddingToSubject] = useState(null) // subject id or null
  const [editingSkill, setEditingSkill] = useState(null)       // skill object or null
  const [skillSaving, setSkillSaving] = useState(false)
  const [managingSubject, setManagingSubject] = useState(null)  // subject id or null

  // Expandable student state
  const [expandedStudents, setExpandedStudents] = useState({}) // `${subjectId}::${studentId}` -> bool

  // Drag-and-drop subject reorder
  const [dragIdx, setDragIdx] = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  // Auto-select first class
  useEffect(() => {
    if (!selectedClass && eceClasses.length > 0) {
      setSelectedClass(eceClasses[0].key)
    }
  }, [eceClasses, selectedClass])

  // Load subjects for the selected grade level + skills + records
  useEffect(() => {
    if (!selectedClass) return
    const [grade_level, section] = selectedClass.split('||')
    setLoading(true)
    Promise.all([
      curriculumApi.getSubjects({ grade_level }),
      eceApi.getSkills(),
      eceApi.getRecords({ grade_level, section, quarter }),
    ])
      .then(([subRes, skRes, recRes]) => {
        let subs = subRes.data.subjects || []
        // Apply saved subject order
        const key = `vista_ece_subject_order_${grade_level}||${section}`
        try {
          const saved = JSON.parse(localStorage.getItem(key))
          if (Array.isArray(saved) && saved.length) {
            const order = new Map(saved.map((id, i) => [id, i]))
            subs = [...subs].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
          }
        } catch {}
        setSubjects(subs)
        setSkills(skRes.data.skills || [])
        setStudents(recRes.data.students || [])
        const g = {}
        for (const r of recRes.data.records || []) {
          if (!g[r.student_id]) g[r.student_id] = {}
          g[r.student_id][r.skill_id] = r.rating
        }
        setGrid(g)
        setDirty(false)
      })
      .catch(err => toast.error(err.response?.data?.error || 'Failed to load data'))
      .finally(() => setLoading(false))
  }, [selectedClass, quarter])

  const setRating = (studentId, skillId, rating) => {
    setGrid(prev => {
      const next = { ...prev }
      if (!next[studentId]) next[studentId] = {}
      if (next[studentId][skillId] === rating) {
        const copy = { ...next[studentId] }
        delete copy[skillId]
        next[studentId] = copy
      } else {
        next[studentId] = { ...next[studentId], [skillId]: rating }
      }
      return next
    })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!selectedClass) return
    const [grade_level, section] = selectedClass.split('||')
    const entries = []
    for (const student of students) {
      const sg = grid[student.id] || {}
      for (const [skillId, rating] of Object.entries(sg)) {
        entries.push({ student_id: student.id, skill_id: skillId, rating })
      }
    }
    if (entries.length === 0) {
      toast.error('No ratings to save')
      return
    }
    setSaving(true)
    try {
      await eceApi.saveRecords({ grade_level, section, quarter, entries })
      toast.success(`Saved ${entries.length} rating(s)`)
      setDirty(false)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save')
    }
    setSaving(false)
  }

  // ── Skill CRUD handlers ─────────────────────────────────────
  const handleAddSkill = async ({ name, description }) => {
    if (!addingToSubject) return
    setSkillSaving(true)
    try {
      const maxOrder = skills.filter(s => s.subject_id === addingToSubject).reduce((m, s) => Math.max(m, s.display_order || 0), 0)
      const res = await eceApi.createSkill({ subject_id: addingToSubject, name, description, display_order: maxOrder + 1 })
      setSkills(prev => [...prev, res.data.skill])
      setAddingToSubject(null)
      toast.success('Description added')
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to add description'
      toast.error(msg.includes('unique') || msg.includes('duplicate') ? 'A description with that name already exists for this subject' : msg)
    }
    setSkillSaving(false)
  }

  const handleUpdateSkill = async ({ name, description }) => {
    if (!editingSkill) return
    setSkillSaving(true)
    try {
      const res = await eceApi.updateSkill(editingSkill.id, { name, description })
      setSkills(prev => prev.map(s => s.id === editingSkill.id ? { ...s, ...res.data.skill } : s))
      setEditingSkill(null)
      toast.success('Description updated')
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update description'
      toast.error(msg.includes('unique') || msg.includes('duplicate') ? 'A description with that name already exists for this subject' : msg)
    }
    setSkillSaving(false)
  }

  const handleDeleteSkill = async (skill) => {
    if (!window.confirm(`Delete "${skill.name}"? If it has existing ratings, it will be archived instead.`)) return
    try {
      const res = await eceApi.deleteSkill(skill.id)
      setSkills(prev => prev.filter(s => s.id !== skill.id))
      toast.success(res.data.message || 'Description removed')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete description')
    }
  }

  const toggleStudent = (subjectId, studentId) => {
    const key = `${subjectId}::${studentId}`
    setExpandedStudents(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleAllStudents = (subjectId) => {
    const allExpanded = students.every(st => expandedStudents[`${subjectId}::${st.id}`])
    const updates = {}
    for (const st of students) {
      updates[`${subjectId}::${st.id}`] = !allExpanded
    }
    setExpandedStudents(prev => ({ ...prev, ...updates }))
  }

  // ── Subject drag-and-drop reorder ────────────────────────────
  const orderKey = selectedClass ? `vista_ece_subject_order_${selectedClass}` : null
  const scrollRaf = useRef(null)

  // Auto-scroll when dragging near top/bottom of viewport
  const handleDocDragOver = useCallback((e) => {
    // Find the element that is actually scrolling
    const mainEl = document.querySelector('main')
    const candidates = [mainEl, document.documentElement, document.body]
    let scrollEl = null
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight) { scrollEl = el; break }
    }
    if (!scrollEl) return

    const edge = 60
    const speed = 20
    const y = e.clientY
    const topZone = 64 + edge // 64 = Topbar height, scroll-up zone is 64–124px

    const doScroll = (delta) => {
      const before = scrollEl.scrollTop
      scrollEl.scrollTop += delta
      // If scrollEl didn't move, try window as fallback
      if (scrollEl.scrollTop === before) window.scrollBy(0, delta)
    }

    if (y < topZone && y > 64) {
      cancelAnimationFrame(scrollRaf.current)
      const intensity = 1 - (y - 64) / edge
      const scroll = () => {
        doScroll(-Math.ceil(speed * intensity))
        scrollRaf.current = requestAnimationFrame(scroll)
      }
      scrollRaf.current = requestAnimationFrame(scroll)
    } else if (y > window.innerHeight - edge) {
      cancelAnimationFrame(scrollRaf.current)
      const intensity = 1 - (window.innerHeight - y) / edge
      const scroll = () => {
        doScroll(Math.ceil(speed * intensity))
        scrollRaf.current = requestAnimationFrame(scroll)
      }
      scrollRaf.current = requestAnimationFrame(scroll)
    } else {
      cancelAnimationFrame(scrollRaf.current)
    }
  }, [])

  const handleDragStart = (idx) => (e) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    document.addEventListener('dragover', handleDocDragOver)
  }
  const handleDragOver = (idx) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (idx !== dragOverIdx) setDragOverIdx(idx)
  }
  const handleDrop = (idx) => (e) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    setSubjects(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      if (orderKey) {
        try { localStorage.setItem(orderKey, JSON.stringify(next.map(s => s.id))) } catch {}
      }
      return next
    })
    setDragIdx(null)
    setDragOverIdx(null)
  }
  const handleDragEnd = () => {
    setDragIdx(null)
    setDragOverIdx(null)
    cancelAnimationFrame(scrollRaf.current)
    document.removeEventListener('dragover', handleDocDragOver)
  }

  if (eceClasses.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Baby size={40} className="mx-auto text-slate-300 mb-3" />
        <h2 className="text-lg font-semibold text-slate-800">
          {isReadOnly ? 'No ECE classes configured' : 'No ECE classes assigned'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {isReadOnly
            ? 'No Pre-Nursery, Nursery, Pre-Kinder, or Kinder sections exist in the active school year.'
            : 'Competency tracking is available for Pre-Nursery, Nursery, Pre-Kinder, and Kinder teachers.'}
        </p>
      </div>
    )
  }

  // Group skills by subject_id
  const skillsBySubject = subjects.map(subj => ({
    ...subj,
    skills: skills.filter(s => s.subject_id === subj.id),
  }))

  // When ratingFilter is active, check if any subject has any matching rating
  const filterHasMatches = !ratingFilter || skillsBySubject.some(subj =>
    students.some(st => subj.skills.some(sk => grid[st.id]?.[sk.id] === ratingFilter))
  )

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">ECE Competency Tracker</h1>
          <p className="page-subtitle">
            {isReadOnly
              ? 'Review developmental milestones recorded by teachers'
              : 'Record developmental milestones for early learners'}
          </p>
        </div>
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="btn-primary"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save Ratings'}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select className="input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
            {eceClasses.map(c => (
              <option key={c.key} value={c.key}>{c.grade_level} — {c.section}</option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium text-slate-600 mb-1">Quarter</label>
          <select className="input" value={quarter} onChange={e => setQuarter(Number(e.target.value))}>
            {QUARTERS.map(q => <option key={q} value={q}>Q{q}</option>)}
          </select>
        </div>
        {isReadOnly && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Filter by rating</label>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setRatingFilter(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  ratingFilter === null
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                All
              </button>
              {RATINGS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRatingFilter(ratingFilter === r.value ? null : r.value)}
                  title={r.label}
                  className={`w-10 py-1.5 rounded-lg text-xs font-bold border transition ${
                    ratingFilter === r.value
                      ? r.color
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {r.value}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="card p-4 flex flex-wrap items-center gap-3 text-xs">
        <Info size={14} className="text-slate-400" />
        <span className="text-slate-500 font-medium">Scale:</span>
        {RATINGS.map(r => (
          <span key={r.value} className={`px-2 py-1 rounded-full border ${r.color} font-semibold`}>
            {r.value} = {r.label}
          </span>
        ))}
        {!isReadOnly && (
          <span className="text-slate-400 ml-auto">Click a rating again to clear it</span>
        )}
      </div>

      {loading ? <LoadingSpinner /> : (
        students.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-500">
            No active students in this class.
          </div>
        ) : !filterHasMatches ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-slate-500">
              No students with a <span className="font-semibold">{ratingFilter}</span> rating in Q{quarter} for this class.
            </p>
            <button
              type="button"
              onClick={() => setRatingFilter(null)}
              className="mt-3 text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {skillsBySubject.map((subj, subjIdx) => {
              // Per-student filtered skills based on ratingFilter
              const studentView = students.map(st => {
                const matched = ratingFilter
                  ? subj.skills.filter(sk => grid[st.id]?.[sk.id] === ratingFilter)
                  : subj.skills
                return { student: st, matchedSkills: matched }
              })
              const visibleStudents = ratingFilter
                ? studentView.filter(sv => sv.matchedSkills.length > 0)
                : studentView

              // Hide subject card entirely if filter active and no matches school-wide for this subject
              if (ratingFilter && visibleStudents.length === 0) return null

              const dragEnabled = !ratingFilter
              return (
              <div
                key={subj.id}
                draggable={dragEnabled}
                onDragStart={dragEnabled ? handleDragStart(subjIdx) : undefined}
                onDragOver={dragEnabled ? handleDragOver(subjIdx) : undefined}
                onDrop={dragEnabled ? handleDrop(subjIdx) : undefined}
                onDragEnd={dragEnabled ? handleDragEnd : undefined}
                className={`card overflow-hidden transition-all ${
                  dragIdx === subjIdx ? 'opacity-40 ring-2 ring-brand-300'
                    : dragOverIdx === subjIdx && dragIdx !== null ? 'ring-2 ring-brand-400 shadow-lg'
                    : ''
                }`}
              >
                {/* Subject header (used as domain) */}
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {dragEnabled && (
                      <span className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 flex-shrink-0">
                        <GripVertical size={16} />
                      </span>
                    )}
                    <h3 className="text-sm font-semibold text-slate-800">{subj.name}</h3>
                  </div>
                  {!isReadOnly && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setManagingSubject(managingSubject === subj.id ? null : subj.id)}
                        className={`text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                          managingSubject === subj.id
                            ? 'bg-brand-100 text-brand-700'
                            : 'text-slate-500 hover:text-brand-600 hover:bg-brand-50'
                        }`}
                      >
                        <Pencil size={12} className="inline -mt-0.5 mr-1" />
                        Manage
                      </button>
                      <button
                        onClick={() => { setAddingToSubject(subj.id); setEditingSkill(null) }}
                        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
                      >
                        <Plus size={13} /> Add
                      </button>
                    </div>
                  )}
                </div>

                {/* Skill management list (toggled) */}
                {!isReadOnly && managingSubject === subj.id && subj.skills.length > 0 && (
                  <div className="border-b border-slate-100 bg-slate-50/50 py-1">
                    <p className="px-5 py-1 text-xs text-slate-400">
                      Descriptions under {subj.name}
                    </p>
                    {subj.skills.map(sk => (
                      editingSkill?.id === sk.id ? (
                        <SkillForm
                          key={sk.id}
                          initial={editingSkill}
                          saving={skillSaving}
                          onSave={handleUpdateSkill}
                          onCancel={() => setEditingSkill(null)}
                        />
                      ) : (
                        <SkillItem
                          key={sk.id}
                          skill={sk}
                          onEdit={setEditingSkill}
                          onDelete={handleDeleteSkill}
                        />
                      )
                    ))}
                  </div>
                )}

                {/* Add skill form */}
                {!isReadOnly && addingToSubject === subj.id && (
                  <SkillForm
                    saving={skillSaving}
                    onSave={handleAddSkill}
                    onCancel={() => setAddingToSubject(null)}
                  />
                )}

                {/* Student rows */}
                {subj.skills.length === 0 ? (
                  <div className="px-5 py-6 text-center text-sm text-slate-400">
                    {isReadOnly
                      ? 'No descriptions have been added for this subject yet.'
                      : <>No descriptions yet. Click <span className="font-medium text-brand-600">+ Add</span> to create one.</>
                    }
                  </div>
                ) : (
                  <>
                    {/* Expand/Collapse all toggle */}
                    <div className="px-5 py-2 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        {ratingFilter
                          ? `${visibleStudents.length} of ${students.length} student${students.length !== 1 ? 's' : ''} with ${ratingFilter} rating`
                          : `${students.length} student${students.length !== 1 ? 's' : ''}`}
                      </span>
                      <button
                        onClick={() => {
                          const visibleIds = visibleStudents.map(v => v.student.id)
                          const allExpanded = visibleIds.every(id => expandedStudents[`${subj.id}::${id}`])
                          const updates = {}
                          for (const id of visibleIds) {
                            updates[`${subj.id}::${id}`] = !allExpanded
                          }
                          setExpandedStudents(prev => ({ ...prev, ...updates }))
                        }}
                        className="text-xs text-slate-500 hover:text-brand-600 font-medium transition-colors"
                      >
                        {visibleStudents.every(v => expandedStudents[`${subj.id}::${v.student.id}`]) ? 'Collapse All' : 'Expand All'}
                      </button>
                    </div>

                    <div className="divide-y divide-slate-300">
                      {visibleStudents.map(({ student: st, matchedSkills }) => {
                        const key = `${subj.id}::${st.id}`
                        const isExpanded = expandedStudents[key]
                        const ratedCount = subj.skills.filter(sk => grid[st.id]?.[sk.id]).length

                        return (
                          <div key={st.id}>
                            {/* Student row */}
                            <div
                              className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-slate-50 transition-colors select-none"
                              onClick={() => toggleStudent(subj.id, st.id)}
                            >
                              <div className="flex items-center gap-2">
                                {isExpanded
                                  ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                                  : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                                }
                                <span className="text-sm font-semibold text-slate-800">{st.full_name}</span>
                              </div>
                              {ratingFilter ? (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${RATINGS.find(r => r.value === ratingFilter)?.color}`}>
                                  {matchedSkills.length} {ratingFilter}
                                </span>
                              ) : (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  ratedCount === subj.skills.length
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : ratedCount > 0
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-slate-100 text-slate-400'
                                }`}>
                                  {ratedCount}/{subj.skills.length}
                                </span>
                              )}
                            </div>

                            {/* Expanded: skill rows with ratings */}
                            {isExpanded && (
                              <div className="pb-3 px-5 pl-10 space-y-1.5">
                                {matchedSkills.map(sk => {
                                  const current = grid[st.id]?.[sk.id]
                                  return (
                                    <div key={sk.id} className="flex items-center justify-between gap-3 py-1">
                                      <div className="min-w-0 flex-1">
                                        <span className="text-sm font-medium text-slate-800">{sk.name}</span>
                                      </div>
                                      <div className="flex gap-1 flex-shrink-0">
                                        {isReadOnly ? (
                                          current ? (
                                            <span
                                              className={`w-8 h-7 rounded-md text-xs font-bold border inline-flex items-center justify-center ${RATINGS.find(r => r.value === current)?.color}`}
                                              title={RATINGS.find(r => r.value === current)?.label}
                                            >
                                              {current}
                                            </span>
                                          ) : (
                                            <span className="text-[11px] text-slate-400 italic">Not rated</span>
                                          )
                                        ) : (
                                          RATINGS.map(r => (
                                            <button
                                              key={r.value}
                                              type="button"
                                              onClick={(e) => { e.stopPropagation(); setRating(st.id, sk.id, r.value) }}
                                              className={`w-8 h-7 rounded-md text-xs font-bold border transition ${
                                                current === r.value
                                                  ? r.color
                                                  : 'border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-600'
                                              }`}
                                              title={r.label}
                                            >
                                              {r.value}
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

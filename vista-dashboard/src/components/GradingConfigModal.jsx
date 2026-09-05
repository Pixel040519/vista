import { useState, useEffect } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, ArrowLeft, Loader2, SlidersHorizontal, GripVertical, Copy } from 'lucide-react'
import { curriculumApi } from '../api/client'
import { Modal } from './UI'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const emptyComponent = () => ({ name: '', weight: '', sort_order: 0 })
const emptyCategory  = () => ({ name: '', weight: '', sort_order: 0, components: [], expanded: true })

export default function GradingConfigModal({ open, onClose, subject, onSaved }) {
  const [categories, setCategories] = useState([])
  const [loading, setLoading]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [dragIdx, setDragIdx]       = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const [gripHeld, setGripHeld]     = useState(false)
  const [compsWithScores, setCompsWithScores] = useState(new Set())
  const [showCopy, setShowCopy]     = useState(false)
  const [copySubjects, setCopySubjects] = useState([])
  const [loadingCopy, setLoadingCopy] = useState(false)
  const [copyFilter, setCopyFilter] = useState('')

  // MAPEH has no weights of its own — its grade is the average of its areas, and
  // each area carries a full Written Work / Performance Task / Assessment tree.
  // So for a composite subject this modal opens on a picker and then edits one
  // area at a time; `target` is whichever subject the editor below is pointed at.
  const areas = subject?.areas || []
  const isComposite = areas.length > 0
  const [activeArea, setActiveArea] = useState(null)
  const [areaConfigured, setAreaConfigured] = useState({})
  const target = activeArea || subject

  // Reopening on a different subject must never inherit the last one's area.
  // `areaConfigured` is tracked here rather than re-read from the server so the
  // picker's chips update the moment an area is saved, without a round trip.
  useEffect(() => {
    setActiveArea(null)
    setShowCopy(false)
    setAreaConfigured(Object.fromEntries(
      (subject?.areas || []).map(a => [a.id, !!a.has_grading])))
  }, [open, subject?.id])

  // Load existing grading structure + scores check
  useEffect(() => {
    if (!open || !target) return
    // The picker has nothing to load: a composite subject has no structure.
    if (isComposite && !activeArea) { setCategories([]); setCompsWithScores(new Set()); return }
    setLoading(true)
    Promise.all([
      curriculumApi.getGrading(target.id),
      curriculumApi.checkGradingScores(target.id),
    ])
      .then(([gradingRes, scoresRes]) => {
        const cats = gradingRes.data.categories || []
        const cleanWeight = (w) => { const v = parseFloat(w); return v % 1 === 0 ? String(v) : String(parseFloat(v.toFixed(2))) }
        if (cats.length > 0) {
          setCategories(cats.map(c => ({
            ...c,
            weight: cleanWeight(c.weight),
            expanded: true,
            components: (c.components || []).map(comp => ({ ...comp, weight: cleanWeight(comp.weight) })),
          })))
        } else {
          setCategories([])
        }
        setCompsWithScores(new Set(scoresRes.data.components_with_scores || []))
      })
      .catch(() => { setCategories([]); setCompsWithScores(new Set()) })
      .finally(() => setLoading(false))
  }, [open, target?.id])

  const compHasScores = (compId) => compsWithScores.has(compId)
  const categoryHasScores = (cat) => (cat.components || []).some(c => c.id && compHasScores(c.id))

  // ── Category helpers ─────────────────────────────────────
  const addCategory = () => {
    setCategories(prev => [...prev, { ...emptyCategory(), sort_order: prev.length }])
  }

  const clampWeight = (val) => {
    if (val === '') return ''
    const n = parseFloat(val)
    if (isNaN(n) || n < 0) return '0'
    return val
  }

  const updateCategory = (idx, field, val) => {
    const v = field === 'name' ? val.toUpperCase() : field === 'weight' ? clampWeight(val) : val
    setCategories(prev => prev.map((c, i) => i === idx ? { ...c, [field]: v } : c))
  }

  const removeCategory = (idx) => {
    const cat = categories[idx]
    if (categoryHasScores(cat)) {
      return toast.error(`Cannot remove "${cat.name}" — it has components with recorded student scores. Clear scores in Score Entry first.`)
    }
    if (cat.name.trim() && !window.confirm(`Remove category "${cat.name}"?`)) return
    setCategories(prev => prev.filter((_, i) => i !== idx))
  }

  const toggleCategory = (idx) => {
    setCategories(prev => prev.map((c, i) => i === idx ? { ...c, expanded: !c.expanded } : c))
  }

  // ── Drag-and-drop reorder ────────────────────────────────
  const handleDragStart = (idx) => (e) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (idx) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (idx !== dragOverIdx) setDragOverIdx(idx)
  }
  const handleDrop = (idx) => (e) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    setCategories(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setDragIdx(null)
    setDragOverIdx(null)
  }
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); setGripHeld(false) }

  // ── Component helpers ────────────────────────────────────
  const addComponent = (catIdx) => {
    setCategories(prev => prev.map((c, i) =>
      i === catIdx ? { ...c, components: [...c.components, { ...emptyComponent(), sort_order: c.components.length }] } : c
    ))
  }

  const ucFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1)

  const updateComponent = (catIdx, compIdx, field, val) => {
    const v = field === 'name' ? ucFirst(val) : field === 'weight' ? clampWeight(val) : val
    setCategories(prev => prev.map((c, i) =>
      i === catIdx ? {
        ...c,
        components: c.components.map((comp, j) => j === compIdx ? { ...comp, [field]: v } : comp)
      } : c
    ))
  }

  const removeComponent = (catIdx, compIdx) => {
    const comp = categories[catIdx].components[compIdx]
    if (comp.id && compHasScores(comp.id)) {
      return toast.error(`Cannot remove "${comp.name}" — it has recorded student scores. Clear scores in Score Entry first.`)
    }
    if (comp.name.trim() && !window.confirm(`Remove component "${comp.name}"?`)) return
    setCategories(prev => prev.map((c, i) =>
      i === catIdx ? { ...c, components: c.components.filter((_, j) => j !== compIdx) } : c
    ))
  }

  // ── Validation ───────────────────────────────────────────
  const catTotal = categories.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0)
  const catTotalValid = Math.abs(catTotal - 100) < 0.01
  const allNamed = categories.every(c => c.name.trim() && c.components.every(comp => comp.name.trim()))
  const allWeighted = categories.every(c => parseFloat(c.weight) > 0 && c.components.every(comp => parseFloat(comp.weight) > 0))

  const getCompTotal = (cat) => cat.components.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0)
  const compTotalValid = (cat) => {
    if (cat.components.length === 0) return true
    return Math.abs(getCompTotal(cat) - (parseFloat(cat.weight) || 0)) < 0.01
  }
  const allCompValid = categories.every(compTotalValid)

  const canSave = categories.length > 0 && catTotalValid && allNamed && allWeighted && allCompValid

  const fmtWeight = (n) => { const v = parseFloat(n); return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1) }

  // ── Save ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        categories: categories.map((c, i) => ({
          ...(c.id ? { id: c.id } : {}),
          name: c.name.trim(),
          weight: parseFloat(c.weight),
          sort_order: i,
          components: c.components.map((comp, j) => ({
            ...(comp.id ? { id: comp.id } : {}),
            name: comp.name.trim(),
            weight: parseFloat(comp.weight),
            sort_order: j,
          })),
        }))
      }
      await curriculumApi.saveGrading(target.id, payload)
      toast.success('Grading structure saved.')
      onSaved?.()
      // An area saved sends you back to the picker rather than closing, because
      // MAPEH needs all four before it can produce a grade at all — finishing
      // one is the middle of the job, not the end of it.
      if (isComposite) {
        setAreaConfigured(prev => ({ ...prev, [target.id]: true }))
        setActiveArea(null)
      } else {
        onClose()
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save grading structure.')
    } finally { setSaving(false) }
  }

  // ── Clear ────────────────────────────────────────────────
  const handleClear = async () => {
    if (compsWithScores.size > 0) {
      return toast.error('Cannot clear — some components have recorded student scores. Clear scores in Score Entry first.')
    }
    if (!window.confirm('Remove all grading structure for this subject?')) return
    setSaving(true)
    try {
      await curriculumApi.clearGrading(target.id)
      toast.success('Grading structure cleared.')
      setCategories([])
      if (isComposite) setAreaConfigured(prev => ({ ...prev, [target.id]: false }))
      onSaved?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to clear.')
    } finally { setSaving(false) }
  }

  // ── Copy from another subject ─────────────────────────────
  const openCopyPicker = async () => {
    setShowCopy(true)
    setCopyFilter('')
    setLoadingCopy(true)
    try {
      const res = await curriculumApi.getSubjects({ sy_id: target.school_year_id, include_areas: true })
      const list = (res.data.subjects || [])
        .filter(s => s.id !== target.id && !s.area_count)
      setCopySubjects(list)
    } catch { setCopySubjects([]) }
    setLoadingCopy(false)
  }

  const copyFrom = async (sourceId) => {
    setLoadingCopy(true)
    try {
      const res = await curriculumApi.getGrading(sourceId)
      const cats = res.data.categories || []
      if (cats.length === 0) {
        toast.error('Selected subject has no grading structure.')
        setLoadingCopy(false)
        return
      }
      const cleanWeight = (w) => { const v = parseFloat(w); return v % 1 === 0 ? String(v) : String(parseFloat(v.toFixed(2))) }
      setCategories(cats.map(c => ({
        name: c.name,
        weight: cleanWeight(c.weight),
        sort_order: c.sort_order,
        expanded: true,
        components: (c.components || []).map(comp => ({
          name: comp.name,
          weight: cleanWeight(comp.weight),
          sort_order: comp.sort_order,
        })),
      })))
      toast.success('Grading structure copied.')
      setShowCopy(false)
    } catch {
      toast.error('Failed to copy grading structure.')
    }
    setLoadingCopy(false)
  }

  if (!subject) return null

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={`Grading Structure \u2014 ${activeArea ? `${subject.name} \u203A ${activeArea.name}` : subject.name}`}>
      {isComposite && !activeArea ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Pick the area to configure.
          </p>
          <div className="space-y-2">
            {areas.map(a => (
              <button key={a.id} type="button" onClick={() => setActiveArea(a)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/40 transition-colors text-left">
                <span className="flex items-center gap-2 min-w-0">
                  <SlidersHorizontal size={14} className="flex-shrink-0 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700 truncate">{a.name}</span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className={clsx('text-[11px] font-medium px-2 py-0.5 rounded-full',
                    areaConfigured[a.id] ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400')}>
                    {areaConfigured[a.id] ? 'Configured' : 'Not set up'}
                  </span>
                  <ChevronRight size={15} className="text-slate-300" />
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            {subject.name} has no grade for a period until all {areas.length} areas have one, so each
            needs a structure before Score Entry can be used for it.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-brand-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top-left way back to the area list. Only a composite subject has
              one — an ordinary subject opens straight into its own structure. */}
          {isComposite && (
            <button type="button" onClick={() => setActiveArea(null)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-brand-600 transition-colors">
              <ArrowLeft size={14} /> All {subject.name} areas
            </button>
          )}
          {/* Validation summary */}
          <div className={clsx(
            'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium',
            categories.length === 0 ? 'bg-slate-50 text-slate-400'
              : catTotalValid ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-600'
          )}>
            <span>Category total: {fmtWeight(catTotal)}% / 100%</span>
            {categories.length > 0 && catTotalValid && allCompValid && (
              <span className="text-emerald-600">Valid</span>
            )}
          </div>

          {/* Copy from another subject */}
          {showCopy && (() => {
            const gradeLevels = [...new Set(copySubjects.map(s => s.grade_level))].sort()
            const filtered = copySubjects.filter(s =>
              (!copyFilter || s.grade_level === copyFilter)
            )
            return (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Copy structure from</p>
                <button type="button" onClick={() => setShowCopy(false)}
                  className="text-xs text-blue-500 hover:text-blue-700 font-medium">Cancel</button>
              </div>
              {loadingCopy ? (
                <div className="flex justify-center py-3"><Loader2 size={18} className="animate-spin text-blue-400" /></div>
              ) : copySubjects.length === 0 ? (
                <p className="text-xs text-blue-400 text-center py-2">No other subjects found in this school year.</p>
              ) : (
                <>
                  <select className="input text-sm py-1.5" value={copyFilter} onChange={e => setCopyFilter(e.target.value)}>
                    <option value="">All Grade Levels</option>
                    {gradeLevels.map(gl => <option key={gl} value={gl}>{gl}</option>)}
                  </select>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filtered.length === 0 ? (
                      <p className="text-xs text-blue-400 text-center py-2">No subjects found for this grade level.</p>
                    ) : filtered.map(s => (
                      <button key={s.id} type="button" onClick={() => copyFrom(s.id)}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-blue-100 transition-colors">
                        <span className="font-medium">
                          {s.parent_name ? `${s.parent_name} — ${s.name}` : s.name}
                        </span>
                        <span className="text-xs text-slate-400 ml-2">{s.grade_level}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            )
          })()}

          {/* Categories list */}
          {categories.length === 0 && !showCopy && (
            <div className="text-center py-8">
              <SlidersHorizontal size={28} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 font-medium">No grading structure configured</p>
              <p className="text-xs text-slate-400 mt-1">Add categories to define how grades are weighted.</p>
            </div>
          )}

          <div className="space-y-3">
            {categories.map((cat, catIdx) => {
              const compTotal = getCompTotal(cat)
              const catWeight = parseFloat(cat.weight) || 0
              const compValid = compTotalValid(cat)

              return (
                <div key={catIdx}
                  draggable={gripHeld}
                  onDragStart={handleDragStart(catIdx)}
                  onDragOver={handleDragOver(catIdx)}
                  onDrop={handleDrop(catIdx)}
                  onDragEnd={handleDragEnd}
                  className={clsx(
                    'border rounded-xl overflow-hidden transition-all',
                    dragIdx === catIdx ? 'opacity-40 border-brand-300 bg-brand-50/30'
                      : dragOverIdx === catIdx && dragIdx !== null ? 'border-brand-400 ring-2 ring-brand-200'
                      : 'border-slate-200'
                  )}>
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50">
                    <div className="cursor-grab active:cursor-grabbing p-0.5 text-slate-300 hover:text-slate-500 flex-shrink-0 select-none"
                      onMouseDown={() => setGripHeld(true)}
                      onMouseUp={() => setGripHeld(false)}>
                      <GripVertical size={14} />
                    </div>
                    <button type="button" onClick={() => toggleCategory(catIdx)}
                      className="p-0.5 text-slate-400 hover:text-slate-600">
                      {cat.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <input
                      className="flex-1 text-sm font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-300"
                      placeholder="Category name (e.g. Written Tasks)"
                      value={cat.name}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      onChange={e => updateCategory(catIdx, 'name', e.target.value)}
                    />
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input
                        type="number" min="0" max="100" step="0.01"
                        className={clsx('w-14 text-sm font-mono text-center bg-white border rounded-lg px-1.5 py-1 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                          catTotal > 100.01 ? 'border-red-400 text-red-600 focus:border-red-500' : 'border-slate-200 focus:border-brand-400'
                        )}
                        placeholder="0"
                        value={cat.weight}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                        onChange={e => updateCategory(catIdx, 'weight', e.target.value)}
                      />
                      <span className="text-xs text-slate-400 font-medium">%</span>
                    </div>
                    <button type="button" onClick={() => removeCategory(catIdx)}
                      className={clsx('p-1.5 rounded-lg transition-colors', categoryHasScores(cat) ? 'text-slate-200 cursor-not-allowed' : 'text-slate-300 hover:text-red-500 hover:bg-red-50')}
                      title={categoryHasScores(cat) ? 'Has recorded scores' : 'Remove category'}>
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {/* Components list */}
                  {cat.expanded && (
                    <div className="px-3 py-2 space-y-1.5 bg-white">
                      {cat.components.length > 0 && (
                        <div className={clsx(
                          'flex items-center justify-between px-2 py-1 rounded text-[11px] font-medium',
                          cat.components.length === 0 ? 'hidden'
                            : compValid ? 'bg-emerald-50/50 text-emerald-600'
                            : 'bg-red-50/50 text-red-500'
                        )}>
                          <span>Components: {fmtWeight(compTotal)}% / {fmtWeight(catWeight)}%</span>
                        </div>
                      )}

                      {cat.components.map((comp, compIdx) => (
                        <div key={compIdx} className="flex items-center gap-2 pl-5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                          <input
                            className="flex-1 text-sm text-slate-700 bg-transparent outline-none placeholder:text-slate-300"
                            placeholder="Component name (e.g. Quizzes)"
                            value={comp.name}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            onChange={e => updateComponent(catIdx, compIdx, 'name', e.target.value)}
                          />
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <input
                              type="number" min="0" max="100" step="0.01"
                              className={clsx('w-14 text-sm font-mono text-center bg-white border rounded-lg px-1.5 py-1 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                                compTotal > catWeight + 0.01 ? 'border-red-400 text-red-600 focus:border-red-500' : 'border-slate-200 focus:border-brand-400'
                              )}
                              placeholder="0"
                              value={comp.weight}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                              onChange={e => updateComponent(catIdx, compIdx, 'weight', e.target.value)}
                            />
                            <span className="text-xs text-slate-400 font-medium">%</span>
                          </div>
                          <button type="button" onClick={() => removeComponent(catIdx, compIdx)}
                            className={clsx('p-1 rounded transition-colors', comp.id && compHasScores(comp.id) ? 'text-slate-200 cursor-not-allowed' : 'text-slate-300 hover:text-red-500 hover:bg-red-50')}
                            title={comp.id && compHasScores(comp.id) ? 'Has recorded scores' : 'Remove component'}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}

                      <button type="button" onClick={() => addComponent(catIdx)}
                        className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 pl-5 py-1.5 hover:bg-brand-50 rounded transition-colors">
                        <Plus size={12} /> Add Component
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add Category + Copy from buttons */}
          <div className="flex gap-2">
            <button type="button" onClick={addCategory}
              className="flex items-center gap-2 flex-1 justify-center py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm font-medium text-slate-500 hover:text-brand-600 hover:border-brand-300 transition-colors">
              <Plus size={15} /> Add Category
            </button>
            {!showCopy && (
              <button type="button" onClick={openCopyPicker}
                className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm font-medium text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-colors">
                <Copy size={15} /> Copy from
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
            {categories.length > 0 && (
              <button type="button" onClick={handleClear} disabled={saving}
                className={clsx('text-xs font-medium px-3 py-2 rounded-lg border transition-colors',
                  compsWithScores.size > 0
                    ? 'text-slate-300 border-slate-200 cursor-not-allowed'
                    : 'text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200'
                )}
                title={compsWithScores.size > 0 ? 'Some components have recorded scores' : 'Clear all grading structure'}>
                Clear All
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose}
                className="btn-secondary px-4 py-2 text-sm">Cancel</button>
              <button type="button" onClick={handleSave}
                disabled={saving || !canSave}
                className="btn-primary px-4 py-2 text-sm justify-center disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Structure'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

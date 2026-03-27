import { useState, useEffect } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2, SlidersHorizontal } from 'lucide-react'
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

  // Load existing grading structure
  useEffect(() => {
    if (!open || !subject) return
    setLoading(true)
    curriculumApi.getGrading(subject.id)
      .then(res => {
        const cats = res.data.categories || []
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
      })
      .catch(() => setCategories([]))
      .finally(() => setLoading(false))
  }, [open, subject])

  // ── Category helpers ─────────────────────────────────────
  const addCategory = () => {
    setCategories(prev => [...prev, { ...emptyCategory(), sort_order: prev.length }])
  }

  const updateCategory = (idx, field, val) => {
    setCategories(prev => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c))
  }

  const removeCategory = (idx) => {
    setCategories(prev => prev.filter((_, i) => i !== idx))
  }

  const toggleCategory = (idx) => {
    setCategories(prev => prev.map((c, i) => i === idx ? { ...c, expanded: !c.expanded } : c))
  }

  // ── Component helpers ────────────────────────────────────
  const addComponent = (catIdx) => {
    setCategories(prev => prev.map((c, i) =>
      i === catIdx ? { ...c, components: [...c.components, { ...emptyComponent(), sort_order: c.components.length }] } : c
    ))
  }

  const updateComponent = (catIdx, compIdx, field, val) => {
    setCategories(prev => prev.map((c, i) =>
      i === catIdx ? {
        ...c,
        components: c.components.map((comp, j) => j === compIdx ? { ...comp, [field]: val } : comp)
      } : c
    ))
  }

  const removeComponent = (catIdx, compIdx) => {
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
          name: c.name.trim(),
          weight: parseFloat(c.weight),
          sort_order: i,
          components: c.components.map((comp, j) => ({
            name: comp.name.trim(),
            weight: parseFloat(comp.weight),
            sort_order: j,
          })),
        }))
      }
      await curriculumApi.saveGrading(subject.id, payload)
      toast.success('Grading structure saved.')
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save grading structure.')
    } finally { setSaving(false) }
  }

  // ── Clear ────────────────────────────────────────────────
  const handleClear = async () => {
    if (!window.confirm('Remove all grading structure for this subject?')) return
    setSaving(true)
    try {
      await curriculumApi.clearGrading(subject.id)
      toast.success('Grading structure cleared.')
      setCategories([])
      onSaved?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to clear.')
    } finally { setSaving(false) }
  }

  if (!subject) return null

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={`Grading Structure \u2014 ${subject.name}`}>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-teal-500" />
        </div>
      ) : (
        <div className="space-y-4">
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

          {/* Categories list */}
          {categories.length === 0 && (
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
                <div key={catIdx} className="border border-slate-200 rounded-xl overflow-hidden">
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50">
                    <button type="button" onClick={() => toggleCategory(catIdx)}
                      className="p-0.5 text-slate-400 hover:text-slate-600">
                      {cat.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <input
                      className="flex-1 text-sm font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-300"
                      placeholder="Category name (e.g. Written Tasks)"
                      value={cat.name}
                      onChange={e => updateCategory(catIdx, 'name', e.target.value)}
                    />
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input
                        type="number" min="0.01" max="100" step="0.01"
                        className="w-14 text-sm font-mono text-center bg-white border border-slate-200 rounded-lg px-1.5 py-1 outline-none focus:border-teal-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        placeholder="0"
                        value={cat.weight}
                        onChange={e => updateCategory(catIdx, 'weight', e.target.value)}
                      />
                      <span className="text-xs text-slate-400 font-medium">%</span>
                    </div>
                    <button type="button" onClick={() => removeCategory(catIdx)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
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
                            onChange={e => updateComponent(catIdx, compIdx, 'name', e.target.value)}
                          />
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <input
                              type="number" min="0.01" max="100" step="0.01"
                              className="w-14 text-sm font-mono text-center bg-white border border-slate-200 rounded-lg px-1.5 py-1 outline-none focus:border-teal-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              placeholder="0"
                              value={comp.weight}
                              onChange={e => updateComponent(catIdx, compIdx, 'weight', e.target.value)}
                            />
                            <span className="text-xs text-slate-400 font-medium">%</span>
                          </div>
                          <button type="button" onClick={() => removeComponent(catIdx, compIdx)}
                            className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}

                      <button type="button" onClick={() => addComponent(catIdx)}
                        className="flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 pl-5 py-1.5 hover:bg-teal-50 rounded transition-colors">
                        <Plus size={12} /> Add Component
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add Category button */}
          <button type="button" onClick={addCategory}
            className="flex items-center gap-2 w-full justify-center py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm font-medium text-slate-500 hover:text-teal-600 hover:border-teal-300 transition-colors">
            <Plus size={15} /> Add Category
          </button>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
            {categories.length > 0 && (
              <button type="button" onClick={handleClear} disabled={saving}
                className="text-xs font-medium text-red-500 hover:text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 border border-red-200 transition-colors">
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

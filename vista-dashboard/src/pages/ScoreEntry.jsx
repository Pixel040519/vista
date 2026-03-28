import { useState, useEffect, useReducer, useCallback, useRef } from 'react'
import { curriculumApi, scoreApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'
import { formatName } from '../utils/nameHelper'
import { useAuth } from '../context/AuthContext'
import {
  PenLine, ChevronDown, ChevronRight, Plus, Trash2, Save,
  Settings, Loader2, ClipboardList, GripVertical, Filter
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const GRADE_LEVELS = ['Pre-Nursery','Nursery','Pre-Kinder','Kinder',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']
const QUARTERS = [1, 2, 3, 4]

// ── Score reducer ──────────────────────────────────────────
// State: { [score_item_id]: { [student_id]: number|null } }
function scoreReducer(state, action) {
  switch (action.type) {
    case 'LOAD':
      return action.payload
    case 'SET': {
      const { itemId, studentId, value } = action
      return {
        ...state,
        [itemId]: { ...(state[itemId] || {}), [studentId]: value }
      }
    }
    case 'RESET':
      return {}
    default:
      return state
  }
}

const STORAGE_KEY = 'vista_score_entry_filters'
const getSaved = () => { try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {} } catch { return {} } }

function usePersistedFilter(key, fallback = '') {
  const [val, setVal] = useState(() => getSaved()[key] || fallback)
  useEffect(() => {
    const cur = getSaved()
    cur[key] = val
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cur))
  }, [key, val])
  return [val, setVal]
}

export default function ScoreEntry() {
  const { user } = useAuth()

  // ── Filter state (persisted in sessionStorage) ────────────
  const [syId, setSyId]             = usePersistedFilter('syId')
  const [gradeLevel, setGradeLevel] = usePersistedFilter('gradeLevel')
  const [section, setSection]       = usePersistedFilter('section')
  const [subjectId, setSubjectId]   = usePersistedFilter('subjectId')
  const [quarter, setQuarter]       = usePersistedFilter('quarter')

  const [schoolYears, setSchoolYears] = useState([])
  const [sections, setSections]       = useState([])
  const [subjects, setSubjects]       = useState([])

  // ── Data state ────────────────────────────────────────────
  const [categories, setCategories]       = useState([])
  const [students, setStudents]           = useState([])
  const [scores, dispatch]                = useReducer(scoreReducer, {})
  const [originalScores, setOriginalScores] = useState({})
  const [loading, setLoading]             = useState(false)
  const [saving, setSaving]               = useState(false)
  const [expandedComps, setExpandedComps] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('vista_score_entry_expanded')) || []) } catch { return new Set() }
  })

  // ── Score item manager state ──────────────────────────────
  const [editingComp, setEditingComp]     = useState(null) // { comp, subjectId }
  const [editItems, setEditItems]         = useState([])
  const [savingItems, setSavingItems]     = useState(false)
  const [itemDragIdx, setItemDragIdx]     = useState(null)
  const [itemDragOverIdx, setItemDragOverIdx] = useState(null)
  const [itemGripHeld, setItemGripHeld]   = useState(false)

  // All filters selected?
  const filtersReady = syId && gradeLevel && section && subjectId && quarter

  // ── Load school years on mount ────────────────────────────
  useEffect(() => {
    curriculumApi.getSchoolYears().then(res => {
      const syList = res.data.school_years || res.data
      setSchoolYears(syList)
      if (!syId) {
        const active = syList.find(sy => sy.is_active)
        if (active) setSyId(active.id)
      }
    }).catch(() => {})
  }, [])

  // ── Load sections when grade_level or sy changes ──────────
  useEffect(() => {
    if (!syId || !gradeLevel) { setSections([]); return }
    curriculumApi.getSections({ sy_id: syId, grade_level: gradeLevel })
      .then(res => {
        const list = res.data.sections || []
        setSections(list)
        if (section && !list.find(s => s.name === section)) setSection('')
      })
      .catch(() => setSections([]))
  }, [syId, gradeLevel])

  // ── Load subjects when grade_level or sy changes ──────────
  useEffect(() => {
    if (!syId || !gradeLevel) { setSubjects([]); return }
    curriculumApi.getSubjects({ sy_id: syId, grade_level: gradeLevel })
      .then(res => {
        const list = res.data.subjects || []
        setSubjects(list)
        if (subjectId && !list.find(s => s.id === subjectId)) setSubjectId('')
      })
      .catch(() => setSubjects([]))
  }, [syId, gradeLevel])

  // ── Load data when all filters are set ────────────────────
  const loadData = useCallback(async () => {
    if (!filtersReady) return
    setLoading(true)
    try {
      const [itemsRes, scoresRes] = await Promise.all([
        scoreApi.getItems({ subject_id: subjectId, quarter }),
        scoreApi.getScores({ subject_id: subjectId, quarter, grade_level: gradeLevel, section }),
      ])
      setCategories(itemsRes.data.categories || [])
      setStudents(scoresRes.data.students || [])

      // Build scores lookup
      const lookup = {}
      for (const s of (scoresRes.data.scores || [])) {
        if (!lookup[s.score_item_id]) lookup[s.score_item_id] = {}
        lookup[s.score_item_id][s.student_id] = s.score !== null ? parseFloat(s.score) : null
      }
      dispatch({ type: 'LOAD', payload: lookup })
      setOriginalScores(JSON.parse(JSON.stringify(lookup)))

      // Preserve expanded state from sessionStorage; don't reset
    } catch { }
    setLoading(false)
  }, [filtersReady, subjectId, quarter, gradeLevel, section])

  useEffect(() => { loadData() }, [loadData])

  // ── Toggle component expand ───────────────────────────────
  const toggleComp = (compId) => {
    setExpandedComps(prev => {
      const next = new Set(prev)
      next.has(compId) ? next.delete(compId) : next.add(compId)
      sessionStorage.setItem('vista_score_entry_expanded', JSON.stringify([...next]))
      return next
    })
  }

  // ── Compute T, PS, WS for a component and student ────────
  const computeComponentStats = (items, studentId) => {
    let total = 0, hpsTotal = 0
    for (const item of items) {
      const val = scores[item.id]?.[studentId]
      total += (val != null ? val : 0)
      hpsTotal += parseFloat(item.highest_possible_score)
    }
    const ps = hpsTotal > 0 ? (total / hpsTotal) * 100 : 0
    return { total, hpsTotal, ps }
  }

  const computeWS = (ps, weight) => ps * (parseFloat(weight) / 100)

  // ── Compute summary for a student ─────────────────────────
  const computeStudentGrade = (studentId) => {
    let initialGrade = 0
    for (const cat of categories) {
      for (const comp of cat.components) {
        const items = comp.items || []
        if (!items.length) continue
        const { ps } = computeComponentStats(items, studentId)
        initialGrade += computeWS(ps, comp.weight)
      }
    }
    return Math.round(initialGrade * 100) / 100
  }

  // ── Handle score input ────────────────────────────────────
  const handleScoreChange = (itemId, studentId, value) => {
    const num = value === '' ? null : Math.floor(Number(value))
    dispatch({ type: 'SET', itemId, studentId, value: num })
  }

  // ── Save scores ───────────────────────────────────────────
  const handleSave = async () => {
    // Collect all changed scores
    const changedScores = []
    for (const cat of categories) {
      for (const comp of cat.components) {
        for (const item of (comp.items || [])) {
          for (const student of students) {
            const current = scores[item.id]?.[student.id] ?? null
            const original = originalScores[item.id]?.[student.id] ?? null
            if (current !== original) {
              changedScores.push({
                score_item_id: item.id,
                student_id: student.id,
                score: current,
              })
            }
          }
        }
      }
    }
    if (!changedScores.length) return toast('No changes to save.')

    setSaving(true)
    try {
      await scoreApi.saveScores({
        subject_id: subjectId,
        quarter: parseInt(quarter),
        grade_level: gradeLevel,
        section,
        sy_id: syId,
        scores: changedScores,
      })
      toast.success(`${changedScores.length} score(s) saved.`)
      setOriginalScores(JSON.parse(JSON.stringify(scores)))
    } catch { }
    setSaving(false)
  }

  // ── Score item manager ────────────────────────────────────
  const openItemManager = (comp) => {
    setEditingComp(comp)
    setEditItems(
      (comp.items || []).map(i => ({
        id: i.id,
        name: i.name,
        highest_possible_score: Math.floor(i.highest_possible_score),
        sort_order: i.sort_order,
      }))
    )
  }

  const itemHasScores = (item) => {
    if (!item.id) return false
    const itemScores = scores[item.id]
    if (!itemScores) return false
    return Object.values(itemScores).some(v => v != null)
  }

  const addEditItem = () => {
    setEditItems(prev => [...prev, { name: '', highest_possible_score: '', sort_order: prev.length }])
  }

  const updateEditItem = (idx, field, val) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item))
  }

  const removeEditItem = (idx) => {
    const item = editItems[idx]
    if (itemHasScores(item)) {
      return toast.error(`"${item.name}" has recorded student scores and cannot be removed.`)
    }
    setEditItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleItemDragStart = (idx) => (e) => {
    setItemDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleItemDragOver = (idx) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (idx !== itemDragOverIdx) setItemDragOverIdx(idx)
  }
  const handleItemDrop = (idx) => (e) => {
    e.preventDefault()
    if (itemDragIdx === null || itemDragIdx === idx) { setItemDragIdx(null); setItemDragOverIdx(null); return }
    setEditItems(prev => {
      const next = [...prev]
      const [moved] = next.splice(itemDragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setItemDragIdx(null)
    setItemDragOverIdx(null)
  }
  const handleItemDragEnd = () => { setItemDragIdx(null); setItemDragOverIdx(null); setItemGripHeld(false) }

  const getHighestScore = (itemId) => {
    const itemScores = scores[itemId]
    if (!itemScores) return 0
    return Math.max(0, ...Object.values(itemScores).filter(v => v != null))
  }

  const saveEditItems = async () => {
    const items = editItems
      .filter(i => i.name.trim() && i.highest_possible_score)
      .map((i, idx) => ({
        ...(i.id ? { id: i.id } : {}),
        name: i.name.trim(),
        highest_possible_score: Math.floor(Number(i.highest_possible_score)),
        sort_order: idx,
      }))
    // Check if any existing item's new HPS is lower than the highest recorded score
    for (const item of items) {
      if (!item.id) continue
      const highest = getHighestScore(item.id)
      if (highest > item.highest_possible_score) {
        return toast.error(`"${item.name}" has a recorded score of ${highest}, which exceeds the new HPS of ${item.highest_possible_score}.`)
      }
    }

    setSavingItems(true)
    try {
      await scoreApi.saveItems({
        component_id: editingComp.id,
        subject_id: subjectId,
        quarter: parseInt(quarter),
        items,
      })
      toast.success('Score items saved.')
      setEditingComp(null)
      loadData()
    } catch { }
    setSavingItems(false)
  }

  // ── Check if there are unsaved changes ────────────────────
  const hasChanges = () => {
    for (const cat of categories) {
      for (const comp of cat.components) {
        for (const item of (comp.items || [])) {
          for (const student of students) {
            const current = scores[item.id]?.[student.id] ?? null
            const original = originalScores[item.id]?.[student.id] ?? null
            if (current !== original) return true
          }
        }
      }
    }
    return false
  }

  // ── Subject name lookup ───────────────────────────────────
  const subjectName = subjects.find(s => s.id === subjectId)?.name || ''

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Score Entry</h1>
          <p className="page-subtitle">Enter component scores for students</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={15} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select className="input" value={syId} onChange={e => { setSyId(e.target.value); setSection(''); setSubjectId('') }}>
            <option value="">School Year</option>
            {schoolYears.map(sy => (
              <option key={sy.id} value={sy.id}>{sy.label}{sy.is_active ? ' (Active)' : ''}</option>
            ))}
          </select>

          <select className="input" value={gradeLevel} onChange={e => { setGradeLevel(e.target.value); setSection(''); setSubjectId('') }}>
            <option value="">Grade Level</option>
            {GRADE_LEVELS.map(gl => <option key={gl} value={gl}>{gl}</option>)}
          </select>

          <select className="input" value={section} onChange={e => setSection(e.target.value)} disabled={!sections.length}>
            <option value="">Section</option>
            {sections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>

          <select className="input" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={!subjects.length}>
            <option value="">Subject</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <select className="input" value={quarter} onChange={e => setQuarter(e.target.value)}>
            <option value="">Quarter</option>
            {QUARTERS.map(q => <option key={q} value={q}>Quarter {q}</option>)}
          </select>
        </div>
      </div>

      {/* Content */}
      {!filtersReady ? (
        <EmptyState icon={PenLine} title="Select Filters" message="Choose school year, grade level, section, subject, and quarter to begin." />
      ) : loading ? (
        <LoadingSpinner />
      ) : !categories.length ? (
        <EmptyState icon={ClipboardList} title="No Grading Structure" message="Configure a grading structure for this subject in Curriculum Management first." />
      ) : !students.length ? (
        <EmptyState icon={PenLine} title="No Students" message="No students found in this section." />
      ) : (
        <div className="space-y-4">
          {categories.map(cat => (
            <div key={cat.id} className="space-y-3">
              {/* Category header */}
              <div className="flex items-center gap-2 px-1">
                <div className="w-2 h-2 rounded-full bg-teal-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                  {cat.name} <span className="text-teal-600">{cat.weight}%</span>
                </h2>
              </div>

              {/* Components under this category */}
              {cat.components.map(comp => {
                const items = comp.items || []
                const isExpanded = expandedComps.has(comp.id)

                return (
                  <div key={comp.id} className="card overflow-hidden border border-teal-200">
                    {/* Component header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 bg-teal-50/60 cursor-pointer select-none"
                      onClick={() => toggleComp(comp.id)}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                        <span className="text-sm font-semibold text-slate-700">{comp.name}</span>
                        <span className="text-xs text-slate-400 font-medium">{comp.weight}%</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">
                          {items.length} item{items.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {isExpanded && items.length > 0 && (
                          <button
                            onClick={e => { e.stopPropagation(); handleSave() }}
                            disabled={saving || !hasChanges()}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 bg-teal-500 hover:bg-teal-600 text-white disabled:hover:bg-teal-500"
                          >
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            {saving ? 'Saving...' : 'Save Scores'}
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); openItemManager(comp) }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                          title="Manage score items"
                        >
                          <Settings size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Score grid */}
                    {isExpanded && (
                      items.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-slate-400">
                          No score items yet.
                          <button onClick={() => openItemManager(comp)} className="ml-1 text-teal-600 hover:underline">
                            Add items
                          </button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="table-base">
                            <thead>
                              <tr>
                                <th className="whitespace-nowrap sticky left-0 bg-white z-10">Student</th>
                                {items.map(item => (
                                  <th key={item.id} className="whitespace-nowrap text-center !px-1 !w-[72px]">
                                    <div className="flex justify-center items-center">{item.name}</div>
                                  </th>
                                ))}
                                <th className="whitespace-nowrap text-center !w-[56px] !px-1 bg-slate-50">
                                  <div className="flex justify-center items-center">T</div>
                                </th>
                                <th className="whitespace-nowrap text-center !w-[56px] !px-1 bg-slate-50">
                                  <div className="flex justify-center items-center">PS</div>
                                </th>
                                <th className="whitespace-nowrap text-center !w-[56px] !px-1 bg-slate-50">
                                  <div className="flex justify-center items-center">WS</div>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {students.map(student => {
                                const stats = computeComponentStats(items, student.id)
                                const ws = computeWS(stats.ps, comp.weight)
                                return (
                                  <tr key={student.id}>
                                    <td className="whitespace-nowrap sticky left-0 bg-white z-10">
                                      <div className="text-sm font-medium text-slate-700">{formatName(student)}</div>
                                      {student.lrn && <div className="text-[11px] text-slate-400">LRN: {student.lrn}</div>}
                                    </td>
                                    {items.map(item => {
                                      const val = scores[item.id]?.[student.id]
                                      return (
                                        <td key={item.id} className="text-center !px-1 py-1 !w-[72px]">
                                          <input
                                            type="number"
                                            min="0"
                                            max={item.highest_possible_score}
                                            step="1"
                                            value={val != null ? val : ''}
                                            onKeyDown={e => { if (e.key === '.' || e.key === 'e') e.preventDefault(); if (e.key === 'Enter') e.target.blur() }}
                                            onChange={e => handleScoreChange(item.id, student.id, e.target.value)}
                                            className={clsx(
                                              'w-[62px] px-1 py-1 text-center text-sm rounded-lg border transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                                              'focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-teal-400',
                                              val != null && val > parseFloat(item.highest_possible_score)
                                                ? 'border-red-300 bg-red-50 text-red-700'
                                                : 'border-slate-200 bg-white text-slate-700'
                                            )}
                                          />
                                        </td>
                                      )
                                    })}
                                    <td className="text-center text-sm font-medium text-slate-600 bg-slate-50/50 !w-[56px] !px-1">{stats.total}</td>
                                    <td className="text-center text-sm font-medium text-slate-600 bg-slate-50/50 !w-[56px] !px-1">{stats.ps.toFixed(2)}</td>
                                    <td className="text-center text-sm font-semibold text-teal-700 bg-slate-50/50 !w-[56px] !px-1">{ws.toFixed(2)}</td>
                                  </tr>
                                )
                              })}
                              {/* HPS row */}
                              <tr className="bg-slate-100 border-t-2 border-slate-200">
                                <td className="sticky left-0 bg-slate-100 z-10 text-xs font-bold text-slate-600 uppercase">Highest Possible Score</td>
                                {items.map(item => (
                                  <td key={item.id} className="text-center text-sm font-semibold text-slate-600 !px-1">
                                    {Math.floor(item.highest_possible_score)}
                                  </td>
                                ))}
                                <td className="text-center text-sm font-semibold text-slate-600 !px-1">
                                  {Math.floor(items.reduce((s, i) => s + parseFloat(i.highest_possible_score), 0))}
                                </td>
                                <td className="text-center text-sm font-semibold text-slate-600 !px-1">100</td>
                                <td className="text-center text-sm font-semibold text-teal-700 !px-1">{comp.weight}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          {/* Grade Summary */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-700">Grade Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap sticky left-0 bg-white z-10 min-w-[180px]">Student</th>
                    {categories.map(cat => (
                      <th key={cat.id} className="whitespace-nowrap text-center">
                        <div>{cat.name}</div>
                        <div className="text-[10px] font-normal text-slate-400">{cat.weight}%</div>
                      </th>
                    ))}
                    <th className="whitespace-nowrap text-center bg-teal-50 text-teal-700">Initial</th>
                    <th className="whitespace-nowrap text-center bg-teal-50 text-teal-700">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map(student => {
                    const finalGrade = computeStudentGrade(student.id)
                    return (
                      <tr key={student.id}>
                        <td className="whitespace-nowrap sticky left-0 bg-white z-10">
                          <div className="text-sm font-medium text-slate-700">{formatName(student)}</div>
                          {student.lrn && <div className="text-[11px] text-slate-400">LRN: {student.lrn}</div>}
                        </td>
                        {categories.map(cat => {
                          let catWS = 0
                          for (const comp of cat.components) {
                            const items = comp.items || []
                            if (!items.length) continue
                            const { ps } = computeComponentStats(items, student.id)
                            catWS += computeWS(ps, comp.weight)
                          }
                          return (
                            <td key={cat.id} className="text-center text-sm font-medium text-slate-600">
                              {catWS.toFixed(2)}
                            </td>
                          )
                        })}
                        <td className="text-center text-sm font-bold text-teal-700 bg-teal-50/50">{finalGrade.toFixed(2)}</td>
                        <td className="text-center text-sm font-bold text-teal-700 bg-teal-50/50">{finalGrade.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Score Item Manager Modal */}
      {editingComp && (
        <Modal
          open
          onClose={() => setEditingComp(null)}
          title={`Score Items — ${editingComp.name}`}
          size="md"
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Define the individual assessments (e.g. Quiz 1, Quiz 2) and their highest possible scores for{' '}
              <strong>{subjectName}</strong> — Quarter {quarter}.
            </p>

            {editItems.map((item, idx) => (
              <div
                key={idx}
                draggable={itemGripHeld}
                onDragStart={handleItemDragStart(idx)}
                onDragOver={handleItemDragOver(idx)}
                onDrop={handleItemDrop(idx)}
                onDragEnd={handleItemDragEnd}
                className={clsx(
                  'flex items-center gap-2 rounded-lg transition-all',
                  itemDragIdx === idx ? 'opacity-40 bg-teal-50' : itemDragOverIdx === idx && itemDragIdx !== null ? 'ring-2 ring-teal-200' : ''
                )}
              >
                <div
                  className="cursor-grab active:cursor-grabbing p-0.5 text-slate-300 hover:text-slate-500 flex-shrink-0 select-none"
                  onMouseDown={() => setItemGripHeld(true)}
                  onMouseUp={() => setItemGripHeld(false)}
                >
                  <GripVertical size={14} />
                </div>
                <input
                  className="input flex-1"
                  placeholder="Item name (e.g. Quiz 1)"
                  value={item.name}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                  onChange={e => updateEditItem(idx, 'name', e.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="input w-24 text-center"
                  placeholder="HPS"
                  value={item.highest_possible_score}
                  onKeyDown={e => { if (e.key === '.' || e.key === 'e') e.preventDefault(); if (e.key === 'Enter') e.target.blur() }}
                  onChange={e => updateEditItem(idx, 'highest_possible_score', e.target.value)}
                />
                <button
                  onClick={() => removeEditItem(idx)}
                  className={clsx('p-2 transition-colors', itemHasScores(item) ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-red-500')}
                  title={itemHasScores(item) ? 'Has recorded scores' : 'Remove item'}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            <button
              onClick={addEditItem}
              className="w-full py-2 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 hover:text-teal-600 hover:border-teal-300 transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={14} /> Add Item
            </button>

            {editItems.length > 0 && (
              <div className="text-xs text-slate-500 text-right">
                Total HPS: <strong>
                  {Math.floor(editItems.reduce((s, i) => s + (parseFloat(i.highest_possible_score) || 0), 0))}
                </strong>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
            <button onClick={() => setEditingComp(null)} className="btn-secondary">Cancel</button>
            <button onClick={saveEditItems} disabled={savingItems} className="btn-primary flex items-center gap-2">
              {savingItems ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {savingItems ? 'Saving...' : 'Save Items'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

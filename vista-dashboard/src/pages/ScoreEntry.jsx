import { useState, useEffect, useReducer, useCallback, useRef, useMemo, Fragment } from 'react'
import { curriculumApi, scoreApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'
import { formatName } from '../utils/nameHelper'
import { useAuth } from '../context/AuthContext'
import {
  PenLine, ChevronDown, ChevronRight, Plus, Trash2, Save,
  Settings, Loader2, ClipboardList, GripVertical, Filter, Download
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import XLSX from 'xlsx-js-style'

const QUARTERS = [1, 2, 3, 4]

// DepEd transmutation table (DO 8, s. 2015)
const transmuteGrade = (initial) => {
  if (initial >= 100) return 100
  if (initial >= 60)  return Math.min(99, 75 + Math.floor((initial - 60) / 1.6))
  if (initial > 0)    return Math.min(74, 60 + Math.floor(initial / 4))
  return 60
}

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
  const { activeAssignments } = useAuth()
  const assignments = activeAssignments

  // ── Filter state (persisted in sessionStorage) ────────────
  const [syId, setSyId]             = usePersistedFilter('syId')
  const [selectedClass, setSelectedClass] = usePersistedFilter('selectedClass')
  const [subjectId, setSubjectId]   = usePersistedFilter('subjectId')
  const [quarter, setQuarter]       = usePersistedFilter('quarter')

  const [schoolYears, setSchoolYears] = useState([])
  const [subjects, setSubjects]       = useState([])

  // Derive gradeLevel and section from selectedClass
  const [gradeLevel, section] = selectedClass ? selectedClass.split('|||') : ['', '']

  // Derive unique class (grade_level + section) options from teacher assignments
  const activeSYLabel = schoolYears.find(sy => sy.id === syId)?.label || ''
  const classOptions = useMemo(() => {
    const map = new Map()
    for (const a of assignments) {
      const key = `${a.grade_level}|||${a.section}`
      if (!map.has(key)) map.set(key, { grade_level: a.grade_level, section: a.section, subjects: [] })
      const entry = map.get(key)
      if (!entry.subjects.includes(a.subject)) entry.subjects.push(a.subject)
    }
    return [...map.values()].sort((a, b) => a.grade_level.localeCompare(b.grade_level) || a.section.localeCompare(b.section))
  }, [assignments])

  // Get allowed subject names for the selected class
  const allowedSubjects = useMemo(() => {
    if (!selectedClass) return []
    return classOptions.find(c => `${c.grade_level}|||${c.section}` === selectedClass)?.subjects || []
  }, [classOptions, selectedClass])

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

  // ── Load school years on mount — lock to active SY ────────
  useEffect(() => {
    curriculumApi.getSchoolYears().then(res => {
      const syList = res.data.school_years || res.data
      setSchoolYears(syList)
      const active = syList.find(sy => sy.is_active)
      if (active) setSyId(active.id)
    }).catch(() => {})
  }, [])

  // ── Auto-select first class if none selected ──────────────
  useEffect(() => {
    if (classOptions.length > 0 && !selectedClass) {
      setSelectedClass(`${classOptions[0].grade_level}|||${classOptions[0].section}`)
    }
  }, [classOptions])

  // ── Load subjects when class or sy changes, filtered to assignments ──
  useEffect(() => {
    if (!syId || !gradeLevel) { setSubjects([]); return }
    curriculumApi.getSubjects({ sy_id: syId, grade_level: gradeLevel })
      .then(res => {
        const list = res.data.subjects || []
        // Filter to only subjects the teacher is assigned to for this class
        const filtered = list.filter(s => allowedSubjects.includes(s.name))
        setSubjects(filtered)
        if (subjectId && !filtered.find(s => s.id === subjectId)) setSubjectId('')
      })
      .catch(() => setSubjects([]))
  }, [syId, gradeLevel, allowedSubjects])

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
    const filled = editItems.filter(i => i.name.trim())
    if (filled.length === 0) return toast.error('Add at least one item with a name.')
    const missingHps = filled.find(i => !i.highest_possible_score || Number(i.highest_possible_score) <= 0)
    if (missingHps) return toast.error(`"${missingHps.name}" is missing a valid HPS (must be greater than 0).`)
    const items = filled
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
  const syLabel = activeSYLabel
  const quarterLabels = { 1: 'FIRST GRADING', 2: 'SECOND GRADING', 3: 'THIRD GRADING', 4: 'FOURTH GRADING' }

  // ── Excel export ──────────────────────────────────────────
  const exportToExcel = () => {
    if (!categories.length || !students.length) return

    const thin = { style: 'thin', color: { rgb: '000000' } }
    const border = { top: thin, bottom: thin, left: thin, right: thin }
    const centerBold = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, font: { bold: true, sz: 9 }, border }
    const centerCell = { alignment: { horizontal: 'center', vertical: 'center' }, font: { sz: 9 }, border }
    const leftBold = { alignment: { horizontal: 'left', vertical: 'center' }, font: { bold: true, sz: 9 }, border }
    const catColors = ['00B050', '4472C4', 'FF6B6B', 'FFD966']

    // ── Build column map ──────────────────────────────────
    // Col 0 = # (row number), Col 1 = student name
    const compCols = [] // { catIdx, comp, items, startCol, endCol }
    let col = 2
    for (let ci = 0; ci < categories.length; ci++) {
      const cat = categories[ci]
      for (const comp of cat.components) {
        const items = comp.items || []
        const start = col
        col += items.length // item columns
        col += 3 // T, PS, WS
        compCols.push({ catIdx: ci, cat, comp, items, startCol: start, endCol: col - 1 })
      }
    }
    const inCol = col
    const fCol = col + 1
    const remCol = col + 2
    const totalCols = col + 3

    // ── Row 0-4: School header ────────────────────────────
    const rows = []
    const merges = []

    const headerTexts = [
      'NORTHERN RIZAL YORKLIN SCHOOL',
      `SCHOOL YEAR: ${syLabel}`,
      quarterLabels[quarter] || '',
      `SUBJECT: ${subjectName.toUpperCase()}`,
    ]
    for (let r = 0; r < headerTexts.length; r++) {
      const row = Array(totalCols).fill({ v: '', s: { font: { sz: 9 } } })
      row[0] = { v: headerTexts[r], s: { font: { bold: true, sz: r === 0 ? 14 : 11 }, alignment: { horizontal: 'center', vertical: 'center' } } }
      rows.push(row)
      merges.push({ s: { r, c: 0 }, e: { r, c: totalCols - 1 } })
    }
    // Row 4: Teacher + Grade info
    const infoRow = Array(totalCols).fill({ v: '', s: { font: { sz: 9 } } })
    infoRow[0] = { v: `GRADE: ${gradeLevel}-${section}`, s: { font: { bold: true, sz: 10 }, alignment: { horizontal: 'left' } } }
    infoRow[Math.floor(totalCols / 2)] = { v: `TEACHER: ${formatName(user)}`, s: { font: { bold: true, sz: 10 }, alignment: { horizontal: 'right' } } }
    merges.push({ s: { r: 4, c: 0 }, e: { r: 4, c: Math.floor(totalCols / 2) - 1 } })
    merges.push({ s: { r: 4, c: Math.floor(totalCols / 2) }, e: { r: 4, c: totalCols - 1 } })
    rows.push(infoRow)

    const headerStartRow = 5

    // ── Row 5: Category headers (merged) ──────────────────
    const catRow = Array(totalCols).fill({ v: '', s: { border } })
    catRow[0] = { v: '', s: { border } }
    catRow[1] = { v: '', s: { border } }
    // Group compCols by category
    const catGroups = new Map()
    for (const cc of compCols) {
      if (!catGroups.has(cc.catIdx)) catGroups.set(cc.catIdx, { cat: cc.cat, startCol: cc.startCol, endCol: cc.endCol, catIdx: cc.catIdx })
      else catGroups.get(cc.catIdx).endCol = cc.endCol
    }
    for (const g of catGroups.values()) {
      const fill = { fgColor: { rgb: catColors[g.catIdx % catColors.length] } }
      const s = { ...centerBold, fill, font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' } } }
      catRow[g.startCol] = { v: `${g.cat.name.toUpperCase()} ${g.cat.weight}%`, s }
      for (let c = g.startCol + 1; c <= g.endCol; c++) catRow[c] = { v: '', s }
      merges.push({ s: { r: headerStartRow, c: g.startCol }, e: { r: headerStartRow, c: g.endCol } })
    }
    // GRADE header — merge vertically across category + component rows
    const gradeHeaderS = { ...centerBold, fill: { fgColor: { rgb: 'FFD966' } }, font: { bold: true, sz: 9 } }
    catRow[inCol] = { v: 'QUARTERLY GRADE', s: gradeHeaderS }
    catRow[fCol] = { v: '', s: gradeHeaderS }
    merges.push({ s: { r: headerStartRow, c: inCol }, e: { r: headerStartRow + 1, c: fCol } })
    const remarkHeaderS = { ...centerBold, fill: { fgColor: { rgb: '8DB4E2' } }, font: { bold: true, sz: 9 } }
    catRow[remCol] = { v: 'REMARK', s: remarkHeaderS }
    merges.push({ s: { r: headerStartRow, c: remCol }, e: { r: headerStartRow + 1, c: remCol } })
    rows.push(catRow)

    // ── Row 6: Component headers (merged) ─────────────────
    const compRow = Array(totalCols).fill({ v: '', s: { border } })
    compRow[0] = { v: '', s: { border } }
    compRow[1] = { v: '', s: { border } }
    for (const cc of compCols) {
      const fill = { fgColor: { rgb: catColors[cc.catIdx % catColors.length] } }
      const s = { ...centerBold, fill, font: { bold: true, sz: 8, color: { rgb: 'FFFFFF' } } }
      compRow[cc.startCol] = { v: `${cc.comp.name.toUpperCase()} ${cc.comp.weight}%`, s }
      for (let c = cc.startCol + 1; c <= cc.endCol; c++) compRow[c] = { v: '', s }
      merges.push({ s: { r: headerStartRow + 1, c: cc.startCol }, e: { r: headerStartRow + 1, c: cc.endCol } })
    }
    // IN/F/Remark cells in component row are part of the vertical merge above, just style them
    compRow[inCol] = { v: '', s: gradeHeaderS }
    compRow[fCol] = { v: '', s: gradeHeaderS }
    compRow[remCol] = { v: '', s: remarkHeaderS }
    rows.push(compRow)

    // ── Row 7: Column labels ──────────────────────────────
    const labelRow = Array(totalCols).fill({ v: '', s: centerBold })
    labelRow[0] = { v: '#', s: centerBold }
    labelRow[1] = { v: '', s: centerBold }
    for (const cc of compCols) {
      let c = cc.startCol
      for (const item of cc.items) {
        labelRow[c] = { v: item.name, s: centerBold }
        c++
      }
      labelRow[c] = { v: 'T', s: { ...centerBold, fill: { fgColor: { rgb: 'FFFF00' } } } }
      labelRow[c + 1] = { v: 'PS', s: centerBold }
      labelRow[c + 2] = { v: 'WS', s: { ...centerBold, fill: { fgColor: { rgb: 'FFFF00' } } } }
    }
    labelRow[inCol] = { v: 'IN', s: centerBold }
    labelRow[fCol] = { v: 'F', s: centerBold }
    labelRow[remCol] = { v: '', s: centerBold }
    rows.push(labelRow)

    // ── Row 8: HPS row ────────────────────────────────────
    const hpsS = { ...centerBold, fill: { fgColor: { rgb: '92D050' } } }
    const hpsYellow = { ...centerBold, fill: { fgColor: { rgb: 'FFFF00' } } }
    const hpsRow = Array(totalCols).fill({ v: '', s: hpsS })
    hpsRow[0] = { v: '', s: hpsS }
    hpsRow[1] = { v: 'HIGHEST POSSIBLE SCORE', s: { ...leftBold, fill: { fgColor: { rgb: '92D050' } } } }
    for (const cc of compCols) {
      let c = cc.startCol
      const hpsTotal = cc.items.reduce((s, i) => s + parseFloat(i.highest_possible_score), 0)
      for (const item of cc.items) {
        hpsRow[c] = { v: Math.floor(item.highest_possible_score), s: hpsS }
        c++
      }
      hpsRow[c] = { v: Math.floor(hpsTotal), s: hpsYellow }
      hpsRow[c + 1] = { v: 100, s: hpsS }
      hpsRow[c + 2] = { v: parseFloat(cc.comp.weight), s: hpsYellow }
    }
    hpsRow[inCol] = { v: 100, s: hpsYellow }
    hpsRow[fCol] = { v: 100, s: hpsYellow }
    hpsRow[remCol] = { v: '', s: hpsS }
    rows.push(hpsRow)

    // ── Student rows (gender-grouped) ─────────────────────
    const ec = (c) => XLSX.utils.encode_col(c) // column index to letter
    const hpsRowNum = headerStartRow + 3 + 1   // 1-indexed Excel row for HPS

    const buildStudentRow = (student, num) => {
      const row = Array(totalCols).fill({ v: '', s: centerCell })
      row[0] = { v: num, s: centerCell }
      row[1] = { v: formatName(student).toUpperCase(), s: { ...leftBold, font: { sz: 9 } } }

      const rowNum = rows.length + 1 // 1-indexed Excel row for this student
      const wsCols = [] // track WS column letters for IN formula

      for (const cc of compCols) {
        let c = cc.startCol
        const items = cc.items
        for (const item of items) {
          const val = scores[item.id]?.[student.id]
          row[c] = { v: val != null ? val : '', s: centerCell }
          c++
        }
        if (!items.length) {
          row[c] = { v: '', s: centerCell }
          row[c + 1] = { v: '', s: centerCell }
          row[c + 2] = { v: '', s: { ...centerBold, fill: { fgColor: { rgb: 'FFFF00' } }, font: { bold: true, sz: 9 } } }
          continue
        }

        const firstItemCol = ec(cc.startCol)
        const lastItemCol = ec(cc.startCol + items.length - 1)
        const tCol = ec(c)
        const psCol = ec(c + 1)
        const wsCol = ec(c + 2)
        const hpsTotalRef = `${tCol}${hpsRowNum}` // HPS total cell for this component

        // T = SUM of item scores
        row[c] = { v: '', s: centerCell, f: `SUM(${firstItemCol}${rowNum}:${lastItemCol}${rowNum})` }
        // PS = ROUND(T / HPS_Total * 100, 2)
        row[c + 1] = { v: '', s: centerCell, f: `IF(${hpsTotalRef}=0,0,ROUND(${tCol}${rowNum}/${hpsTotalRef}*100,2))` }
        // WS = ROUND(PS * weight / 100, 2)
        row[c + 2] = { v: '', s: { ...centerBold, fill: { fgColor: { rgb: 'FFFF00' } }, font: { bold: true, sz: 9 } }, f: `ROUND(${psCol}${rowNum}*${cc.comp.weight}/100,2)` }
        wsCols.push(`${wsCol}${rowNum}`)
        c += 3
      }

      // Compute initial values for styling
      const initGrade = computeStudentGrade(student.id)
      const transmuted = transmuteGrade(initGrade)
      const passed = transmuted >= 75

      // IN = SUM of all WS cells
      const inRef = ec(inCol)
      const fRef = ec(fCol)
      row[inCol] = { v: '', s: centerBold, f: wsCols.length ? `ROUND(${wsCols.join('+')},2)` : '0' }
      // F = DepEd transmutation formula
      const passedS = { ...centerBold, font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: passed ? '92D050' : 'FF0000' } } }
      row[fCol] = { v: '', s: passedS, f: `IF(${inRef}${rowNum}>=100,100,IF(${inRef}${rowNum}>=60,MIN(99,75+INT((${inRef}${rowNum}-60)/1.6)),IF(${inRef}${rowNum}>0,MIN(74,60+INT(${inRef}${rowNum}/4)),60)))` }
      // Remark
      row[remCol] = { v: '', s: { ...centerBold, fill: { fgColor: { rgb: passed ? '92D050' : 'FF0000' } }, font: { bold: true, sz: 9, color: { rgb: passed ? '006100' : 'FFFFFF' } } }, f: `IF(${fRef}${rowNum}>=75,"Passed","Failed")` }
      return row
    }

    const males = students.filter(s => s.gender === 'Male')
    const females = students.filter(s => s.gender === 'Female')

    if (males.length) {
      const maleSepRow = Array(totalCols).fill({ v: '', s: { border } })
      maleSepRow[1] = { v: 'MALE', s: { ...leftBold, font: { bold: true, sz: 9 } } }
      rows.push(maleSepRow)
    }
    males.forEach((s, i) => rows.push(buildStudentRow(s, i + 1)))

    if (females.length) {
      const sepRow = Array(totalCols).fill({ v: '', s: { border } })
      sepRow[1] = { v: 'FEMALE', s: { ...leftBold, font: { bold: true, sz: 9 } } }
      rows.push(sepRow)
      females.forEach((s, i) => rows.push(buildStudentRow(s, i + 1)))
    }

    // PASSING SCORE row
    const passRow = Array(totalCols).fill({ v: '', s: { border } })
    passRow[1] = { v: 'PASSING SCORE', s: leftBold }
    rows.push(passRow)

    // Signature row
    const sigRow = Array(totalCols).fill({ v: '', s: { font: { sz: 9 } } })
    rows.push(sigRow)
    const sigLabels = Array(totalCols).fill({ v: '', s: { font: { sz: 9 } } })
    const third = Math.floor(totalCols / 3)
    sigLabels[0] = { v: 'SUBMITTED TO:', s: { font: { bold: true, sz: 9 }, alignment: { horizontal: 'center' } } }
    merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: third - 1 } })
    sigLabels[third] = { v: 'SUBMITTED BY:', s: { font: { bold: true, sz: 9 }, alignment: { horizontal: 'center' } } }
    merges.push({ s: { r: rows.length, c: third }, e: { r: rows.length, c: third * 2 - 1 } })
    sigLabels[third * 2] = { v: 'COUNTER CHECKED BY:', s: { font: { bold: true, sz: 9 }, alignment: { horizontal: 'center' } } }
    merges.push({ s: { r: rows.length, c: third * 2 }, e: { r: rows.length, c: totalCols - 1 } })
    rows.push(sigLabels)

    // ── Build worksheet ───────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet(rows.map(r => r.map(c => c.v)))

    // Apply styles and formulas
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = rows[r][c]
        if (cell.f) {
          // Create or overwrite cell with formula
          ws[addr] = { t: 'n', f: cell.f, s: cell.s }
        } else if (ws[addr]) {
          ws[addr].s = cell.s
        }
      }
    }

    ws['!merges'] = merges

    // Column widths — auto-fit based on content
    const colWidths = Array(totalCols).fill(null).map(() => ({ wch: 7 }))
    colWidths[0] = { wch: 4 }  // #
    colWidths[1] = { wch: 30 } // Student name
    // Widen T/PS/WS and item columns based on header text length
    for (const cc of compCols) {
      for (let c = cc.startCol; c <= cc.endCol; c++) {
        const label = rows[headerStartRow + 2]?.[c]?.v || ''
        colWidths[c] = { wch: Math.max(7, String(label).length + 2) }
      }
    }
    colWidths[inCol] = { wch: 7 }
    colWidths[fCol] = { wch: 7 }
    colWidths[remCol] = { wch: 9 }
    ws['!cols'] = colWidths

    // Row heights — taller for merged header rows so wrapped text is visible
    ws['!rows'] = []
    for (let r = 0; r < rows.length; r++) ws['!rows'][r] = {}
    ws['!rows'][headerStartRow] = { hpt: 30 }     // Category row
    ws['!rows'][headerStartRow + 1] = { hpt: 28 } // Component row
    ws['!rows'][headerStartRow + 2] = { hpt: 22 } // Label row

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Scores')
    XLSX.writeFile(wb, `${subjectName}_${gradeLevel}_${section}.xlsx`)
    toast.success('Excel file exported.')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Score Entry</h1>
          <p className="page-subtitle">Enter component scores for students</p>
        </div>
        {filtersReady && categories.length > 0 && students.length > 0 && (() => {
          const allHaveItems = categories.every(cat => cat.components.every(comp => (comp.items || []).length > 0))
          return (
            <button
              onClick={allHaveItems ? exportToExcel : () => toast.error('All components must have score items before exporting.')}
              className={clsx('flex items-center gap-2 text-sm', allHaveItems ? 'btn-secondary' : 'btn-secondary opacity-50 cursor-not-allowed')}
            >
              <Download size={15} /> Export Excel
            </button>
          )
        })()}
      </div>

      {/* Filter Bar */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={15} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="input bg-slate-50 flex items-center text-slate-700 font-semibold cursor-default">
            {syLabel ? `SY ${syLabel}` : 'No active school year'}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Class</label>
            <select className="input truncate" value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setSubjectId('') }}>
              {classOptions.length === 0 && <option value="">No assigned classes</option>}
              {classOptions.map(c => (
                <option key={`${c.grade_level}|||${c.section}`} value={`${c.grade_level}|||${c.section}`}>
                  {c.grade_level} — {c.section}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
            <select className="input" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={!subjects.length}>
              <option value="">Subject</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Quarter</label>
            <select className="input" value={quarter} onChange={e => setQuarter(e.target.value)}>
              <option value="">Quarter</option>
              {QUARTERS.map(q => <option key={q} value={q}>Quarter {q}</option>)}
            </select>
          </div>
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
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              {/* Category header */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide truncate">
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
                      className="flex items-center justify-between px-4 py-3 bg-teal-50/60 cursor-pointer select-none min-w-0"
                      onClick={() => toggleComp(comp.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isExpanded ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />}
                        <span className="text-sm font-semibold text-slate-700 truncate">{comp.name}</span>
                        <span className="text-xs text-slate-400 font-medium flex-shrink-0">{comp.weight}%</span>
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
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-700 tracking-wide">Grade Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className="whitespace-nowrap sticky left-0 z-10 bg-slate-50/80 text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[200px]">#</th>
                    {categories.map(cat => (
                      <th key={cat.id} className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[100px] max-w-[160px]">
                        <div className="truncate">{cat.name}</div>
                        <span className="font-normal text-slate-400">({cat.weight}%)</span>
                      </th>
                    ))}
                    <th className="whitespace-nowrap text-center px-4 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wider">Initial</th>
                    <th className="whitespace-nowrap text-center px-4 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wider">Final</th>
                    <th className="whitespace-nowrap text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {['Male', 'Female'].map(gender => {
                    const group = students.filter(s => s.gender === gender)
                    if (!group.length) return null
                    return (
                      <Fragment key={gender}>
                        <tr>
                          <td colSpan={categories.length + 4} className="sticky left-0 z-10 bg-slate-50 px-5 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest border-y border-slate-200">
                            {gender}
                          </td>
                        </tr>
                        {group.map((student, idx) => {
                          const initialGrade = computeStudentGrade(student.id)
                          const transmuted = transmuteGrade(initialGrade)
                          const passed = transmuted >= 75
                          return (
                            <tr key={student.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="whitespace-nowrap sticky left-0 z-10 bg-white px-5 py-2.5">
                                <div className="text-sm font-medium text-slate-700">{formatName(student)}</div>
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
                                  <td key={cat.id} className="text-center px-4 py-2.5 text-sm tabular-nums text-slate-600">
                                    {catWS.toFixed(2)}
                                  </td>
                                )
                              })}
                              <td className="text-center px-4 py-2.5 text-sm tabular-nums font-semibold text-slate-700">{initialGrade.toFixed(2)}</td>
                              <td className={clsx('text-center px-4 py-2.5 text-sm tabular-nums font-bold', passed ? 'text-teal-600' : 'text-red-500')}>{transmuted}</td>
                              <td className="text-center px-4 py-2.5">
                                <span className={clsx('inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold', passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500')}>
                                  {passed ? 'Passed' : 'Failed'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
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

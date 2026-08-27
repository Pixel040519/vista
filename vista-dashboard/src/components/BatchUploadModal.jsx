import { useRef, useState, useMemo, useEffect } from 'react'
import Papa from 'papaparse'
import toast from 'react-hot-toast'
import { Upload, FileDown, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal } from './UI'
import { studentApi, curriculumApi } from '../api/client'

const GRADE_LEVELS = [
  'Kinder',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6',
]
const GENDERS = ['Male','Female','Other']
const COLUMNS = ['lrn','surname','first_name','middle_name','date_of_birth','gender','grade_level','section','home_address']
const MAX_ROWS = 200

const TEMPLATE_ROWS = [
  ['123456789012','Dela Cruz','Juan','Santos','2015-05-20','Male','Grade 1','Sampaguita','123 Rizal St., Antipolo, Rizal'],
  ['234567890123','Reyes','Maria','','2016-03-11','Female','Kinder','Sampaguita','456 Mabini Ave., Antipolo, Rizal'],
]

async function downloadTemplate() {
  const XLSX = (await import('xlsx-js-style')).default
  const aoa = [COLUMNS, ...TEMPLATE_ROWS]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  const textCellStyle = { numFmt: '@' }

  // 1) Force the example-row LRN cells to Text so their values render literally.
  for (let r = 1; r <= TEMPLATE_ROWS.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 })
    const cell = ws[addr]
    if (cell) {
      cell.t = 's'
      cell.v = String(cell.v)
      cell.z = '@'
      cell.s = textCellStyle
    }
  }

  // 2) Pre-seed every *empty* cell in the LRN column down to MAX_ROWS rows with
  //    an explicit Text format, so when the user types a new 12-digit LRN into
  //    those cells Excel keeps it as text (no scientific notation). Column-level
  //    formatting via !cols is not reliably honored by Excel — this per-cell
  //    seeding is the robust approach.
  const startRow = TEMPLATE_ROWS.length + 1
  const endRow = MAX_ROWS
  for (let r = startRow; r <= endRow; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 })
    ws[addr] = { t: 's', v: '', z: '@', s: textCellStyle }
  }

  // 3) Expand the sheet range so Excel acknowledges the pre-formatted cells.
  const range = XLSX.utils.decode_range(ws['!ref'])
  if (range.e.r < endRow) range.e.r = endRow
  if (range.e.c < COLUMNS.length - 1) range.e.c = COLUMNS.length - 1
  ws['!ref'] = XLSX.utils.encode_range(range)

  // 4) Column widths (visual only).
  ws['!cols'] = [
    { wch: 16 }, // lrn
    { wch: 14 }, // surname
    { wch: 14 }, // first_name
    { wch: 14 }, // middle_name
    { wch: 12 }, // date_of_birth
    { wch: 8 },  // gender
    { wch: 12 }, // grade_level
    { wch: 14 }, // section
    { wch: 40 }, // home_address
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Students')
  XLSX.writeFile(wb, 'students-batch-template.xlsx')
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SCI_NOTATION_RE = /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/

// Expand a scientific-notation string like "1.23457E+11" into "123457000000"
// so Excel's display format doesn't leave the LRN unreadable in the preview.
// Precision may have been lost by Excel — the caller should still verify the
// digits visually before submitting.
function expandSciNotation(s) {
  if (!SCI_NOTATION_RE.test(s)) return s
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return n.toFixed(0)
}

function validateRow(r, lrnCounts, sciLrnIndexes, idx, sectionsByGrade) {
  const errors = []
  const lrn = String(r.lrn ?? '').trim()
  const surname = String(r.surname ?? '').trim()
  const first_name = String(r.first_name ?? '').trim()
  const dob = String(r.date_of_birth ?? '').trim()
  const gender = String(r.gender ?? '').trim()
  const grade_level = String(r.grade_level ?? '').trim()
  const section = String(r.section ?? '').trim()
  const home_address = String(r.home_address ?? '').trim()

  if (!lrn) errors.push('LRN required')
  else if (sciLrnIndexes.has(idx)) errors.push('LRN lost precision in Excel (saved as scientific notation). Re-open the source file, format the LRN column as Text, re-save, and re-upload — or upload the .xlsx directly.')
  else if (!/^\d{12}$/.test(lrn)) errors.push('LRN must be 12 digits')
  else if ((lrnCounts.get(lrn) || 0) > 1) errors.push('Duplicate LRN in file')

  if (!surname) errors.push('Surname required')
  if (!first_name) errors.push('First name required')

  if (!dob) errors.push('Date of birth required')
  else if (!DATE_RE.test(dob) || Number.isNaN(Date.parse(dob))) errors.push('DOB must be YYYY-MM-DD')

  if (!gender) errors.push('Gender required')
  else if (!GENDERS.includes(gender)) errors.push(`Gender must be one of ${GENDERS.join('/')}`)

  if (!grade_level) errors.push('Grade level required')
  else if (!GRADE_LEVELS.includes(grade_level)) errors.push('Invalid grade level')

  // Section is optional. If provided, it must exist under that grade level for
  // the active school year (matches backend check).
  if (section && sectionsByGrade && GRADE_LEVELS.includes(grade_level)) {
    const valid = sectionsByGrade.get(grade_level)
    if (!valid || !valid.has(section)) {
      errors.push(`Section "${section}" does not exist for ${grade_level}`)
    }
  }

  if (!home_address) errors.push('Home address required')

  return errors
}

// Excel stores dates as serial numbers. xlsx-js-style parses them into JS Dates
// (with `raw: true` it returns the underlying Date). Convert to YYYY-MM-DD.
function formatDob(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, '0')
    const d = String(v.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v ?? '').trim()
}

function normalizeCell(c, v) {
  if (v === null || v === undefined) return ''
  // LRNs that come back as numbers (from a General-formatted Excel cell) —
  // JS can hold 12-digit integers exactly, so String() round-trips safely.
  if (typeof v === 'number') {
    if (c === 'date_of_birth') return formatDob(v)
    // Integers that serialize with exponent (e.g. 1.23e+11) get expanded.
    const s = String(v)
    return SCI_NOTATION_RE.test(s) ? Number(v).toFixed(0) : s
  }
  if (v instanceof Date) return formatDob(v)
  const raw = String(v).trim()
  // CSV cells that Excel wrote as "1.23457E+11" get expanded back into a
  // full integer string so the preview is readable.
  return expandSciNotation(raw)
}

export default function BatchUploadModal({ open, onClose, onSuccess }) {
  const fileInputRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [rowErrors, setRowErrors] = useState([])
  const [parseError, setParseError] = useState('')
  const [sciAdvisory, setSciAdvisory] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sectionsByGrade, setSectionsByGrade] = useState(null)

  // Load valid sections for the active school year when the modal opens so
  // client-side validation can flag unknown (grade_level, section) pairs.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    curriculumApi.getSections()
      .then(res => {
        if (cancelled) return
        const map = new Map()
        for (const s of res.data?.sections || []) {
          if (!map.has(s.grade_level)) map.set(s.grade_level, new Set())
          map.get(s.grade_level).add(s.name)
        }
        setSectionsByGrade(map)
      })
      .catch(() => { if (!cancelled) setSectionsByGrade(new Map()) })
    return () => { cancelled = true }
  }, [open])

  const reset = () => {
    setFileName('')
    setRows([])
    setRowErrors([])
    setParseError('')
    setSciAdvisory(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const applyParsed = async (records) => {
    const missing = COLUMNS.filter(c => !(c in (records[0] || {})))
    if (missing.length) {
      setParseError(`Missing required column(s): ${missing.join(', ')}. Download the template for the correct format.`)
      return
    }
    // Track which rows had an LRN stored in scientific notation BEFORE
    // normalization — the row stays visible (expanded digits are shown) but
    // is blocked because Excel truncated the real value.
    const sciSourceByOriginalIdx = new Set()
    records.forEach((r, i) => {
      if (SCI_NOTATION_RE.test(String(r.lrn ?? '').trim())) sciSourceByOriginalIdx.add(i)
    })
    const parsed = []
    const sciLrnIndexes = new Set()
    records.forEach((r, i) => {
      const row = {}
      for (const c of COLUMNS) row[c] = normalizeCell(c, r[c])
      if (!COLUMNS.some(c => row[c])) return // drop fully-empty rows
      if (sciSourceByOriginalIdx.has(i)) sciLrnIndexes.add(parsed.length)
      parsed.push(row)
    })
    if (!parsed.length) {
      setParseError('The file has no data rows.')
      return
    }
    if (parsed.length > MAX_ROWS) {
      setParseError(`Too many rows. Max ${MAX_ROWS} per upload — split the file and upload separately.`)
      return
    }
    setSciAdvisory(sciLrnIndexes.size > 0)
    const lrnCounts = new Map()
    for (const p of parsed) if (p.lrn) lrnCounts.set(p.lrn, (lrnCounts.get(p.lrn) || 0) + 1)
    setRows(parsed)

    // Local validation first so the preview renders immediately.
    const localErrors = parsed.map((p, i) => validateRow(p, lrnCounts, sciLrnIndexes, i, sectionsByGrade))
    setRowErrors(localErrors)

    // Then check the DB for already-existing LRNs and merge those errors in.
    const candidateLrns = parsed
      .map(p => p.lrn)
      .filter(l => /^\d{12}$/.test(l))
    if (!candidateLrns.length) return
    try {
      const res = await studentApi.checkLrns(candidateLrns)
      const existing = new Set(res.data?.existing || [])
      // An LRN held by an *archived* learner is still taken — `students_lrn_key`
      // is UNIQUE across the whole table — but the answer is to restore that
      // record, not to renumber the row. Saying "already exists" sent admins
      // hunting for a learner no list shows.
      const archived = new Set(res.data?.archived || [])
      if (!existing.size) return
      setRowErrors(prev => parsed.map((p, i) => {
        const errs = [...(prev[i] || [])]
        if (existing.has(p.lrn) && !errs.some(e => e.startsWith('LRN already exists') || e.startsWith('LRN belongs to'))) {
          errs.push(archived.has(p.lrn)
            ? 'LRN belongs to an archived student — restore them from Students → Archived instead'
            : 'LRN already exists in the database')
        }
        return errs
      }))
    } catch {
      // Silent — the backend will still reject on submit if any LRN exists.
    }
  }

  const parseCsv = (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => applyParsed(result.data),
      error: (err) => setParseError(`Could not parse CSV: ${err.message}`),
    })
  }

  const parseXlsx = async (file) => {
    try {
      const XLSX = (await import('xlsx-js-style')).default
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) { setParseError('The workbook is empty.'); return }
      // raw: true preserves underlying values (so a number-typed LRN comes
      // through as the full 12-digit integer, not its scientific-notation
      // display string). header: 1 returns arrays so we can normalize the
      // header row ourselves.
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
      if (!aoa.length) { setParseError('The sheet has no rows.'); return }
      const headers = (aoa[0] || []).map(h => String(h ?? '').trim().toLowerCase())
      const records = aoa.slice(1).map(row => {
        const obj = {}
        headers.forEach((h, i) => { obj[h] = row[i] })
        return obj
      })
      applyParsed(records)
    } catch (err) {
      setParseError(`Could not read spreadsheet: ${err.message || err}`)
    }
  }

  const handleFile = (file) => {
    if (!file) return
    setParseError('')
    setRows([])
    setRowErrors([])
    setSciAdvisory(false)
    setFileName(file.name)
    const name = file.name.toLowerCase()
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) parseXlsx(file)
    else if (name.endsWith('.csv')) parseCsv(file)
    else setParseError('Unsupported file type. Upload a .xlsx or .csv file.')
  }

  const onPickFile = (e) => handleFile(e.target.files?.[0])
  const onDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }
  const onDragOver = (e) => e.preventDefault()

  const totalErrors = useMemo(() => rowErrors.reduce((n, e) => n + e.length, 0), [rowErrors])
  const canSubmit = rows.length > 0 && totalErrors === 0 && !parseError && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await studentApi.bulk(rows)
      toast.success(res.data?.message || `${rows.length} students added.`)
      reset()
      onSuccess?.()
      onClose()
    } catch {
      // axios interceptor already toasts the backend error message
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Batch Upload Students" size="xl" selfScroll>
      <div className="flex flex-col flex-1 min-h-0 gap-4">
        {/* Instructions + template */}
        <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-700">Upload format</p>
            <p>Use the template. Columns (case-sensitive): <code className="font-mono">{COLUMNS.join(', ')}</code></p>
            <p>Gender: Male / Female / Other. Date of birth: YYYY-MM-DD. Max {MAX_ROWS} rows per upload.</p>
            <p className="text-slate-500">
              Accepts .xlsx and .csv. The template keeps the LRN column as text so Excel does not turn 12-digit numbers into scientific notation.
              Guardians are not part of this upload — add them after using "Manage Guardians".
            </p>
          </div>
          <button type="button" onClick={downloadTemplate} className="btn-secondary flex-shrink-0 whitespace-nowrap">
            <FileDown size={14}/> Template
          </button>
        </div>

        {/* File drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          className={clsx(
            'border-2 border-dashed rounded-xl p-6 text-center transition-colors',
            fileName ? 'border-brand-300 bg-brand-50/50' : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/30'
          )}
        >
          {fileName ? (
            <div className="flex items-center justify-center gap-3">
              <FileText size={24} className="text-brand-600"/>
              <div className="text-left">
                <p className="text-sm font-medium text-slate-800">{fileName}</p>
                <p className="text-xs text-slate-500">
                  {rows.length} row{rows.length === 1 ? '' : 's'} parsed
                  {totalErrors > 0 && <span className="text-red-600"> · {totalErrors} error{totalErrors === 1 ? '' : 's'}</span>}
                </p>
              </div>
              <button type="button" onClick={reset} className="ml-3 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50">
                <X size={14}/>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={28} className="text-slate-400"/>
              <p className="text-sm font-medium text-slate-700">Drop an .xlsx or .csv file here or</p>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary">
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onPickFile}
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Parse error */}
        {parseError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5"/>
            <p className="text-xs text-red-700">{parseError}</p>
          </div>
        )}

        {/* Sci-notation advisory — LRN precision was lost by Excel */}
        {sciAdvisory && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5"/>
            <p className="text-xs text-amber-700">
              Some LRNs were stored in scientific notation (e.g. <span className="font-mono">1.23457E+11</span>).
              The digits shown in the preview are what Excel rounded them to — the original LRN cannot be recovered from the CSV.
              To fix: re-open your source file, format the LRN column as <b>Text</b>, re-save, and upload again — or upload the <b>.xlsx</b> directly.
            </p>
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Preview</p>
              {totalErrors === 0 ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg">
                  <CheckCircle2 size={12}/> Ready to import
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-lg">
                  <AlertCircle size={12}/> Fix errors in your file and re-upload
                </span>
              )}
            </div>
            <div className="overflow-auto border border-slate-200 rounded-xl flex-1 min-h-0">
              <table className="table-base text-xs">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>LRN</th>
                    <th>Name</th>
                    <th>DOB</th>
                    <th>Gender</th>
                    <th>Grade</th>
                    <th>Section</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const errs = rowErrors[i] || []
                    const bad = errs.length > 0
                    return (
                      <tr key={i} className={clsx(bad && 'bg-red-50/50')}>
                        <td className="font-mono text-slate-400">{i + 1}</td>
                        <td className="font-mono whitespace-nowrap">{r.lrn || <span className="text-slate-300">—</span>}</td>
                        <td>{[r.surname, r.first_name].filter(Boolean).join(', ') || <span className="text-slate-300">—</span>}</td>
                        <td>{r.date_of_birth || <span className="text-slate-300">—</span>}</td>
                        <td>{r.gender || <span className="text-slate-300">—</span>}</td>
                        <td>{r.grade_level || <span className="text-slate-300">—</span>}</td>
                        <td>{r.section || <span className="text-slate-300">—</span>}</td>
                        <td>
                          {errs.length ? (
                            <span className="text-red-600 font-medium">{errs.join('; ')}</span>
                          ) : (
                            <span className="text-emerald-600">OK</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleClose}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canSubmit}
          >
            {submitting
              ? 'Uploading…'
              : `Upload ${rows.length > 0 ? `${rows.length} student${rows.length === 1 ? '' : 's'}` : 'students'}`
            }
          </button>
        </div>
      </div>
    </Modal>
  )
}

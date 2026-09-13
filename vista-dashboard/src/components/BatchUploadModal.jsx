import { Fragment, useRef, useState, useMemo, useEffect } from 'react'
import Papa from 'papaparse'
import toast from 'react-hot-toast'
import { Upload, FileDown, FileSpreadsheet, X, AlertCircle, CheckCircle2, Check, ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal } from './UI'
import { studentApi, curriculumApi } from '../api/client'

const GRADE_LEVELS = [
  'Kinder',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6',
]
const GENDERS = ['Male','Female']
const COLUMNS = ['lrn','surname','first_name','middle_name','date_of_birth','gender','grade_level','section','home_address']
const MAX_ROWS = 200

// Same list as the guardian form in pages/Students.jsx.
const RELATIONSHIPS = ['Mother','Father','Guardian','Grandmother','Grandfather','Aunt','Uncle','Sibling','Other']
const GUARDIAN_COLUMNS = ['lrn','surname','first_name','middle_name','relationship','phone','email','home_address','authorized_pickup','emergency_contact']
const MAX_GUARDIAN_ROWS = 600
const MAX_GUARDIANS_PER_STUDENT = 10 // matches POST /students/bulk

const TEMPLATE_ROWS = [
  ['123456789012','Dela Cruz','Juan','Santos','2015-05-20','Male','Grade 1','Sampaguita','123 Rizal St., Antipolo, Rizal'],
  ['234567890123','Reyes','Maria','','2016-03-11','Female','Kinder','Sampaguita','456 Mabini Ave., Antipolo, Rizal'],
]

const GUARDIAN_TEMPLATE_ROWS = [
  ['123456789012','Dela Cruz','Rosa','Santos','Mother','09171234567','rosa.delacruz@email.com','','Yes','Yes'],
  ['123456789012','Dela Cruz','Pedro','','Father','09181234567','','','Yes','No'],
  ['234567890123','Reyes','Lorna','','Grandmother','09191234567','','789 Luna St., Antipolo, Rizal','Yes','Yes'],
]

// Build one template sheet. `textCols` are the columns Excel would otherwise
// mangle as numbers — a 12-digit LRN turns into scientific notation, and a
// phone number loses its leading 0.
function buildTemplateSheet(XLSX, columns, exampleRows, textCols, maxRows, widths) {
  const ws = XLSX.utils.aoa_to_sheet([columns, ...exampleRows])
  const textCellStyle = { numFmt: '@' }

  for (const c of textCols) {
    // 1) Force the example-row cells to Text so their values render literally.
    for (let r = 1; r <= exampleRows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell) {
        cell.t = 's'
        cell.v = String(cell.v)
        cell.z = '@'
        cell.s = textCellStyle
      }
    }
    // 2) Pre-seed every *empty* cell in the column down to maxRows with an
    //    explicit Text format, so values typed there later stay text. Column-
    //    level formatting via !cols is not reliably honored by Excel — this
    //    per-cell seeding is the robust approach.
    for (let r = exampleRows.length + 1; r <= maxRows; r++) {
      ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@', s: textCellStyle }
    }
  }

  // 3) Expand the sheet range so Excel acknowledges the pre-formatted cells.
  const range = XLSX.utils.decode_range(ws['!ref'])
  if (range.e.r < maxRows) range.e.r = maxRows
  if (range.e.c < columns.length - 1) range.e.c = columns.length - 1
  ws['!ref'] = XLSX.utils.encode_range(range)

  // 4) Column widths (visual only).
  ws['!cols'] = widths.map(wch => ({ wch }))
  return ws
}

async function downloadTemplate() {
  const XLSX = (await import('xlsx-js-style')).default
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildTemplateSheet(
    XLSX, COLUMNS, TEMPLATE_ROWS, [0], MAX_ROWS,
    [16, 14, 14, 14, 12, 8, 12, 14, 40],
  ), 'Students')
  XLSX.utils.book_append_sheet(wb, buildTemplateSheet(
    XLSX, GUARDIAN_COLUMNS, GUARDIAN_TEMPLATE_ROWS, [0, 5], MAX_GUARDIAN_ROWS,
    [16, 14, 14, 14, 13, 15, 28, 40, 17, 17],
  ), 'Guardians')
  XLSX.writeFile(wb, 'students-batch-template.xlsx')
}

const SCI_NOTATION_RE = /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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

// Every issue names the field it is about, so the review can highlight that
// cell and print the fix under the row it belongs to. `text` reads after the
// field's label: "LRN — has 10 digits; it must be exactly 12".
const FIELD_LABELS = {
  lrn: 'LRN', surname: 'Surname', first_name: 'First name', date_of_birth: 'Date of birth',
  gender: 'Gender', grade_level: 'Grade level', section: 'Section', home_address: 'Home address',
  relationship: 'Relationship', phone: 'Phone', email: 'Email',
  authorized_pickup: 'Pickup', emergency_contact: 'Emergency contact', guardians: 'Guardians',
}
const issue = (field, text) => ({ field, text })

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

  if (!lrn) errors.push(issue('lrn', 'required'))
  else if (sciLrnIndexes.has(idx)) errors.push(issue('lrn', 'lost digits in Excel (saved as scientific notation). Format the LRN column as Text, re-save, and upload the .xlsx again'))
  else if (!/^\d{12}$/.test(lrn)) errors.push(issue('lrn', /^\d+$/.test(lrn) ? `has ${lrn.length} digits; it must be exactly 12` : 'must be exactly 12 digits'))
  else if ((lrnCounts.get(lrn) || 0) > 1) errors.push(issue('lrn', 'appears more than once in this file'))

  if (!surname) errors.push(issue('surname', 'required'))
  if (!first_name) errors.push(issue('first_name', 'required'))

  if (!dob) errors.push(issue('date_of_birth', 'required'))
  else if (parseTextDob(dob) !== dob) errors.push(issue('date_of_birth', `${dob} isn't a real date. Use DD/MM/YYYY or YYYY-MM-DD`))

  if (!gender) errors.push(issue('gender', 'required'))
  else if (!GENDERS.includes(gender)) errors.push(issue('gender', 'must be Male or Female'))

  if (!grade_level) errors.push(issue('grade_level', 'required'))
  else if (!GRADE_LEVELS.includes(grade_level)) errors.push(issue('grade_level', `"${grade_level}" isn't a grade level. Use Kinder or Grade 1 to Grade 6`))

  // Section is optional. If provided, it must exist under that grade level for
  // the active school year (matches backend check).
  if (section && sectionsByGrade && GRADE_LEVELS.includes(grade_level)) {
    const valid = sectionsByGrade.get(grade_level)
    if (!valid || !valid.has(section)) {
      errors.push(issue('section', `${grade_level} has no section named "${section}". Use an existing one, or add it in Curriculum → Sections first`))
    }
  }

  if (!home_address) errors.push(issue('home_address', 'required'))

  return errors
}

// Any way a PH mobile number gets typed — 09171234567, 9171234567, +63 917
// 123 4567, 639171234567 — into the "+63 9XX XXXXXXX" form PhoneInput stores.
// Returns null when it is not a PH mobile number.
function normalizePhone(v) {
  let digits = String(v ?? '').replace(/\D/g, '')
  if (digits.startsWith('63')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  if (!/^9\d{9}$/.test(digits)) return null
  return `+63 ${digits.slice(0, 3)} ${digits.slice(3)}`
}

// Yes/No columns. Anything unrecognised, blank included, is null so the row is
// flagged rather than silently read one way.
function parseFlag(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return null
}

const canonicalRelationship = (v) =>
  RELATIONSHIPS.find(r => r.toLowerCase() === String(v ?? '').trim().toLowerCase()) ?? null

const sameName = (a, b) =>
  String(a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

// The parent account a guardian row's email belongs to, if any. `accounts` is
// null while the lookup is still in flight.
const accountFor = (g, accounts) => (g.email ? accounts?.get(g.email.toLowerCase()) : undefined)

// What will actually be saved for a row: a linked row takes its name, email and
// phone from the account (the server copies them the same way), anything else
// is the sheet as typed.
function resolveGuardian(g, accounts) {
  const account = accountFor(g, accounts)
  if (!account) return { ...g, account: null }
  return {
    ...g,
    account,
    surname: account.surname,
    first_name: account.first_name,
    middle_name: account.middle_name || '',
    email: account.email,
    phone: account.phone || '',
    home_address: g.home_address || account.home_address || '',
  }
}

// Guardians are validated against the Students sheet of the *same file*: this
// upload creates learners, so a guardian can only belong to one of them.
// Adding a guardian to a learner who already exists is Manage Guardians.
//
// A row whose email belongs to a parent account needs only the LRN,
// relationship and the two Yes/No flags; the account supplies the rest. Any
// other row also needs a name and phone.
function validateGuardians(guardians, studentLrns, accounts) {
  const perStudent = new Map() // lrn -> { count, emails, names }
  const orAccount = 'required, unless the email belongs to a parent account'
  return guardians.map(g => {
    const errors = []
    const lrn = g.lrn
    const account = accountFor(g, accounts)
    // Until the lookup answers, an emailed row may yet turn out to be linked,
    // so its name and phone are not demanded; submit waits for the answer.
    const mayBeLinked = accounts === null && !!g.email

    if (!lrn) errors.push(issue('lrn', 'required'))
    else if (!studentLrns.has(lrn)) errors.push(issue('lrn', `${lrn} doesn't match any student in the Students sheet`))

    if (g.email && !EMAIL_RE.test(g.email)) errors.push(issue('email', `${g.email} isn't a valid email`))

    if (account) {
      // A name typed beside the email has to agree with the account: a mistyped
      // email matching another family would give a stranger this learner in
      // their parent app, pickup QR included.
      if ((g.surname && !sameName(g.surname, account.surname)) || (g.first_name && !sameName(g.first_name, account.first_name))) {
        errors.push(issue('email', `belongs to parent account ${account.surname}, ${account.first_name}, but the name doesn't match. Fix the email, or clear the name cells to use the account`))
      }
    } else if (!mayBeLinked) {
      if (!g.surname) errors.push(issue('surname', orAccount))
      if (!g.first_name) errors.push(issue('first_name', orAccount))
      if (!g.phone) errors.push(issue('phone', orAccount))
      else if (!normalizePhone(g.phone)) errors.push(issue('phone', `${g.phone} isn't a PH mobile number. Use one like 0917 123 4567`))
    }

    if (!g.relationship) errors.push(issue('relationship', 'required'))
    else if (!canonicalRelationship(g.relationship)) errors.push(issue('relationship', `must be one of ${RELATIONSHIPS.join(', ')}`))

    if (!g.authorized_pickup) errors.push(issue('authorized_pickup', 'required: Yes or No'))
    else if (parseFlag(g.authorized_pickup) === null) errors.push(issue('authorized_pickup', 'must be Yes or No'))
    if (!g.emergency_contact) errors.push(issue('emergency_contact', 'required: Yes or No'))
    else if (parseFlag(g.emergency_contact) === null) errors.push(issue('emergency_contact', 'must be Yes or No'))

    if (lrn) {
      if (!perStudent.has(lrn)) perStudent.set(lrn, { count: 0, emails: new Set(), names: new Set() })
      const seen = perStudent.get(lrn)
      seen.count++
      if (seen.count > MAX_GUARDIANS_PER_STUDENT) errors.push(issue('guardians', `more than ${MAX_GUARDIANS_PER_STUDENT} for this student`))
      const r = resolveGuardian(g, accounts)
      const email = r.email.toLowerCase()
      if (email && seen.emails.has(email)) errors.push(issue('email', 'is listed twice for this student'))
      if (email) seen.emails.add(email)
      const name = `${r.surname}|${r.first_name}`.toLowerCase()
      if (r.surname && r.first_name && seen.names.has(name)) errors.push(issue('surname', 'this guardian is listed twice for this student'))
      seen.names.add(name)
    }
    return errors
  })
}

// The sheet as typed. The server resolves the account from the email itself
// rather than trusting a filled-in copy from the browser.
const toGuardianPayload = (g) => ({
  surname: g.surname,
  first_name: g.first_name,
  middle_name: g.middle_name,
  relationship: canonicalRelationship(g.relationship),
  phone: g.phone ? normalizePhone(g.phone) ?? '' : '',
  email: g.email,
  home_address: g.home_address,
  is_authorized_pickup: parseFlag(g.authorized_pickup),
  is_emergency_contact: parseFlag(g.emergency_contact),
})

const EXCEL_UNIX_EPOCH = 25569 // days from Excel's 1899-12-30 base to 1970-01-01

// Excel stores a date cell as a day count. Convert it with UTC arithmetic only.
// SheetJS's own `cellDates` builds the Date at *local* midnight, so reading it
// back in UTC put every birthday a day early on a UTC+8 machine — 11/02/2016
// arrived as 2016-11-01.
function excelSerialToIso(serial, date1904 = false) {
  const days = Math.floor(serial) + (date1904 ? 1462 : 0) - EXCEL_UNIX_EPOCH
  return new Date(days * 86400000).toISOString().slice(0, 10)
}

// A DOB that arrives as text — a CSV exported from Excel, or a cell formatted
// as Text — carries whatever Excel displayed. Accept YYYY-MM-DD and DD/MM/YYYY,
// the order the school's sheets use. Slashed dates are always day-first rather
// than guessed per row, or 11/02 and 02/13 in one file would be read two ways.
// Returns the canonical YYYY-MM-DD, or null when it is not a real date.
function parseTextDob(s) {
  let y, m, d
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (match) [, y, m, d] = match
  else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, m, y] = match
  else return null
  const dt = new Date(Date.UTC(+y, +m - 1, +d))
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null
  return dt.toISOString().slice(0, 10)
}

// Spell the parsed date out in the preview so a day-first reading of an
// ambiguous 11/02/2016 is visible before anything is uploaded.
function displayDob(iso) {
  if (parseTextDob(iso) !== iso) return iso
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function normalizeCell(c, v) {
  if (v === null || v === undefined) return ''
  // LRNs that come back as numbers (from a General-formatted Excel cell) —
  // JS can hold 12-digit integers exactly, so String() round-trips safely.
  if (typeof v === 'number') {
    // Integers that serialize with exponent (e.g. 1.23e+11) get expanded.
    const s = String(v)
    return SCI_NOTATION_RE.test(s) ? Number(v).toFixed(0) : s
  }
  const raw = String(v).trim()
  if (c === 'date_of_birth') return parseTextDob(raw) ?? raw
  // CSV cells that Excel wrote as "1.23457E+11" get expanded back into a
  // full integer string so the preview is readable.
  return expandSciNotation(raw)
}

// A value in a review cell. Red and tinted when the row carries an issue for
// that field, a red "Missing" when the cell is blank and required.
function Cell({ value, bad, mono, children }) {
  const shown = children ?? value
  if (!bad) return shown ? <span className={mono ? 'font-mono text-xs' : undefined}>{shown}</span> : <span className="text-slate-300">—</span>
  return (
    <span className={clsx('inline-block px-1.5 rounded bg-red-100 text-red-700', mono && 'font-mono text-xs')}>
      {shown || 'Missing'}
    </span>
  )
}

function IssueLines({ issues }) {
  return (
    <div className="space-y-0.5">
      {issues.map((e, i) => (
        <p key={i} className="text-xs text-red-700">
          <span className="font-semibold">{FIELD_LABELS[e.field] ?? e.field}</span> — {e.text}
        </p>
      ))}
    </div>
  )
}

// The three steps that stand in for the review panel before a file is chosen,
// and fold under "Upload rules" once one is.
function UploadGuide() {
  const step = (n, title, body, first) => (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={clsx(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
          first ? 'bg-brand-500 text-white' : 'bg-white border border-slate-300 text-slate-600'
        )}>{n}</div>
        {n < 3 && <div className="flex-1 w-px bg-slate-200 my-1"/>}
      </div>
      <div className={clsx('flex-1 space-y-2', n < 3 && 'pb-4')}>
        <p className="text-sm font-semibold text-slate-900 leading-6">{title}</p>
        {body}
      </div>
    </div>
  )
  const em = (t) => <span className="font-medium text-slate-900">{t}</span>
  return (
    <div>
      {step(1, 'Download the template', (
        <>
          <p className="text-xs text-slate-600 leading-relaxed">It has a Students sheet and a Guardians sheet with every column ready.</p>
          <button type="button" onClick={downloadTemplate} className="btn-secondary w-full justify-center !py-2 !text-[13px]">
            <FileDown size={14}/> Download template
          </button>
        </>
      ), true)}
      {step(2, 'Fill in students', (
        <div className="space-y-1 text-xs text-slate-600 leading-relaxed">
          <p>{em('LRN')} — exactly 12 digits</p>
          <p>{em('Date of birth')} — DD/MM/YYYY or YYYY-MM-DD</p>
          <p>{em('Gender')} — Male or Female</p>
          <p>{em('Section')} — optional, must already exist</p>
          <p className="text-slate-500">Names, grade level and home address are required. Up to {MAX_ROWS} students.</p>
        </div>
      ))}
      {step(3, <>Add guardians <span className="text-xs font-normal text-slate-400">optional</span></>, (
        <div className="space-y-1 text-xs text-slate-600 leading-relaxed">
          <p>One row per guardian, matched to a student by {em('LRN')}.</p>
          <p>Always fill {em('relationship')}, {em('pickup')} and {em('emergency')} (Yes/No).</p>
          <p>Parent has an account? Just add their {em('email')} — name and phone fill in. Otherwise enter surname, first name and phone.</p>
          <p className="text-slate-500">A blank address uses the student&apos;s.</p>
        </div>
      ))}
    </div>
  )
}

export default function BatchUploadModal({ open, onClose, onSuccess }) {
  const fileInputRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [rowErrors, setRowErrors] = useState([])
  // null = the file carried no Guardians sheet (a CSV, or an older template),
  // [] = the sheet is there but empty. Only the first hides guardian columns.
  const [guardians, setGuardians] = useState(null)
  // Parent accounts the Guardians sheet's emails belong to, keyed by lowercased
  // email. null while that lookup is in flight.
  const [parentAccounts, setParentAccounts] = useState(new Map())
  // Bumped per file, so a lookup answering for a file that has since been
  // replaced is ignored.
  const parseSeq = useRef(0)
  const [filter, setFilter] = useState('all') // 'all' | 'fix' | 'ready'
  // Rows the admin has opened or closed by hand, index -> open. A row nobody
  // touched is open exactly when one of its guardians has a problem, so every
  // problem is on screen without a click.
  const [toggled, setToggled] = useState(new Map())
  const [rulesOpen, setRulesOpen] = useState(false)
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

  const clearParsed = () => {
    parseSeq.current++
    setRows([])
    setRowErrors([])
    setGuardians(null)
    setParentAccounts(new Map())
    setFilter('all')
    setToggled(new Map())
    setRulesOpen(false)
    setParseError('')
    setSciAdvisory(false)
  }

  const reset = () => {
    setFileName('')
    clearParsed()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const applyParsed = async (records, guardianRecords = null) => {
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

    let parsedGuardians = null
    if (guardianRecords) {
      // A sheet with only a header row has no first record to read columns off,
      // and nothing to import either — treat it as present but empty.
      if (guardianRecords.length) {
        const missingG = GUARDIAN_COLUMNS.filter(c => !(c in guardianRecords[0]))
        if (missingG.length) {
          setParseError(`Guardians sheet is missing column(s): ${missingG.join(', ')}. Download the template for the correct format.`)
          return
        }
      }
      parsedGuardians = guardianRecords
        .map(r => Object.fromEntries(GUARDIAN_COLUMNS.map(c => [c, normalizeCell(c, r[c])])))
        .filter(g => GUARDIAN_COLUMNS.some(c => g[c]))
      if (parsedGuardians.length > MAX_GUARDIAN_ROWS) {
        setParseError(`Too many guardian rows. Max ${MAX_GUARDIAN_ROWS} per upload — split the file and upload separately.`)
        return
      }
    }

    setSciAdvisory(sciLrnIndexes.size > 0)
    const lrnCounts = new Map()
    for (const p of parsed) if (p.lrn) lrnCounts.set(p.lrn, (lrnCounts.get(p.lrn) || 0) + 1)
    setRows(parsed)
    setGuardians(parsedGuardians)

    const emails = [...new Set((parsedGuardians || []).map(g => g.email.toLowerCase()).filter(e => EMAIL_RE.test(e)))]
    if (emails.length) {
      const seq = parseSeq.current
      setParentAccounts(null)
      studentApi.checkParentEmails(emails)
        .then(res => {
          if (seq !== parseSeq.current) return
          setParentAccounts(new Map((res.data?.parents || []).map(a => [a.email.toLowerCase(), a])))
        })
        // Nothing linked is the safe reading: those rows then ask for a name and
        // phone, and the server resolves accounts again on submit regardless.
        .catch(() => { if (seq === parseSeq.current) setParentAccounts(new Map()) })
    }

    // Local validation first so the preview renders immediately.
    const localErrors = parsed.map((p, i) => validateRow(p, lrnCounts, sciLrnIndexes, i, sectionsByGrade))
    setRowErrors(localErrors)

    // Then check the DB for already-existing LRNs and merge those errors in.
    const candidateLrns = parsed
      .map(p => p.lrn)
      .filter(l => /^\d{12}$/.test(l))
    if (!candidateLrns.length) return
    try {
      const seq = parseSeq.current
      const res = await studentApi.checkLrns(candidateLrns)
      if (seq !== parseSeq.current) return
      const existing = new Set(res.data?.existing || [])
      // An LRN held by an *archived* learner is still taken — `students_lrn_key`
      // is UNIQUE across the whole table — but the answer is to restore that
      // record, not to renumber the row. Saying "already exists" sent admins
      // hunting for a learner no list shows.
      const archived = new Set(res.data?.archived || [])
      if (!existing.size) return
      setRowErrors(prev => parsed.map((p, i) => {
        const errs = [...(prev[i] || [])]
        if (existing.has(p.lrn) && !errs.some(e => e.taken)) {
          errs.push({
            ...issue('lrn', archived.has(p.lrn)
              ? 'belongs to an archived student. Restore them from Students → Archived instead'
              : 'is already used by a student in VISTA'),
            taken: true,
          })
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
      // No `cellDates`: date cells stay serial numbers, converted below.
      const wb = XLSX.read(buf, { type: 'array' })
      const date1904 = !!wb.Workbook?.WBProps?.date1904

      // Sheets are found by name so reordering the tabs does not swap them.
      // A workbook without a "Students" tab (an older template, or someone's
      // own file) keeps working off its first non-Guardians sheet.
      const named = (name) => wb.SheetNames.find(n => n.trim().toLowerCase() === name)
      const guardianSheet = named('guardians')
      const studentSheet = named('students') ?? wb.SheetNames.find(n => n !== guardianSheet)
      const ws = studentSheet && wb.Sheets[studentSheet]
      if (!ws) { setParseError('The workbook is empty.'); return }

      // raw: true preserves underlying values (so a number-typed LRN comes
      // through as the full 12-digit integer, not its scientific-notation
      // display string). header: 1 returns arrays so we can normalize the
      // header row ourselves.
      const readRecords = (sheet) => {
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
        const headers = (aoa[0] || []).map(h => String(h ?? '').trim().toLowerCase())
        return aoa.slice(1).map(row => {
          const obj = {}
          headers.forEach((h, i) => {
            const v = row[i]
            obj[h] = h === 'date_of_birth' && typeof v === 'number' ? excelSerialToIso(v, date1904) : v
          })
          return obj
        })
      }

      const records = readRecords(ws)
      if (!records.length) { setParseError('The Students sheet has no rows.'); return }
      applyParsed(records, guardianSheet ? readRecords(wb.Sheets[guardianSheet]) : null)
    } catch (err) {
      setParseError(`Could not read spreadsheet: ${err.message || err}`)
    }
  }

  const handleFile = (file) => {
    if (!file) return
    clearParsed()
    setFileName(file.name)
    const name = file.name.toLowerCase()
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) parseXlsx(file)
    else if (name.endsWith('.csv')) parseCsv(file)
    else setParseError('Unsupported file type. Upload a .xlsx or .csv file.')
  }

  // The input is cleared after every pick so choosing the same file again —
  // the usual move after fixing it in Excel — still fires onChange.
  const onPickFile = (e) => {
    handleFile(e.target.files?.[0])
    e.target.value = ''
  }
  const onDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }
  const onDragOver = (e) => e.preventDefault()
  const chooseFile = () => fileInputRef.current?.click()

  // Guardians keep their index into `guardians`, which is what guardianErrors
  // is keyed by.
  const guardiansByLrn = useMemo(() => {
    const map = new Map()
    ;(guardians || []).forEach((g, i) => {
      if (!map.has(g.lrn)) map.set(g.lrn, [])
      map.get(g.lrn).push(i)
    })
    return map
  }, [guardians])
  const studentLrns = useMemo(() => new Set(rows.map(r => r.lrn)), [rows])
  const guardianErrors = useMemo(
    () => (guardians ? validateGuardians(guardians, studentLrns, parentAccounts) : []),
    [guardians, studentLrns, parentAccounts]
  )
  const checkingAccounts = parentAccounts === null

  // Per student: their own issues plus every issue on the guardians under them.
  const studentIssueCounts = useMemo(() => rows.map((r, i) =>
    (rowErrors[i]?.length || 0)
    + (guardiansByLrn.get(r.lrn) || []).reduce((n, gi) => n + (guardianErrors[gi]?.length || 0), 0)
  ), [rows, rowErrors, guardiansByLrn, guardianErrors])
  // Guardians whose LRN matches no student cannot sit under a row, so they
  // are listed on their own below the table.
  const orphanGuardians = useMemo(
    () => (guardians || []).map((g, i) => i).filter(i => !studentLrns.has(guardians[i].lrn)),
    [guardians, studentLrns]
  )

  const guardianCount = guardians?.length ?? 0
  const totalErrors = rowErrors.reduce((n, e) => n + e.length, 0) + guardianErrors.reduce((n, e) => n + e.length, 0)
  const fixCount = studentIssueCounts.filter(Boolean).length
  const readyCount = rows.length - fixCount
  const canSubmit = rows.length > 0 && totalErrors === 0 && !parseError && !submitting && !checkingAccounts
  const showGuardians = guardians !== null
  const loaded = rows.length > 0

  const visibleRows = rows
    .map((r, i) => i)
    .filter(i => filter === 'all' || (filter === 'fix' ? studentIssueCounts[i] > 0 : studentIssueCounts[i] === 0))

  const isOpen = (i) => {
    if (!showGuardians) return false
    if (toggled.has(i)) return toggled.get(i)
    return (guardiansByLrn.get(rows[i].lrn) || []).some(gi => guardianErrors[gi]?.length)
  }
  const toggleRow = (i) => {
    if (!showGuardians) return
    setToggled(prev => new Map(prev).set(i, !isOpen(i)))
  }
  const jumpTo = (i) => {
    setFilter('all')
    setToggled(prev => new Map(prev).set(i, true))
    requestAnimationFrame(() => document.getElementById(`batch-row-${i}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const payload = rows.map(r => ({
        ...r,
        guardians: (guardiansByLrn.get(r.lrn) || []).map(gi => toGuardianPayload(guardians[gi])),
      }))
      const res = await studentApi.bulk(payload)
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const importLabel = `Import ${plural(rows.length, 'student')}` + (guardianCount ? ` & ${plural(guardianCount, 'guardian')}` : '')

  const renderGuardian = (gi) => {
    const raw = guardians[gi]
    const g = resolveGuardian(raw, parentAccounts)
    const errs = guardianErrors[gi] || []
    const bad = (f) => errs.some(e => e.field === f)
    const pickup = parseFlag(g.authorized_pickup)
    const emergency = parseFlag(g.emergency_contact)
    return (
      <div key={gi} className={clsx('px-3 py-2 border-b last:border-b-0', errs.length ? 'border-red-100' : 'border-slate-100')}>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_9rem] gap-x-3 gap-y-1 items-center text-[13px]">
          <div className="min-w-0">
            <span className="font-medium text-slate-900">
              {bad('surname') || bad('first_name')
                ? <Cell bad>{[g.surname, g.first_name].filter(Boolean).join(', ')}</Cell>
                : [g.surname, g.first_name].filter(Boolean).join(', ') || <span className="text-slate-300">—</span>}
            </span>
            {g.account && (
              <span className="flex items-center gap-1 text-[11px] text-brand-600" title="Name, phone and email come from this parent account">
                <Link2 size={11}/> From parent account
              </span>
            )}
          </div>
          <span className="text-slate-600"><Cell bad={bad('relationship')} value={canonicalRelationship(g.relationship) ?? g.relationship}/></span>
          <span className="text-slate-600 whitespace-nowrap">
            <Cell bad={bad('phone')} value={normalizePhone(g.phone) ?? g.phone}/>
          </span>
          {/* Fixed column and a fixed slot per flag, so Pickup and Emergency
              line up down the list whichever of them a guardian has. */}
          <div className="grid grid-cols-[3.5rem_5rem] gap-1.5 items-center">
            <span>
              {bad('authorized_pickup')
                ? <Cell bad value={raw.authorized_pickup}/>
                : pickup && <span className="px-1.5 py-0.5 rounded-md text-xs bg-emerald-50 text-emerald-700">Pickup</span>}
            </span>
            <span>
              {bad('emergency_contact')
                ? <Cell bad value={raw.emergency_contact}/>
                : emergency && <span className="px-1.5 py-0.5 rounded-md text-xs bg-amber-50 text-amber-700">Emergency</span>}
            </span>
          </div>
        </div>
        {errs.length > 0 && <div className="mt-1"><IssueLines issues={errs}/></div>}
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="2xl"
      selfScroll
      title={(
        <>
          <span className="block">Batch Upload Students</span>
          <span className="block text-xs font-normal text-slate-500 mt-0.5">
            Add up to {MAX_ROWS} students and their guardians from one spreadsheet.
          </span>
        </>
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onPickFile}
        className="hidden"
      />
      {/* Full-bleed inside the Modal's padded body: the side panel runs edge to edge. */}
      <div className="flex flex-col flex-1 min-h-0 -mx-4 sm:-mx-6 -my-5">
        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden">

          {/* ── Side panel ─────────────────────────────────── */}
          <aside className="md:w-[300px] flex-shrink-0 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-100 p-5 space-y-4 md:overflow-y-auto">
            {!fileName ? (
              <>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Before you upload</p>
                <UploadGuide/>
                <p className="text-xs text-slate-400 leading-relaxed">No new parent accounts are created by this upload.</p>
              </>
            ) : (
              <>
                {/* File */}
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-[10px] bg-brand-50 text-brand-500 flex items-center justify-center flex-shrink-0">
                      <FileSpreadsheet size={17}/>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-900 truncate" title={fileName}>{fileName}</p>
                      <button type="button" onClick={chooseFile} disabled={submitting} className="text-xs font-medium text-brand-500 hover:text-brand-600">
                        Replace file
                      </button>
                    </div>
                    <button type="button" onClick={reset} disabled={submitting} title="Remove file"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50">
                      <X size={14}/>
                    </button>
                  </div>
                  {loaded && (
                    <div className={clsx('grid gap-2', showGuardians ? 'grid-cols-2' : 'grid-cols-1')}>
                      <div className="bg-slate-50 rounded-[10px] px-2.5 py-2">
                        <p className="text-lg font-bold text-slate-900 leading-tight">{rows.length}</p>
                        <p className="text-xs text-slate-500">{rows.length === 1 ? 'student' : 'students'}</p>
                      </div>
                      {showGuardians && (
                        <div className="bg-slate-50 rounded-[10px] px-2.5 py-2">
                          <p className="text-lg font-bold text-slate-900 leading-tight">{guardianCount}</p>
                          <p className="text-xs text-slate-500">{guardianCount === 1 ? 'guardian' : 'guardians'}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Status */}
                {parseError ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-1.5">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertCircle size={16}/> Can&apos;t read this file</p>
                    <p className="text-xs text-red-700 leading-relaxed">{parseError}</p>
                  </div>
                ) : !loaded ? null : totalErrors > 0 ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
                      <AlertCircle size={16}/> {plural(totalErrors, 'thing')} to fix
                    </p>
                    <p className="text-xs text-red-700 leading-relaxed">
                      Nothing is added until every row is valid. Fix them in your spreadsheet, save, and replace the file.
                    </p>
                    <div className="space-y-1 pt-1 max-h-48 overflow-y-auto">
                      {rows.map((r, i) => studentIssueCounts[i] > 0 && (
                        <button key={i} type="button" onClick={() => jumpTo(i)}
                          className="w-full flex justify-between gap-2 text-xs text-left hover:underline">
                          <span className="text-red-900 truncate">{[r.surname, r.first_name].filter(Boolean).join(', ') || `Row ${i + 1}`}</span>
                          <span className="text-red-700">{studentIssueCounts[i]}</span>
                        </button>
                      ))}
                      {orphanGuardians.length > 0 && (
                        <p className="flex justify-between gap-2 text-xs">
                          <span className="text-red-900">Guardians with no matching student</span>
                          <span className="text-red-700">{orphanGuardians.length}</span>
                        </p>
                      )}
                    </div>
                  </div>
                ) : checkingAccounts ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5">
                    <p className="text-sm font-medium text-slate-600">Checking guardian emails…</p>
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 space-y-1.5">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16}/> Ready to import</p>
                    <p className="text-xs text-emerald-700 leading-relaxed">Every row checks out. Nothing is added until you press Import.</p>
                  </div>
                )}

                {/* Rules */}
                <div className="border-t border-slate-200 pt-3.5 space-y-3">
                  <button type="button" onClick={() => setRulesOpen(o => !o)}
                    className="w-full flex items-center justify-between text-[13px] font-semibold text-slate-700">
                    Upload rules
                    <ChevronDown size={16} className={clsx('text-slate-400 transition-transform', rulesOpen && 'rotate-180')}/>
                  </button>
                  {rulesOpen ? <UploadGuide/> : (
                    <button type="button" onClick={downloadTemplate}
                      className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-600">
                      <FileDown size={13}/> Download template again
                    </button>
                  )}
                </div>
              </>
            )}
          </aside>

          {/* ── Main ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0 min-h-0 p-4 sm:p-6 flex flex-col gap-3.5 md:overflow-y-auto">
            {!loaded ? (
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                className="flex-1 min-h-[280px] border-2 border-dashed border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/30 transition-colors rounded-xl flex flex-col items-center justify-center gap-3 text-center p-6"
              >
                <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center">
                  <Upload size={26}/>
                </div>
                <p className="text-base font-semibold text-slate-800">
                  {parseError ? 'Drop a corrected file here' : 'Drop your spreadsheet here'}
                </p>
                <p className="text-[13px] text-slate-500">You&apos;ll see every student and guardian before anything is added.</p>
                <button type="button" onClick={chooseFile} className="btn-primary mt-1">Choose file</button>
                <p className="text-xs text-slate-400">.xlsx · a .csv uploads students only</p>
              </div>
            ) : (
              <>
                {sciAdvisory && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5"/>
                    <p className="text-xs text-amber-700">
                      Some LRNs were saved by Excel in scientific notation (e.g. <span className="font-mono">1.23457E+11</span>), and the
                      original digits can&apos;t be recovered from this file. Format the LRN column as <b>Text</b>, re-save, and upload the <b>.xlsx</b>.
                    </p>
                  </div>
                )}

                {/* Filters */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { id: 'all', label: 'All', count: rows.length },
                      { id: 'fix', label: 'Needs fixing', count: fixCount },
                      { id: 'ready', label: 'Ready', count: readyCount },
                    ].map(f => (
                      <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors',
                          filter === f.id
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : f.id === 'fix' && f.count > 0
                              ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        )}>
                        {f.label}
                        <span className={clsx('text-xs', filter === f.id ? 'text-white/80' : f.id === 'fix' && f.count > 0 ? 'text-red-700' : 'text-slate-400')}>{f.count}</span>
                      </button>
                    ))}
                  </div>
                  {showGuardians && <p className="text-xs text-slate-500">Click a student to see their guardians</p>}
                </div>

                {/* Students, guardians nested */}
                <div className="border border-slate-200 rounded-xl overflow-x-auto flex-shrink-0">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {showGuardians && <th className="w-8"/>}
                        {['Student', 'LRN', 'Birthday', 'Class', ...(showGuardians ? ['Guardians'] : [])].map(h => (
                          <th key={h} className="px-2.5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                        <th className="px-2.5 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.length === 0 && (
                        <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500">
                          {filter === 'fix' ? 'Nothing needs fixing.' : 'No student is ready yet.'}
                        </td></tr>
                      )}
                      {visibleRows.map(i => {
                        const r = rows[i]
                        const errs = rowErrors[i] || []
                        const bad = (f) => errs.some(e => e.field === f)
                        const count = studentIssueCounts[i]
                        const gIdx = guardiansByLrn.get(r.lrn) || []
                        const openRow = isOpen(i)
                        const tint = count > 0 ? 'bg-red-50' : ''
                        const name = [r.surname, r.first_name].filter(Boolean).join(', ')
                        return (
                          <Fragment key={i}>
                            <tr id={`batch-row-${i}`}
                              onClick={() => toggleRow(i)}
                              className={clsx('border-t border-slate-100', tint, showGuardians && 'cursor-pointer', !count && showGuardians && 'hover:bg-slate-50/60')}>
                              {showGuardians && (
                                <td className="pl-3 py-2.5 text-slate-400">
                                  {openRow ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                                </td>
                              )}
                              <td className="px-2.5 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                                {bad('surname') || bad('first_name') ? <Cell bad>{name}</Cell> : name}
                              </td>
                              <td className="px-2.5 py-2.5 whitespace-nowrap"><Cell mono bad={bad('lrn')} value={r.lrn}/></td>
                              <td className="px-2.5 py-2.5 whitespace-nowrap">
                                <Cell bad={bad('date_of_birth')} value={bad('date_of_birth') ? r.date_of_birth : (r.date_of_birth && displayDob(r.date_of_birth))}/>
                              </td>
                              <td className="px-2.5 py-2.5 whitespace-nowrap">
                                <Cell bad={bad('grade_level')} value={r.grade_level}/>
                                {r.section && <> · <Cell bad={bad('section')} value={r.section}/></>}
                              </td>
                              {showGuardians && <td className="px-2.5 py-2.5">{gIdx.length || <span className="text-slate-300">—</span>}</td>}
                              <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                                {count > 0 ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{count} to fix</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                    <Check size={12} strokeWidth={3}/> Ready
                                  </span>
                                )}
                              </td>
                            </tr>
                            {(errs.length > 0 || openRow) && (
                              <tr className={tint || 'bg-slate-50'}>
                                {showGuardians && <td/>}
                                <td colSpan={showGuardians ? 6 : 5} className="px-2.5 pb-2.5 space-y-2">
                                  {errs.length > 0 && <IssueLines issues={errs}/>}
                                  {openRow && (
                                    gIdx.length ? (
                                      <div className={clsx('rounded-[10px] bg-white border overflow-hidden', gIdx.some(gi => guardianErrors[gi]?.length) ? 'border-red-200' : 'border-slate-200')}>
                                        {gIdx.map(renderGuardian)}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-500">No guardians for this student in the Guardians sheet.</p>
                                    )
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {orphanGuardians.length > 0 && filter !== 'ready' && (
                  <div className="space-y-2 flex-shrink-0">
                    <p className="text-xs font-semibold text-red-700">Guardians with no matching student</p>
                    <div className="rounded-xl bg-white border border-red-200 overflow-hidden">
                      {orphanGuardians.map(renderGuardian)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <p className={clsx('text-[13px] font-medium', totalErrors > 0 ? 'text-red-700' : 'text-slate-500')}>
            {!loaded ? '' : totalErrors > 0 ? `Fix ${plural(totalErrors, 'thing')} to import`
              : checkingAccounts ? 'Checking guardian emails…' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleClose} disabled={submitting}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Importing…' : loaded ? importLabel : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

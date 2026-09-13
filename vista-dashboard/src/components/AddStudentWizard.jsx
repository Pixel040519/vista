import { useEffect, useRef, useState } from 'react'
import {
  Check, ChevronDown, ChevronLeft, ArrowRight, Info, Link2, Pencil, Plus, Search,
  Trash2, Eye, EyeOff, GraduationCap, User,
} from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { PhoneInput } from './UI'
import { studentApi, curriculumApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { titleCase } from '../utils/nameHelper'

// Add New Student as three steps: Student details → Guardians → Review.
// Each step asks one kind of question and is checked before moving on, so a
// mistake is caught where it was made instead of by the API at the very end.
// Editing a student still uses StudentForm in pages/Students.jsx.

const GRADE_LEVELS = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']
// Same list as pages/Students.jsx and the batch upload.
const RELATIONSHIPS = ['Mother','Father','Guardian','Grandmother','Grandfather','Aunt','Uncle','Sibling','Other']
const PHONE_RE = /^\+63 9\d{2} \d{7}$/ // what PhoneInput stores
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const STEPS = ['Student details', 'Guardians', 'Review']

const calcAge = (dob) => {
  if (!dob) return null
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

const fullName = (p) => [p.surname, [p.first_name, p.middle_name].filter(Boolean).join(' ')].filter(Boolean).join(', ')
const initials = (p) => `${p.surname?.[0] ?? ''}${p.first_name?.[0] ?? ''}`.toUpperCase() || '?'

// `mode` is null until the admin answers "how do you want to add this
// guardian?", so a card never quietly defaults to the wrong path.
const emptyGuardian = () => ({
  key: Math.random().toString(36).slice(2),
  mode: null, // 'link' | 'new'
  parent: null, // the account picked in link mode
  surname: '', first_name: '', middle_name: '', relationship: 'Mother',
  phone: '', email: '', same_address: true, home_address: '',
  is_authorized_pickup: true, is_emergency_contact: false,
  create_account: false, password: '',
})

// ── Small building blocks ─────────────────────────────────────
function Field({ label, optional, error, hint, children, className }) {
  return (
    <div className={className}>
      <label className={clsx('flex items-center gap-1.5 text-sm font-medium mb-1.5', error ? 'text-red-700' : 'text-slate-700')}>
        {label}
        {optional && <span className="text-xs font-normal text-slate-400">optional</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600 mt-1.5">{error}</p>
        : hint ? <p className="text-xs text-slate-500 mt-1.5">{hint}</p> : null}
    </div>
  )
}

const inputCls = (error) => clsx('input', error && '!border-red-400 focus:!ring-red-500/20')

function Select({ value, onChange, error, disabled, children }) {
  return (
    <div className="relative">
      <select className={clsx(inputCls(error), 'appearance-none pr-9')} value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
    </div>
  )
}

// A checkbox drawn as a tinted pill, for the two guardian flags.
function FlagToggle({ checked, onChange, tone, children }) {
  const on = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
  }[tone]
  const box = { emerald: 'bg-emerald-600', amber: 'bg-amber-600' }[tone]
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={clsx('flex items-center gap-2.5 h-10 px-3 rounded-xl border text-[13px] font-medium transition-colors',
        checked ? on : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
      <span className={clsx('w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0',
        checked ? `${box} text-white` : 'border-[1.5px] border-slate-300')}>
        {checked && <Check size={12} strokeWidth={3}/>}
      </span>
      {children}
    </button>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-[30px] h-[30px] rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
          <Icon size={16}/>
        </div>
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      </div>
      {children}
    </div>
  )
}

// ── Guardian card ─────────────────────────────────────────────
function GuardianCard({ g, index, errors, studentFirstName, studentAddress, onChange, onRemove }) {
  const set = (patch) => onChange({ ...g, ...patch })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const searchSeq = useRef(0)

  // Debounced, and a stale answer for an older query is dropped.
  useEffect(() => {
    if (g.mode !== 'link' || g.parent || !query.trim()) { setResults([]); return }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(() => {
      studentApi.searchParents(query.trim())
        .then(res => { if (seq === searchSeq.current) setResults(res.data.parents || []) })
        .catch(() => { if (seq === searchSeq.current) setResults([]) })
        .finally(() => { if (seq === searchSeq.current) setSearching(false) })
    }, 250)
    return () => clearTimeout(t)
  }, [query, g.mode, g.parent])

  const e = errors || {}
  const addressOnFile = g.parent?.home_address

  return (
    <div className={clsx('rounded-xl border p-4 space-y-3.5', Object.keys(e).length ? 'border-red-200' : 'border-slate-200')}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Guardian {index + 1}</p>
        <button type="button" onClick={onRemove} title="Remove this guardian"
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50">
          <Trash2 size={15}/>
        </button>
      </div>

      {/* How is this guardian added */}
      {!g.parent && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['link', 'Already has a parent account', 'Search by name or email and link them'],
            ['new', 'New guardian', 'Enter their details'],
          ].map(([mode, title, sub]) => (
            <button key={mode} type="button" onClick={() => { set({ mode }); setQuery('') }}
              className={clsx('flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors',
                g.mode === mode ? 'border-brand-500 border-[1.5px] bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
              <span className={clsx('w-4 h-4 rounded-full flex-shrink-0 bg-white',
                g.mode === mode ? 'border-[5px] border-brand-500' : 'border-[1.5px] border-slate-300')}/>
              <span className="flex flex-col">
                <span className={clsx('text-[13px] font-semibold', g.mode === mode ? 'text-brand-700' : 'text-slate-700')}>{title}</span>
                <span className="text-xs text-slate-500">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {e.mode && <p className="text-xs text-red-600">{e.mode}</p>}

      {/* Link an existing account */}
      {g.mode === 'link' && !g.parent && (
        <div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input className={clsx(inputCls(e.parent), 'pl-9')} placeholder="Search parent accounts by name or email"
              value={query} onChange={ev => setQuery(ev.target.value)} autoComplete="off" autoFocus/>
          </div>
          {e.parent && <p className="text-xs text-red-600 mt-1.5">{e.parent}</p>}
          {results.length > 0 && (
            <div className="mt-1.5 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              {results.map(p => (
                <button key={p.id} type="button"
                  onClick={() => set({ parent: p, same_address: !p.home_address })}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-brand-50 border-b border-slate-100 last:border-0">
                  <span className="w-[30px] h-[30px] rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{initials(p)}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 truncate">{p.full_name || fullName(p)}</span>
                    <span className="block text-xs text-slate-500 truncate">
                      {p.email} · guardian of {p.linked_students} student{String(p.linked_students) === '1' ? '' : 's'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && !searching && results.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">
              No parent account matches &ldquo;{query}&rdquo;.{' '}
              <button type="button" onClick={() => set({ mode: 'new' })} className="font-medium text-brand-500 hover:text-brand-600">Enter them as a new guardian</button>
            </p>
          )}
        </div>
      )}

      {g.parent && (
        <div className="flex items-center gap-3 p-3 bg-brand-50 border border-brand-100 rounded-xl">
          <span className="w-[38px] h-[38px] rounded-full bg-brand-100 text-brand-700 text-[13px] font-bold flex items-center justify-center flex-shrink-0">{initials(g.parent)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{g.parent.full_name || fullName(g.parent)}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 bg-white px-2 py-0.5 rounded-full">
                <Link2 size={11}/> Parent account
              </span>
            </div>
            <p className="text-xs text-slate-600 truncate">
              {[g.parent.email, g.parent.phone, `already guardian of ${g.parent.linked_students} student${String(g.parent.linked_students) === '1' ? '' : 's'}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" onClick={() => { set({ parent: null }); setQuery('') }}
            className="text-[13px] font-medium text-brand-500 hover:text-brand-600">Change</button>
        </div>
      )}

      {/* New guardian details */}
      {g.mode === 'new' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Surname" error={e.surname}>
            <input className={inputCls(e.surname)} value={g.surname} placeholder="Dela Cruz"
              onChange={ev => set({ surname: ev.target.value })} onBlur={ev => set({ surname: titleCase(ev.target.value) })}/>
          </Field>
          <Field label="First name" error={e.first_name}>
            <input className={inputCls(e.first_name)} value={g.first_name} placeholder="Rosa"
              onChange={ev => set({ first_name: ev.target.value })} onBlur={ev => set({ first_name: titleCase(ev.target.value) })}/>
          </Field>
          <Field label="Middle name" optional>
            <input className="input" value={g.middle_name}
              onChange={ev => set({ middle_name: ev.target.value })} onBlur={ev => set({ middle_name: titleCase(ev.target.value) })}/>
          </Field>
          <Field label="Relationship">
            <Select value={g.relationship} onChange={v => set({ relationship: v })}>
              {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Phone" error={e.phone}>
            <PhoneInput className={clsx(inputCls(e.phone), 'pr-10')} value={g.phone} onChange={v => set({ phone: v })}/>
          </Field>
          <Field label="Email" optional={!g.create_account} error={e.email}>
            <input type="email" className={inputCls(e.email)} value={g.email} placeholder="name@email.com"
              onChange={ev => set({ email: ev.target.value })}/>
          </Field>
        </div>
      )}

      {/* Relationship for a linked account sits beside its flags */}
      {g.parent && (
        <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] gap-3 items-end">
          <Field label="Relationship">
            <Select value={g.relationship} onChange={v => set({ relationship: v })}>
              {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <FlagToggle tone="emerald" checked={g.is_authorized_pickup} onChange={v => set({ is_authorized_pickup: v })}>Can pick up</FlagToggle>
            <FlagToggle tone="amber" checked={g.is_emergency_contact} onChange={v => set({ is_emergency_contact: v })}>Emergency contact</FlagToggle>
          </div>
        </div>
      )}

      {/* Address: only asked when the account has none on file */}
      {(g.mode === 'new' || (g.parent && !addressOnFile)) && (
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 rounded-xl cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded accent-brand-500" checked={g.same_address}
              onChange={ev => set({ same_address: ev.target.checked })}/>
            <span className="text-[13px] font-medium text-slate-700 flex-shrink-0">Lives at {studentFirstName ? `${studentFirstName}'s` : "the student's"} address</span>
            {g.same_address && studentAddress && <span className="text-xs text-slate-500 truncate">{studentAddress}</span>}
          </label>
          {!g.same_address && (
            <Field label="Home address" error={e.home_address}>
              <textarea className={clsx(inputCls(e.home_address), 'resize-none min-h-16')} value={g.home_address}
                placeholder="House No., Street, Barangay, Municipality/City, Province"
                onChange={ev => set({ home_address: ev.target.value })} onBlur={ev => set({ home_address: ev.target.value.trim() })}/>
            </Field>
          )}
        </div>
      )}

      {g.mode === 'new' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FlagToggle tone="emerald" checked={g.is_authorized_pickup} onChange={v => set({ is_authorized_pickup: v })}>Can pick up</FlagToggle>
            <FlagToggle tone="amber" checked={g.is_emergency_contact} onChange={v => set({ is_emergency_contact: v })}>Emergency contact</FlagToggle>
            <button type="button" onClick={() => set({ create_account: !g.create_account })}
              className="ml-auto flex items-center gap-2.5 text-right">
              <span className="flex flex-col">
                <span className="text-[13px] font-medium text-slate-700">Create a parent app login</span>
                <span className="text-xs text-slate-400">Needs an email and a password</span>
              </span>
              <span className={clsx('w-9 h-5 rounded-full p-0.5 flex transition-colors', g.create_account ? 'bg-brand-500 justify-end' : 'bg-slate-300')}>
                <span className="w-4 h-4 rounded-full bg-white shadow"/>
              </span>
            </button>
          </div>
          {g.create_account && (
            <Field label="App password" error={e.password} hint="They sign in to the parent app with their email and this password.">
              <div className="relative sm:max-w-xs">
                <input type={showPw ? 'text' : 'password'} className={clsx(inputCls(e.password), 'pr-10')}
                  placeholder="At least 8 characters" value={g.password} onChange={ev => set({ password: ev.target.value })}/>
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </Field>
          )}
        </>
      )}
    </div>
  )
}

// ── Wizard ────────────────────────────────────────────────────
export default function AddStudentWizard({ gradeOptions, onSubmit, onClose }) {
  const { user } = useAuth()
  const activeSY = user?.active_school_year
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    lrn: '', surname: '', first_name: '', middle_name: '', date_of_birth: '',
    gender: 'Male', home_address: '', grade_level: '', section: '',
  })
  const [guardians, setGuardians] = useState([emptyGuardian()])
  const [skipGuardians, setSkipGuardians] = useState(false)
  const [sections, setSections] = useState([])
  const [errors, setErrors] = useState({})
  const [guardianErrors, setGuardianErrors] = useState({})
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef(null)

  useEffect(() => {
    if (!form.grade_level) { setSections([]); return }
    curriculumApi.getSections({ grade_level: form.grade_level })
      .then(res => setSections(res.data.sections || []))
      .catch(() => setSections([]))
  }, [form.grade_level])

  // Each step starts at its top.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [step])

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v, ...(k === 'grade_level' ? { section: '' } : {}) }))
    if (errors[k]) setErrors(p => { const n = { ...p }; delete n[k]; return n })
  }
  const age = calcAge(form.date_of_birth)

  // ── Step 1 checks, including the LRN against VISTA ──
  const goToGuardians = async () => {
    const e = {}
    if (!/^\d{12}$/.test(form.lrn)) e.lrn = form.lrn ? `Has ${form.lrn.length} digits; an LRN is exactly 12` : 'Enter the 12-digit LRN'
    if (!form.surname.trim()) e.surname = 'Enter the surname'
    if (!form.first_name.trim()) e.first_name = 'Enter the first name'
    if (!form.date_of_birth) e.date_of_birth = 'Enter the date of birth'
    else if (new Date(form.date_of_birth) > new Date()) e.date_of_birth = "Can't be in the future"
    if (!form.home_address.trim()) e.home_address = 'Enter the home address'
    if (!form.grade_level) e.grade_level = 'Choose a grade level'
    if (!e.lrn) {
      setChecking(true)
      try {
        const res = await studentApi.checkLrns([form.lrn])
        if (res.data?.archived?.includes(form.lrn)) e.lrn = 'Belongs to an archived student. Restore them from Students → Archived instead'
        else if (res.data?.existing?.includes(form.lrn)) e.lrn = 'Already used by another student'
      } catch {
        // The API checks it again when the student is added.
      } finally { setChecking(false) }
    }
    setErrors(e)
    if (!Object.keys(e).length) setStep(1)
  }

  // ── Step 2 checks ──
  const guardianProblems = (g) => {
    const e = {}
    if (!g.mode) e.mode = 'Choose how to add this guardian'
    else if (g.mode === 'link') {
      if (!g.parent) e.parent = 'Pick a parent account from the search, or switch to New guardian'
    } else {
      if (!g.surname.trim()) e.surname = 'Enter the surname'
      if (!g.first_name.trim()) e.first_name = 'Enter the first name'
      if (!PHONE_RE.test(g.phone)) e.phone = 'Enter a mobile number'
      if (g.create_account) {
        if (!EMAIL_RE.test(g.email)) e.email = 'Needed for the app login'
        if (g.password.length < 8) e.password = 'At least 8 characters'
      } else if (g.email && !EMAIL_RE.test(g.email)) e.email = "This isn't a valid email"
    }
    const asksAddress = g.mode === 'new' || (g.parent && !g.parent.home_address)
    if (asksAddress && !g.same_address && !g.home_address.trim()) e.home_address = 'Enter their home address'
    return e
  }
  const goToReview = () => {
    const all = {}
    guardians.forEach(g => { const e = guardianProblems(g); if (Object.keys(e).length) all[g.key] = e })
    setGuardianErrors(all)
    if (!Object.keys(all).length) { setSkipGuardians(false); setStep(2) }
  }
  const skipToReview = () => { setSkipGuardians(true); setGuardianErrors({}); setStep(2) }

  const updateGuardian = (key, next) => {
    setGuardians(gs => gs.map(g => g.key === key ? next : g))
    if (guardianErrors[key]) setGuardianErrors(p => ({ ...p, [key]: guardianProblems(next) }))
  }

  const addressFor = (g) => g.parent?.home_address || (g.same_address ? form.home_address.trim() : g.home_address.trim())
  const savedGuardians = skipGuardians ? [] : guardians

  const submit = async () => {
    setSaving(true)
    try {
      await onSubmit({
        ...form,
        guardians: savedGuardians.map(g => g.parent
          ? {
              link_parent_id: g.parent.id,
              surname: g.parent.surname, first_name: g.parent.first_name, middle_name: g.parent.middle_name || '',
              relationship: g.relationship, home_address: addressFor(g),
              is_authorized_pickup: g.is_authorized_pickup, is_emergency_contact: g.is_emergency_contact,
            }
          : {
              surname: g.surname, first_name: g.first_name, middle_name: g.middle_name,
              relationship: g.relationship, phone: g.phone, email: g.email, home_address: addressFor(g),
              is_authorized_pickup: g.is_authorized_pickup, is_emergency_contact: g.is_emergency_contact,
              create_account: g.create_account, password: g.create_account ? g.password : '',
            }),
      })
    } catch {
      // The API client already toasts the reason; stay on Review so nothing typed is lost.
    } finally { setSaving(false) }
  }

  const studentName = fullName(form)

  return (
    <div className="flex flex-col flex-1 min-h-0 -mx-4 sm:-mx-6 -my-5">
      {/* Stepper */}
      <div className="flex items-center gap-3 sm:gap-3.5 px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-100 flex-shrink-0">
        {STEPS.map((label, i) => {
          const done = i < step
          const current = i === step
          return (
            <div key={label} className={clsx('flex items-center gap-3', i < STEPS.length - 1 && 'flex-1')}>
              <button type="button" disabled={!done} onClick={() => setStep(i)}
                className={clsx('flex items-center gap-2.5 text-left', done && 'hover:opacity-80')}>
                <span className={clsx('w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                  done ? 'bg-emerald-600 text-white' : current ? 'bg-brand-500 text-white' : 'bg-white border border-slate-300 text-slate-500')}>
                  {done ? <Check size={14} strokeWidth={3}/> : i + 1}
                </span>
                <span className="hidden sm:flex flex-col">
                  <span className={clsx('text-sm', current ? 'font-semibold text-slate-900' : done ? 'font-medium text-slate-700' : 'font-medium text-slate-500')}>{label}</span>
                  {i === 0 && done && studentName && (
                    <span className="text-xs text-slate-500 truncate max-w-[220px]">{studentName}{form.grade_level && ` · ${form.grade_level}`}</span>
                  )}
                </span>
              </button>
              {i < STEPS.length - 1 && <div className={clsx('flex-1 h-px', done ? 'bg-brand-200' : 'bg-slate-200')}/>}
            </div>
          )
        })}
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 sm:py-6">

        {/* ── Step 1: Student details ── */}
        {step === 0 && (
          <div className="space-y-6">
            <Section icon={User} title="Learner">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <Field label="LRN" error={errors.lrn} hint="12 digits, from the learner's report card">
                  <div className="relative">
                    <input className={clsx(inputCls(errors.lrn), 'font-mono tracking-wider pr-16')} inputMode="numeric"
                      maxLength={12} placeholder="136514250001" value={form.lrn}
                      onChange={e => set('lrn', e.target.value.replace(/\D/g, ''))}/>
                    <span className={clsx('absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-xs',
                      form.lrn.length === 12 ? 'text-emerald-700' : 'text-slate-400')}>
                      {form.lrn.length === 12 && <Check size={13} strokeWidth={3}/>}{form.lrn.length}/12
                    </span>
                  </div>
                </Field>
                <Field label="Date of birth" error={errors.date_of_birth}
                  hint={age !== null ? <span className="text-slate-600">{age} year{age === 1 ? '' : 's'} old</span> : null}>
                  <input type="date" className={inputCls(errors.date_of_birth)} value={form.date_of_birth}
                    max={format(new Date(), 'yyyy-MM-dd')} onChange={e => set('date_of_birth', e.target.value)}/>
                </Field>
                <Field label="Gender">
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl h-[42px]">
                    {['Male', 'Female'].map(g => (
                      <button key={g} type="button" onClick={() => set('gender', g)}
                        className={clsx('rounded-lg text-sm font-medium transition-colors',
                          form.gender === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                        {g}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <Field label="Surname" error={errors.surname}>
                  <input className={inputCls(errors.surname)} placeholder="Dela Cruz" value={form.surname}
                    onChange={e => set('surname', e.target.value)} onBlur={e => set('surname', titleCase(e.target.value))}/>
                </Field>
                <Field label="First name" error={errors.first_name}>
                  <input className={inputCls(errors.first_name)} placeholder="Juan Miguel" value={form.first_name}
                    onChange={e => set('first_name', e.target.value)} onBlur={e => set('first_name', titleCase(e.target.value))}/>
                </Field>
                <Field label="Middle name" optional>
                  <input className="input" placeholder="Santos" value={form.middle_name}
                    onChange={e => set('middle_name', e.target.value)} onBlur={e => set('middle_name', titleCase(e.target.value))}/>
                </Field>
              </div>
              <Field label="Home address" error={errors.home_address}>
                <textarea className={clsx(inputCls(errors.home_address), 'resize-none min-h-16')}
                  placeholder="House No., Street, Barangay, Municipality/City, Province" value={form.home_address}
                  onChange={e => set('home_address', e.target.value)} onBlur={e => set('home_address', e.target.value.trim())}/>
              </Field>
            </Section>

            <div className="h-px bg-slate-100"/>

            <Section icon={GraduationCap} title="Class">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-start">
                <Field label="Grade level" error={errors.grade_level}>
                  <Select value={form.grade_level} onChange={v => set('grade_level', v)} error={errors.grade_level}>
                    <option value="">Choose grade level</option>
                    {(gradeOptions || GRADE_LEVELS).map(g => <option key={g}>{g}</option>)}
                  </Select>
                </Field>
                <Field label="Section" optional hint={!form.grade_level ? 'Choose a grade level first' : !sections.length ? `No sections set up for ${form.grade_level}` : null}>
                  <Select value={form.section} onChange={v => set('section', v)} disabled={!form.grade_level || !sections.length}>
                    <option value="">No section yet</option>
                    {sections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </Select>
                </Field>
                {activeSY && (
                  <div className="flex gap-2 items-start px-3 py-2.5 sm:mt-[26px] bg-slate-50 rounded-xl">
                    <Info size={15} className="text-slate-500 mt-0.5 flex-shrink-0"/>
                    <p className="text-xs text-slate-600 leading-relaxed">Enrolled in <strong className="font-semibold">SY {activeSY}</strong> as soon as you add them.</p>
                  </div>
                )}
              </div>
            </Section>
          </div>
        )}

        {/* ── Step 2: Guardians ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <p className="text-[15px] font-semibold text-slate-900">Who looks after {form.first_name.trim() || 'this student'}?</p>
              <p className="text-[13px] text-slate-500">Add the people who can pick them up or be called in an emergency.</p>
            </div>
            {guardians.map((g, i) => (
              <GuardianCard key={g.key} g={g} index={i} errors={guardianErrors[g.key]}
                studentFirstName={form.first_name.trim()} studentAddress={form.home_address.trim()}
                onChange={next => updateGuardian(g.key, next)}
                onRemove={() => { setGuardians(gs => gs.filter(x => x.key !== g.key)); setGuardianErrors(p => { const n = { ...p }; delete n[g.key]; return n }) }}/>
            ))}
            <button type="button" onClick={() => setGuardians(gs => [...gs, emptyGuardian()])}
              className="w-full flex items-center justify-center gap-2 py-3 border-[1.5px] border-dashed border-slate-300 rounded-xl text-sm font-medium text-brand-500 hover:border-brand-400 hover:bg-brand-50/40">
              <Plus size={15}/> {guardians.length ? 'Add another guardian' : 'Add a guardian'}
            </button>
          </div>
        )}

        {/* ── Step 3: Review ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <p className="text-[15px] font-semibold text-slate-900">Check everything before adding</p>
              <p className="text-[13px] text-slate-500">Use Edit to go back to a step. Nothing is saved until you press Add student.</p>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 text-sm font-bold flex items-center justify-center flex-shrink-0">{initials(form)}</span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-slate-900 truncate">{studentName}</p>
                    <p className="text-xs text-slate-500">{[form.grade_level, form.section || 'No section yet', activeSY && `SY ${activeSY}`].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setStep(0)} className="flex items-center gap-1.5 text-[13px] font-medium text-brand-500 hover:text-brand-600">
                  <Pencil size={13}/> Edit
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3.5 px-4 py-3.5">
                <div><p className="text-xs text-slate-500">LRN</p><p className="font-mono text-[13px] text-slate-900">{form.lrn}</p></div>
                <div><p className="text-xs text-slate-500">Date of birth</p><p className="text-sm font-medium text-slate-900">{form.date_of_birth && format(new Date(`${form.date_of_birth}T00:00:00`), 'd MMM yyyy')}{age !== null && ` · ${age} yrs`}</p></div>
                <div><p className="text-xs text-slate-500">Gender</p><p className="text-sm font-medium text-slate-900">{form.gender}</p></div>
                <div><p className="text-xs text-slate-500">Enrolment</p><p className="text-sm font-medium text-slate-900">Enrolled</p></div>
                <div className="col-span-2 sm:col-span-4"><p className="text-xs text-slate-500">Home address</p><p className="text-sm font-medium text-slate-900">{form.home_address}</p></div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-900">Guardians <span className="font-normal text-slate-500">· {savedGuardians.length}</span></p>
                <button type="button" onClick={() => { setSkipGuardians(false); setStep(1) }} className="flex items-center gap-1.5 text-[13px] font-medium text-brand-500 hover:text-brand-600">
                  <Pencil size={13}/> Edit
                </button>
              </div>
              {savedGuardians.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-slate-500">
                  None yet. You can add them later with Manage Guardians on the student&apos;s row.
                </p>
              ) : savedGuardians.map(g => {
                const name = g.parent ? (g.parent.full_name || fullName(g.parent)) : fullName(g)
                const phone = g.parent ? g.parent.phone : g.phone
                return (
                  <div key={g.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_190px] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
                      {g.parent
                        ? <p className="flex items-center gap-1 text-xs text-brand-500"><Link2 size={11}/> Linked to parent account</p>
                        : <p className="text-xs text-slate-500">{g.create_account ? `New app login · ${g.email}` : 'Contact only · no app login'}</p>}
                    </div>
                    <p className="text-[13px] text-slate-600">{g.relationship}</p>
                    <p className="text-[13px] text-slate-600">{phone || '—'}</p>
                    <div className="flex gap-1.5">
                      {g.is_authorized_pickup && <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">Pickup</span>}
                      {g.is_emergency_contact && <span className="text-xs px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">Emergency</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-slate-100 flex-shrink-0">
        {step === 0 ? (
          <p className="text-xs text-slate-500">Every field is required unless marked optional.</p>
        ) : (
          <button type="button" onClick={() => setStep(s => s - 1)} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ChevronLeft size={15}/> Back
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {step === 0 && (
            <>
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button type="button" onClick={goToGuardians} disabled={checking} className="btn-primary disabled:opacity-60">
                {checking ? 'Checking…' : <>Next: Guardians <ArrowRight size={15}/></>}
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <button type="button" onClick={skipToReview} className="px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">
                Skip, add guardians later
              </button>
              <button type="button" onClick={goToReview} className="btn-primary">
                Next: Review <ArrowRight size={15}/>
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Cancel</button>
              <button type="button" onClick={submit} disabled={saving} className="btn-primary disabled:opacity-60">
                <Check size={15} strokeWidth={2.5}/> {saving ? 'Adding…' : 'Add student'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

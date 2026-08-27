import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Search, Plus, Filter, ChevronRight, Pencil, Trash2, Archive, ArchiveRestore,
  UserPlus, X, Users, ShieldCheck, Phone, Mail, Eye, EyeOff, Upload
} from 'lucide-react'
import { studentApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal, PhoneInput } from '../components/UI'
import BatchUploadModal from '../components/BatchUploadModal'
import { useAuth } from '../context/AuthContext'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { formatName, nameInitial, titleCase } from '../utils/nameHelper'
import { MANUAL_STATUSES, STUDENT_STATUSES, WITHDRAWN_STATUS_IDS, statusLabel, statusClasses } from '../utils/enrollment'

// ── School constants ──────────────────────────────────────────
const GRADE_LEVELS = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']

// Sections loaded dynamically from API per grade level

const RELATIONSHIPS = ['Mother','Father','Guardian','Grandmother','Grandfather','Aunt','Uncle','Sibling','Other']
const GENDER_STYLE  = { Male:'bg-blue-50 text-blue-700', Female:'bg-pink-50 text-pink-700', Other:'bg-purple-50 text-purple-700' }

const emptyGuardian = () => ({
  surname:'', first_name:'', middle_name:'', relationship:'Mother', email:'', phone:'',
  is_authorized_pickup:true, is_emergency_contact:false, create_account:false, password:'', home_address:'', link_parent_id:null
})

// ── Guardian Row ──────────────────────────────────────────────
function GuardianRow({ g, index, onChange, onRemove }) {
  const [showPw, setShowPw]         = useState(false)
  const [mode, setMode]             = useState('new')   // 'new' | 'link'
  const [searchQ, setSearchQ]       = useState('')
  const [searchResults, setResults] = useState([])
  const [searching, setSearching]   = useState(false)

  const set = (k, v) => onChange(index, { ...g, [k]: v })

  const handleSearch = async (q) => {
    setSearchQ(q)
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const res = await studentApi.searchParents(q)
      setResults(res.data.parents || [])
    } catch {} finally { setSearching(false) }
  }

  const selectParent = (p) => {
    onChange(index, {
      ...g,
      surname:     p.surname     || '',
      first_name:  p.first_name  || '',
      middle_name: p.middle_name || '',
      email:       p.email       || '',
      phone:       p.phone       || '',
      home_address: p.home_address || '',
      // link to existing account — no need to create a new one
      link_parent_id:  p.id,
      create_account:  false,
      password:        '',
    })
    setSearchQ(p.full_name || '')
    setResults([])
  }

  const switchMode = (m) => {
    setMode(m)
    setSearchQ('')
    setResults([])
    // Reset link fields when switching back to new
    if (m === 'new') {
      onChange(index, { ...g, link_parent_id: null })
    }
  }

  return (
    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Guardian {index+1}</p>
        <button type="button" onClick={() => onRemove(index)}
          className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <X size={14}/>
        </button>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-1 bg-white border border-slate-200 p-1 rounded-lg">
        {[['new','New Guardian'],['link','Link Existing Guardian']].map(([m,l]) => (
          <button key={m} type="button" onClick={() => switchMode(m)}
            className={clsx('flex-1 py-1.5 rounded-md text-xs font-medium transition-all',
              mode === m ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {l}
          </button>
        ))}
      </div>

      {/* Link existing parent search */}
      {mode === 'link' && (
        <div className="space-y-2">
          {/* Only show search when no guardian is linked yet */}
          {!g.link_parent_id && (
            <>
              <div className="relative">
                <input className="input text-sm py-2 pr-8"
                  placeholder="Search by name or email..."
                  value={searchQ}
                  onChange={e => handleSearch(e.target.value)}
                  autoComplete="off"/>
                {searching && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">⏳</span>
                )}
              </div>

              {searchResults.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  {searchResults.map(p => (
                    <button key={p.id} type="button" onClick={() => selectParent(p)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50 transition-colors text-left border-b border-slate-100 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                        {p.surname?.[0] || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{p.full_name}</p>
                        <p className="text-xs text-slate-400 truncate">{p.email} · {p.linked_students} student{p.linked_students !== '1' ? 's' : ''} linked</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {searchQ && !searching && searchResults.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-2">No existing guardians found for "{searchQ}"</p>
              )}
            </>
          )}

          {/* Show selected guardian with X to clear */}
          {g.link_parent_id && (
            <div className="flex items-center justify-between gap-2 p-2.5 bg-brand-50 border border-brand-200 rounded-lg">
              <span className="text-xs text-brand-700 font-medium">✓ Linked: {formatName(g)}</span>
              <button type="button"
                onClick={() => {
                  onChange(index, { ...g,
                    link_parent_id: null, surname: '', first_name: '', middle_name: '',
                    email: '', phone: '', home_address: ''
                  })
                  setSearchQ('')
                  setResults([])
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                title="Remove selected guardian">
                <X size={13}/>
              </button>
            </div>
          )}
        </div>
      )}
      {(mode === 'new' || g.link_parent_id) && (
      <div className={clsx('grid grid-cols-2 gap-2', g.link_parent_id && 'opacity-75')}>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Surname {!g.link_parent_id && '*'}</label>
          <input className={clsx('input text-sm py-2', g.link_parent_id && 'bg-slate-100 cursor-not-allowed')}
            placeholder="Santos" value={g.surname}
            onChange={e => !g.link_parent_id && set('surname', e.target.value)}
            onBlur={e => !g.link_parent_id && set('surname', titleCase(e.target.value))}
            readOnly={!!g.link_parent_id} required={!g.link_parent_id}/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">First Name {!g.link_parent_id && '*'}</label>
          <input className={clsx('input text-sm py-2', g.link_parent_id && 'bg-slate-100 cursor-not-allowed')}
            placeholder="Maria" value={g.first_name}
            onChange={e => !g.link_parent_id && set('first_name', e.target.value)}
            onBlur={e => !g.link_parent_id && set('first_name', titleCase(e.target.value))}
            readOnly={!!g.link_parent_id} required={!g.link_parent_id}/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Middle Name</label>
          <input className={clsx('input text-sm py-2', g.link_parent_id && 'bg-slate-100 cursor-not-allowed')}
            placeholder="Optional" value={g.middle_name}
            onChange={e => !g.link_parent_id && set('middle_name', e.target.value)}
            onBlur={e => !g.link_parent_id && set('middle_name', titleCase(e.target.value))}
            readOnly={!!g.link_parent_id}/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Relationship *</label>
          <select className="input text-sm py-2" value={g.relationship}
            onChange={e => set('relationship', e.target.value)}>
            {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Email{g.create_account && !g.link_parent_id ? ' *' : ''}
          </label>
          <input className={clsx('input text-sm py-2', g.link_parent_id && 'bg-slate-100 cursor-not-allowed')}
            type="email"
            placeholder={g.create_account && !g.link_parent_id ? 'Required for portal account' : 'parent@email.com'}
            value={g.email}
            onChange={e => !g.link_parent_id && set('email', e.target.value)}
            required={g.create_account && !g.link_parent_id}
            readOnly={!!g.link_parent_id}/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Phone {!g.link_parent_id && '*'}</label>
          <PhoneInput className={clsx('input text-sm py-2 pr-10', g.link_parent_id && 'bg-slate-100 cursor-not-allowed')}
            value={g.phone} onChange={v => !g.link_parent_id && set('phone', v)}
            required={!g.link_parent_id}/>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Home Address {!g.link_parent_id && '*'}
            {g.link_parent_id && !g.home_address && (
              <span className="text-amber-500 font-normal ml-1">(not on file for this parent)</span>
            )}
          </label>
          <textarea className={clsx('input text-sm resize-none min-h-14', g.link_parent_id && !g.home_address ? '' : g.link_parent_id ? 'bg-slate-100 cursor-not-allowed' : '')}
            placeholder="House No., Street, Barangay, Municipality/City, Province"
            value={g.home_address}
            onChange={e => set('home_address', e.target.value)}
            onBlur={e => set('home_address', e.target.value.trim())}
            readOnly={!!(g.link_parent_id && g.home_address)}
            required/>
        </div>
      </div>
      )}{/* end link_parent_id / new mode fields */}
      <div className="flex flex-wrap gap-4 pt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="rounded" checked={g.is_authorized_pickup}
            onChange={e => set('is_authorized_pickup', e.target.checked)}/>
          <span className="text-xs text-slate-600 font-medium">Authorized for pickup</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="rounded" checked={g.is_emergency_contact}
            onChange={e => set('is_emergency_contact', e.target.checked)}/>
          <span className="text-xs text-slate-600 font-medium">Emergency contact</span>
        </label>
        {!g.link_parent_id && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded" checked={g.create_account}
              onChange={e => set('create_account', e.target.checked)}/>
            <span className="text-xs text-slate-600 font-medium">Create parent portal account</span>
          </label>
        )}
        {g.link_parent_id && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
            ✓ Has parent portal account
          </span>
        )}
      </div>
      {g.create_account && !g.link_parent_id && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Account Password *</label>
          <div className="relative">
            <input className="input text-sm py-2 pr-9"
              type={showPw ? 'text' : 'password'} placeholder="Min. 8 characters"
              value={g.password} onChange={e => set('password', e.target.value)}/>
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">Guardian uses email + this password to log in to Parent Portal.</p>
        </div>
      )}
    </div>
  )
}

// ── Age calculator helper ─────────────────────────────────────
const calcAge = (dob) => {
  if (!dob) return ''
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? String(age) : ''
}

// ── Student Form (shared by create + edit) ────────────────────
function StudentForm({ initial, onSubmit, onClose, mode, gradeOptions }) {
  const [form, setForm] = useState({
    lrn:               initial?.lrn ?? '',
    surname:           initial?.surname ?? '',
    first_name:        initial?.first_name ?? '',
    middle_name:       initial?.middle_name ?? '',
    date_of_birth:     initial?.date_of_birth
                         ? format(new Date(initial.date_of_birth), 'yyyy-MM-dd') : '',
    gender:            initial?.gender ?? 'Male',
    grade_level:       initial?.grade_level ?? '',
    section:           initial?.section ?? '',
    profile_photo_url: initial?.profile_photo_url ?? '',
    home_address:      initial?.home_address      ?? '',
    age:               initial?.date_of_birth
                         ? calcAge(initial.date_of_birth) : '',
    guardians:         mode === 'create' ? [emptyGuardian()] : [],
  })
  const [saving, setSaving]       = useState(false)
  const [tab, setTab]             = useState('info')
  const [skipGuardians, setSkipGuardians] = useState(false)

  const [sections, setSections] = useState([])

  // Load sections from API whenever grade level changes
  useEffect(() => {
    if (!form.grade_level) { setSections([]); return }
    curriculumApi.getSections({ grade_level: form.grade_level })
      .then(res => setSections(res.data.sections || []))
      .catch(() => setSections([]))
  }, [form.grade_level])

  const set = (k, v) => setForm(p => {
    const n = { ...p, [k]: v }
    if (k === 'grade_level') n.section = ''
    if (k === 'date_of_birth') n.age = calcAge(v)
    return n
  })

  const addG    = () => setForm(p => ({ ...p, guardians: [...p.guardians, emptyGuardian()] }))
  const removeG = i  => setForm(p => ({ ...p, guardians: p.guardians.filter((_,j) => j !== i) }))
  const updateG = (i, v) => setForm(p => { const g=[...p.guardians]; g[i]=v; return {...p,guardians:g} })

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      if (mode === 'edit') delete payload.guardians
      if (skipGuardians) payload.guardians = []
      delete payload.age   // computed field, not stored in DB
      if (!payload.profile_photo_url) delete payload.profile_photo_url
      await onSubmit(payload)
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">
      {/* ── Sticky tab bar — never scrolls away ── */}
      {mode === 'create' && (
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-4 flex-shrink-0">
          {[['info','Student Info'],['guardians','Guardians / Parents']].map(([v,l]) => (
            <button key={v} type="button" onClick={() => setTab(v)}
              className={clsx('flex-1 py-2 rounded-lg text-sm font-medium transition-all',
                tab === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              {l}
            </button>
          ))}
        </div>
      )}
      {/* ── Scrollable content area ── */}
      <div className="overflow-y-auto flex-1 min-h-0 space-y-3 pr-1 pb-2">

      {(tab === 'info' || mode === 'edit') && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              LRN (Learner Reference Number) *
            </label>
            <input className="input font-mono tracking-widest"
              placeholder="12-digit LRN"
              maxLength={12}
              value={form.lrn}
              onChange={e => set('lrn', e.target.value.replace(/\D/g,''))}
              required/>
            <p className="text-xs text-slate-400 mt-1">
              Must be exactly 12 digits. Numbers only.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Surname *</label>
              <input className="input" placeholder="Dela Cruz"
                value={form.surname} onChange={e => set('surname', e.target.value)} onBlur={e => set('surname', titleCase(e.target.value))} required/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">First Name *</label>
              <input className="input" placeholder="Juan Miguel"
                value={form.first_name} onChange={e => set('first_name', e.target.value)} onBlur={e => set('first_name', titleCase(e.target.value))} required/>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Middle Name <span className="text-slate-400 font-normal">(optional)</span></label>
              <input className="input" placeholder="Santos"
                value={form.middle_name} onChange={e => set('middle_name', e.target.value)} onBlur={e => set('middle_name', titleCase(e.target.value))}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Date of Birth *</label>
              <input type="date" className="input" value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)} required/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Gender *</label>
              <select className="input" value={form.gender} onChange={e => set('gender', e.target.value)}>
                <option>Male</option><option>Female</option><option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Age</label>
              <div className="input bg-slate-50 text-slate-600 cursor-default select-none flex items-center gap-2">
                <span className="font-medium">{form.age ? `${form.age} years old` : '—'}</span>
                {!form.age && <span className="text-xs text-slate-400">Fill date of birth to calculate</span>}
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Home Address *</label>
              <textarea className="input resize-none min-h-16" placeholder="House No., Street, Barangay, Municipality/City, Province"
                value={form.home_address}
                onChange={e => set('home_address', e.target.value)}
                onBlur={e => set('home_address', e.target.value.trim())}
                required/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Grade Level *</label>
              <select className="input" value={form.grade_level}
                onChange={e => set('grade_level', e.target.value)} required>
                <option value="">— Select Grade —</option>
                {(gradeOptions || GRADE_LEVELS).map(g => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Section</label>
              <select className="input" value={form.section}
                onChange={e => set('section', e.target.value)}
                disabled={!form.grade_level}>
                <option value="">— Select Section —</option>
                {sections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              {!form.grade_level && <p className="text-xs text-slate-400 mt-1">Choose grade level first.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'guardians' && mode === 'create' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded accent-brand-500"
                checked={skipGuardians} onChange={e => setSkipGuardians(e.target.checked)}/>
              <span className="text-sm text-slate-600 font-medium cursor-pointer">Add guardians / parents later</span>
            </label>
            {!skipGuardians && (
              <button type="button" onClick={addG}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition-colors">
                <Plus size={13}/> Add Guardian
              </button>
            )}
          </div>

          {!skipGuardians && (
            <div>
              {form.guardians.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                  No guardians added.
                  <button type="button" onClick={addG} className="block mx-auto mt-2 text-brand-600 font-medium hover:text-brand-700">
                    + Add Guardian
                  </button>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {form.guardians.map((g,i) => (
                    <GuardianRow key={i} g={g} index={i} onChange={updateG} onRemove={removeG}/>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
      )}

      </div>{/* end scrollable area */}
      {/* ── Sticky action buttons — never scrolls away ── */}
      <div className="flex gap-3 pt-4 mt-2 border-t border-slate-100 flex-shrink-0">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
          {saving
            ? (mode === 'create' ? 'Adding...' : 'Saving...')
            : (mode === 'create' ? 'Add Student'  : 'Save Changes')}
        </button>
      </div>
    </form>
  )
}

// ── Guardian Manager (for edit modal) ────────────────────────
// ── Inline Guardian Form (shared by add + edit) ──────────────
function GuardianForm({ initial, mode, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    try { await onSubmit(form) } finally { setSaving(false) }
  }

  const isAdd = mode === 'add'
  const nameDisplay = formatName(form)

  return (
    <form onSubmit={handleSubmit}
      className={clsx('p-4 rounded-xl border space-y-3',
        isAdd ? 'bg-brand-50 border-brand-200' : 'bg-amber-50 border-amber-200'
      )}>
      <p className={clsx('text-xs font-semibold uppercase tracking-wide',
        isAdd ? 'text-brand-700' : 'text-amber-700'
      )}>
        {isAdd ? 'New Guardian' : 'Edit Guardian'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Surname *</label>
          <input className="input text-sm py-2" value={form.surname}
            onChange={e => set('surname', e.target.value)} onBlur={e => set('surname', titleCase(e.target.value))} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">First Name *</label>
          <input className="input text-sm py-2" value={form.first_name}
            onChange={e => set('first_name', e.target.value)} onBlur={e => set('first_name', titleCase(e.target.value))} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Middle Name</label>
          <input className="input text-sm py-2" placeholder="Optional" value={form.middle_name}
            onChange={e => set('middle_name', e.target.value)} onBlur={e => set('middle_name', titleCase(e.target.value))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Relationship *</label>
          <select className="input text-sm py-2" value={form.relationship}
            onChange={e => set('relationship', e.target.value)}>
            {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Email{form.create_account && !form.has_account ? ' *' : ''}
          </label>
          <input className="input text-sm py-2" type="email"
            placeholder={form.create_account && !form.has_account ? 'Required for portal account' : 'Optional'}
            value={form.email}
            onChange={e => set('email', e.target.value)}
            required={form.create_account && !form.has_account}
            readOnly={form.has_account}
            disabled={form.has_account}
          />
          {form.has_account && (
            <p className="text-xs text-slate-400 mt-1">Email cannot be changed once a portal account exists.</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Phone *</label>
          <PhoneInput className="input text-sm py-2 pr-10"
            value={form.phone} onChange={v => set('phone', v)} required />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Home Address *</label>
          <textarea className="input text-sm resize-none min-h-14" placeholder="House No., Street, Barangay, Municipality/City, Province"
            value={form.home_address}
            onChange={e => set('home_address', e.target.value)}
            onBlur={e => set('home_address', e.target.value.trim())}
            required/>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_authorized_pickup}
            onChange={e => set('is_authorized_pickup', e.target.checked)} />
          <span className="text-xs text-slate-600 font-medium">Authorized for pickup</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_emergency_contact ?? false}
            onChange={e => set('is_emergency_contact', e.target.checked)} />
          <span className="text-xs text-slate-600 font-medium">Emergency contact</span>
        </label>

        {/* Portal account — add mode: checkbox to create; edit mode: show status */}
        {isAdd ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.create_account}
              onChange={e => set('create_account', e.target.checked)} />
            <span className="text-xs text-slate-600 font-medium">Create parent portal account</span>
          </label>
        ) : form.has_account ? (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
            ✓ Has parent portal account
          </span>
        ) : (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.create_account ?? false}
              onChange={e => set('create_account', e.target.checked)} />
            <span className="text-xs text-slate-600 font-medium">Create parent portal account</span>
          </label>
        )}
      </div>

      {/* Password field when creating portal account */}
      {form.create_account && !form.has_account && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Account Password *</label>
          <div className="relative">
            <input className="input text-sm py-2 pr-9"
              type={showPw ? 'text' : 'password'} placeholder="Min. 8 characters"
              value={form.password} onChange={e => set('password', e.target.value)}
              required />
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">Guardian uses email + this password to log in.</p>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2 text-sm">
          {saving ? (isAdd ? 'Adding...' : 'Saving...') : (isAdd ? 'Add Guardian' : 'Save Changes')}
        </button>
      </div>
    </form>
  )
}

// ── Guardian Manager ──────────────────────────────────────────
function GuardianManager({ studentId, guardians, onRefresh }) {
  const [mode, setMode]       = useState(null)  // null | 'add' | guardianId (for edit)
  const closeForm = () => setMode(null)

  const handleAdd = async (form) => {
    await studentApi.addGuardian(studentId, form)
    toast.success('Guardian added.')
    closeForm()
    onRefresh()
  }

  const handleEdit = async (guardianId, form) => {
    await studentApi.updateGuardian(studentId, guardianId, form)
    toast.success('Guardian updated.')
    closeForm()
    onRefresh()
  }

  const handleRemove = async (guardianId, name) => {
    if (!window.confirm(`Remove ${name} as guardian?`)) return
    try {
      await studentApi.removeGuardian(studentId, guardianId)
      toast.success('Guardian removed.')
      onRefresh()
    } catch {}
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Guardians / Parents ({guardians.length})
        </p>
        {mode !== 'add' && (
          <button type="button" onClick={() => setMode('add')}
            className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition-colors">
            <UserPlus size={13} /> Add Guardian
          </button>
        )}
      </div>

      {guardians.length === 0 && mode !== 'add'
        ? <p className="text-sm text-slate-400 text-center py-4">No guardians linked yet.</p>
        : (
          <div className="space-y-2">
            {guardians.map(g => (
              <div key={g.id}>
                {mode === g.id ? (
                  <GuardianForm
                    key={`edit-${g.id}-${g.is_emergency_contact}-${g.is_authorized_pickup}`}
                    mode="edit"
                    initial={{ surname: g.surname, first_name: g.first_name, middle_name: g.middle_name || '', relationship: g.relationship, home_address: g.home_address || '',
                      email: g.email || '', phone: g.phone || '',
                      is_authorized_pickup: g.is_authorized_pickup, is_emergency_contact: g.is_emergency_contact ?? false,
                      has_account: g.has_account ?? false, create_account: false, password: '' }}
                    onSubmit={(form) => handleEdit(g.id, form)}
                    onCancel={closeForm}
                  />
                ) : (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700 flex-shrink-0">
                        {nameInitial(g)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{formatName(g)}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-500">{g.relationship}</span>
                          {g.email && <span className="flex items-center gap-1 text-xs text-slate-400 truncate"><Mail size={10}/>{g.email}</span>}
                          {g.phone && <span className="flex items-center gap-1 text-xs text-slate-400"><Phone size={10}/>{g.phone}</span>}
                          {g.is_authorized_pickup && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                              <ShieldCheck size={10}/> Pickup
                            </span>
                          )}
                          {g.is_emergency_contact && (
                            <span className="text-xs text-red-600 font-semibold">🚨 Emergency</span>
                          )}
                          {g.has_account && (
                            <span className="text-xs text-blue-500 font-medium">● Portal</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0 ml-2">
                      <button onClick={() => setMode(g.id)} title="Edit"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
                        <Pencil size={13}/>
                      </button>
                      <button onClick={() => handleRemove(g.id, formatName(g))} title="Remove"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      }

      {mode === 'add' && (
        <GuardianForm
          mode="add"
          initial={emptyGuardian()}
          onSubmit={handleAdd}
          onCancel={closeForm}
        />
      )}
    </div>
  )
}

// ── Archive / Restore Confirm ─────────────────────────────────
//
// One component for both directions, because they are the same act read
// backwards and splitting them duplicated the identity header and the button
// plumbing. This was "Delete Confirm", which named something the API never did:
// `is_active=FALSE` has always been a flag, not a deletion — what was missing was
// the way back, not the tombstone.
//
// The amber note stays, but says what actually happens rather than "deactivate":
// the learner leaves class lists, dashboards and risk scoring (every roster
// filters `is_active`), and the record itself is untouched.
function ArchiveConfirm({ student, archiving, onConfirm, onClose }) {
  const [busy, setBusy]     = useState(false)
  const [reason, setReason] = useState('')
  const handle = async () => {
    setBusy(true)
    try { await onConfirm(reason.trim() || undefined) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 rounded-xl flex items-center gap-3">
        <div className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center font-bold',
          archiving ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
        )}>
          {nameInitial(student)}
        </div>
        <div>
          <p className="font-semibold text-slate-800">{formatName(student)}</p>
          <p className="text-xs text-slate-500 font-mono">LRN: {student.lrn}</p>
        </div>
      </div>

      {archiving ? (
        <>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 space-y-1.5">
            <p>
              <strong>{formatName(student)}</strong> comes off the active roll and moves to
              the <strong>Archived</strong> tab. They drop off class lists, attendance,
              score entry and the dashboards.
            </p>
            <p className="text-xs">
              Nothing is deleted — grades, attendance and behaviour logs stay attached, and
              you can restore them from the Archived tab at any time.
            </p>
          </div>
          {/* If the learner simply left, enrolment status already says so and says it
              better. Point there rather than letting the archive absorb a fact that
              belongs in the record. */}
          <p className="text-xs text-slate-500">
            If they transferred out or dropped mid-year, set their <strong>enrolment
            status</strong> instead — that records what happened and keeps them on the
            roll until the year ends.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Reason <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input className="input" value={reason} maxLength={500}
              placeholder="e.g. Duplicate record, moved abroad..."
              onChange={e => setReason(e.target.value)}/>
          </div>
        </>
      ) : (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
          <strong>{formatName(student)}</strong> returns to the active roll with their record
          intact. Set their enrolment status and school year afterwards so they appear on the
          right class list.
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={handle} disabled={busy}
          className={clsx('flex-1 justify-center', archiving ? 'btn-danger' : 'btn-primary')}>
          {busy
            ? (archiving ? 'Archiving...' : 'Restoring...')
            : (archiving ? 'Archive Student' : 'Restore Student')}
        </button>
      </div>
    </div>
  )
}

// ── Enrolment Status ──────────────────────────────────────────
//
// Changing status here writes the active school year's enrolment record too, so
// the roster and the year-by-year history stay in step. Only a learner marked
// `enrolled` appears on a teacher's class list, which is why confirming a
// pending learner matters as much as recording one who left.
//
// Attendance only. 'Graduated' is a year-end outcome earned from results, so the
// Year-End Promotion wizard is the only thing that records one.
function StatusChange({ student, onConfirm, onClose }) {
  const [status, setStatus]   = useState(student.enrollment_status || 'enrolled')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving]   = useState(false)

  const leaving = WITHDRAWN_STATUS_IDS.includes(status)
  const unchanged = status === student.enrollment_status
  // A graduate's current standing is not on the list below, so nothing is
  // selected until the admin picks something — which would re-enrol them.
  const wasGraduated = student.enrollment_status === 'graduated'

  const handle = async () => {
    setSaving(true)
    try { await onConfirm({ status, remarks: remarks.trim() || undefined }) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 rounded-xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center font-bold text-brand-700">
          {nameInitial(student)}
        </div>
        <div>
          <p className="font-semibold text-slate-800">{formatName(student)}</p>
          <p className="text-xs text-slate-500">
            {student.grade_level}{student.section ? ` — ${student.section}` : ''} · LRN {student.lrn}
          </p>
        </div>
      </div>

      {wasGraduated && (
        <div className="p-3 bg-brand-50 border border-brand-200 rounded-xl text-xs text-brand-800">
          This learner is recorded as <strong>Graduated</strong> in Year-End Promotion. Graduation is not
          set here &mdash; choosing a status below would put them back on the school&rsquo;s books.
        </div>
      )}

      <div className="space-y-2">
        {MANUAL_STATUSES.map(st => (
          <label key={st.id}
            className={clsx(
              'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
              status === st.id ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
            )}>
            <input type="radio" name="enrollment-status" className="mt-0.5"
              checked={status === st.id} onChange={() => setStatus(st.id)}/>
            <span>
              <span className="block text-sm font-medium text-slate-800">{st.label}</span>
              <span className="block text-xs text-slate-500">{st.description}</span>
            </span>
          </label>
        ))}
      </div>

      {leaving && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Reason <span className="text-slate-400 font-normal">(optional, kept on the record)</span>
          </label>
          <input className="input" value={remarks} maxLength={500}
            onChange={e => setRemarks(e.target.value)}
            placeholder="e.g. Moved to Cebu"/>
        </div>
      )}

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        {status === 'enrolled'
          ? 'This learner will appear on their teachers’ class lists for attendance, score entry and competency ratings.'
          : 'This learner will be hidden from teachers’ class lists. Their grades, attendance and behavior logs are kept.'}
      </div>

      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={handle} disabled={saving || unchanged}
          className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? 'Saving...' : 'Save status'}
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function Students() {
  const { user, activeAssignments, isAnyAdmin, isSuperAdmin, isTeacher, gradeScope } = useAuth()
  const isAdmin  = isAnyAdmin
  const assignments = activeAssignments

  // Grade levels visible in the filter + Add/Edit form, scoped by admin role.
  // super_admin's gradeScope contains all grades, so this is a no-op for them.
  const scopedGrades = useMemo(
    () => (gradeScope?.length ? GRADE_LEVELS.filter(g => gradeScope.includes(g)) : GRADE_LEVELS),
    [gradeScope]
  )

  // Derive unique grade_level + section pairs from teacher assignments
  const teacherSections = useMemo(() => {
    const map = new Map()
    for (const a of assignments) {
      const key = `${a.grade_level}|||${a.section}`
      if (!map.has(key)) map.set(key, { grade_level: a.grade_level, section: a.section })
    }
    return [...map.values()].sort((a, b) => a.grade_level.localeCompare(b.grade_level) || a.section.localeCompare(b.section))
  }, [assignments])

  const [searchParams, setSearchParams] = useSearchParams()

  // Filters live in the URL so they survive navigation
  const search        = searchParams.get('q')       || ''
  const gradeFilter   = searchParams.get('grade')   || ''
  const sectionFilter = searchParams.get('section') || ''
  const statusFilter  = searchParams.get('status')  || ''
  // Active / Archived is its own axis, not a status — an archived learner still
  // carries the status they had when they came off the roll — so it gets its own
  // param and its own control, and the two stack.
  const showArchived  = searchParams.get('archived') === '1'
  // Teacher: combined section key
  const teacherSection = searchParams.get('ts') || ''

  const base = () => ({ q: search, grade: gradeFilter, section: sectionFilter, status: statusFilter, ts: teacherSection, archived: showArchived })
  const setSearch        = (v) => updateParams({ ...base(), q: v })
  const setGradeFilter   = (v) => updateParams({ ...base(), grade: v, section: '' })
  const setSectionFilter = (v) => updateParams({ ...base(), section: v })
  const setStatusFilter  = (v) => updateParams({ ...base(), status: v })
  const setShowArchived  = (v) => updateParams({ ...base(), archived: v })
  const setTeacherSection = (v) => updateParams({ q: search, grade: '', section: '', status: '', ts: v })

  const updateParams = (vals) => {
    const p = {}
    if (vals.q)        p.q        = vals.q
    if (vals.grade)    p.grade    = vals.grade
    if (vals.section)  p.section  = vals.section
    if (vals.status)   p.status   = vals.status
    if (vals.ts)       p.ts       = vals.ts
    if (vals.archived) p.archived = '1'
    setSearchParams(p, { replace: true })
  }

  // For teacher: auto-select first section if none selected
  useEffect(() => {
    if (isTeacher && !teacherSection && teacherSections.length > 0) {
      setTeacherSection(`${teacherSections[0].grade_level}|||${teacherSections[0].section}`)
    }
  }, [isTeacher, teacherSections])

  // Derive active grade/section for fetching
  const activeGrade = isTeacher ? (teacherSection.split('|||')[0] || '') : gradeFilter
  const activeSection = isTeacher ? (teacherSection.split('|||')[1] || '') : sectionFilter

  const [students, setStudents]     = useState([])
  const [byStatus, setByStatus]     = useState({})
  const [archivedCount, setArchivedCount] = useState(0)
  const [pagination, setPagination] = useState({ total:0, page:1, totalPages:1 })
  const [loading, setLoading]       = useState(true)
  const [filterSections, setFilterSections] = useState([])

  const [showCreate, setShowCreate]       = useState(false)
  const [showBatch, setShowBatch]         = useState(false)
  const [editTarget, setEditTarget]       = useState(null)
  const [editGuardians, setEditGuardians] = useState(null)
  // `{ student, archiving }` — one target for both directions of the same act.
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [statusTarget, setStatusTarget]   = useState(null)

  // Load sections for the filter bar when grade changes (admin only)
  useEffect(() => {
    if (isTeacher) return
    if (!gradeFilter) { setFilterSections([]); return }
    curriculumApi.getSections({ grade_level: gradeFilter })
      .then(res => setFilterSections(res.data.sections || []))
      .catch(() => setFilterSections([]))
  }, [gradeFilter, isTeacher])

  const fetchStudents = useCallback(async (page = 1) => {
    if (isTeacher && !teacherSection) return
    setLoading(true)
    try {
      const res = await studentApi.list({
        search,
        grade_level: activeGrade || undefined,
        section: activeSection || undefined,
        enrollment_status: statusFilter || undefined,
        archived: showArchived ? 'true' : undefined,
        page, limit: 20
      })
      setStudents(res.data.students)
      setByStatus(res.data.by_status || {})
      setArchivedCount(res.data.archived_count || 0)
      setPagination(res.data.pagination)
    } catch {} finally { setLoading(false) }
  }, [search, activeGrade, activeSection, statusFilter, showArchived, isTeacher, teacherSection])

  useEffect(() => {
    const t = setTimeout(() => fetchStudents(1), 300)
    return () => clearTimeout(t)
  }, [fetchStudents])

  // Grade level, section and status are the **active school year's** snapshot, and
  // three things outside this page rewrite them: activating a school year
  // (`rolloverStudents`), saving the active year on the Enrollment page, and the
  // promotion wizard. None of them is reachable from here, so a tab left open on
  // this page shows what was true when it loaded — which reads as the change not
  // having taken effect. Re-read on focus, the same pattern TeacherDashboard uses
  // for score-entry progress. `fetchStudents` already carries the current filters.
  useEffect(() => {
    const onFocus = () => fetchStudents(1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchStudents])

  const refreshGuardians = async () => {
    if (!editGuardians) return
    try {
      const res = await studentApi.get(editGuardians.student.id)
      setEditGuardians({ student: res.data.student })
    } catch {}
  }

  const handleCreate = async (data) => {
    await studentApi.create(data)
    toast.success(`${formatName(data)} added successfully!`)
    setShowCreate(false); fetchStudents()
  }

  const handleEdit = async (data) => {
    await studentApi.update(editTarget.id, data)
    toast.success('Student information updated.')
    setEditTarget(null); fetchStudents()
  }

  const handleStatusChange = async (payload) => {
    try {
      const res = await studentApi.setEnrollmentStatus(statusTarget.id, payload)
      toast.success(res.data.message)
      setStatusTarget(null); fetchStudents(pagination.page)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to change status.')
    }
  }

  const handleArchive = async (reason) => {
    const { student, archiving } = archiveTarget
    try {
      const res = await studentApi.setArchived(student.id, archiving, reason)
      toast.success(res.data.message)
      setArchiveTarget(null)
      // Both directions move the row out of the tab you are standing on, so the
      // page it was on can now be short — go back to page 1 rather than landing
      // on an empty last page.
      fetchStudents()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to update the archive.')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">
            {isTeacher
              ? `${pagination.total} students`
              : showArchived
                // The archive is not a roster, so an enrolled/pending breakdown of it
                // would describe standings nobody is holding any more.
                ? `${pagination.total} archived ${pagination.total === 1 ? 'student' : 'students'} · off the active roll, records intact`
                : [
                    `${byStatus.enrolled || 0} enrolled`,
                    byStatus.pending && `${byStatus.pending} pending`,
                    (byStatus.transferred_out || byStatus.dropped || byStatus.graduated) &&
                      `${(byStatus.transferred_out || 0) + (byStatus.dropped || 0) + (byStatus.graduated || 0)} left`,
                    archivedCount && `${archivedCount} archived`,
                  ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowBatch(true)} className="btn-secondary">
              <Upload size={16}/> Batch Upload
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus size={16}/> Add Student
            </button>
          </div>
        )}
      </div>

      {/* Active / Archived — admin only. Its own control rather than an option in
          the status select, because an archived learner still carries a status and
          merging the two axes would make each unable to filter the other. */}
      {isAdmin && (
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          {[
            { archived: false, label: 'Active',   count: null },
            { archived: true,  label: 'Archived', count: archivedCount },
          ].map(t => (
            <button key={t.label} onClick={() => setShowArchived(t.archived)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                showArchived === t.archived
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}>
              {t.archived && <Archive size={14}/>}
              {t.label}
              {/* Only the Archived tab carries a number: "Active 9" would restate
                  the count already sitting under the page title. */}
              {t.count > 0 && (
                <span className={clsx('text-xs px-1.5 py-0.5 rounded-full',
                  showArchived === t.archived ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-500')}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3 flex-wrap">
        {/* Section picker for teachers */}
        {isTeacher && (
          <div className="sm:w-56 min-w-0 flex-shrink-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Class</label>
            <select className="input truncate" value={teacherSection} onChange={e => setTeacherSection(e.target.value)}>
              {teacherSections.length === 0 && <option value="">No assigned sections</option>}
              {teacherSections.map(s => (
                <option key={`${s.grade_level}|||${s.section}`} value={`${s.grade_level}|||${s.section}`}>
                  {s.grade_level} — {s.section}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          {isTeacher && <label className="block text-xs font-medium text-slate-500 mb-1">Search</label>}
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input className="input pl-10" placeholder="Search by name or LRN..."
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
        </div>

        {/* Grade Level filter (admin only) */}
        {!isTeacher && (
          <div className="relative sm:w-48">
            <Filter size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
            <select className="input pl-9 appearance-none cursor-pointer"
              value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}>
              <option value="">All Grade Levels</option>
              {scopedGrades.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>
        )}

        {/* Section filter (admin only) — only shown when a grade is selected */}
        {!isTeacher && gradeFilter && (
          <div className="relative sm:w-44">
            <select
              className="input appearance-none cursor-pointer"
              value={sectionFilter}
              onChange={e => setSectionFilter(e.target.value)}
            >
              <option value="">All Sections</option>
              {filterSections.map(s => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Enrolment status (admin only) — teachers only ever see enrolled learners */}
        {isAdmin && (
          <div className="relative sm:w-44">
            <select className="input appearance-none cursor-pointer"
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {STUDENT_STATUSES.map(st => (
                <option key={st.id} value={st.id}>
                  {st.label}{byStatus[st.id] ? ` (${byStatus[st.id]})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? <LoadingSpinner/> : students.length === 0 ? (
          // An empty archive is a good state, not a failed search — offering
          // "Add First Student" there would answer a question nobody asked.
          showArchived ? (
            <EmptyState icon={Archive} title="Nothing archived"
              description="Learners you archive appear here, along with anyone the school year activation takes off the roll."
            />
          ) : (
            <EmptyState icon={Users} title="No students found"
              description="Try adjusting your search or filters."
              action={isAdmin && <button onClick={() => setShowCreate(true)} className="btn-primary">Add First Student</button>}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>LRN</th>
                    {!isTeacher && <th>Grade Level</th>}
                    {!isTeacher && <th>Section</th>}
                    {isAdmin && <th className="whitespace-nowrap">{showArchived ? 'Archived' : 'Status'}</th>}
                    <th>Gender</th>
                    {isAdmin && <th className="text-right pr-4">Actions</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {students.map(s => (
                    <tr key={s.id} className={clsx(showArchived && 'bg-slate-50/70')}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                            {s.profile_photo_url
                              ? <img src={s.profile_photo_url} className="w-full h-full rounded-full object-cover" alt=""/>
                              : <span className="text-brand-700 font-semibold text-sm">{nameInitial(s)}</span>
                            }
                          </div>
                          <p className="font-medium text-slate-800">{formatName(s)}</p>
                        </div>
                      </td>
                      <td>
                        <span className="font-mono text-xs text-slate-500 tracking-wider bg-slate-50 px-2 py-1 rounded-lg">
                          {s.lrn}
                        </span>
                      </td>
                      {!isTeacher && (
                        <td>
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">
                            {s.grade_level}
                          </span>
                        </td>
                      )}
                      {!isTeacher && <td className="text-sm text-slate-500">{s.section || '—'}</td>}
                      {isAdmin && (
                        <td>
                          {showArchived ? (
                            // The archive's own facts replace the status badge here.
                            // A learner off the roll is not "Pending" in any useful
                            // sense, and the question the tab raises is why they left.
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600 whitespace-nowrap">
                                <Archive size={11}/> Archived
                              </span>
                              <p className="text-[11px] text-slate-500 leading-tight">
                                {s.archived_reason || 'No reason recorded'}
                              </p>
                              <p className="text-[11px] text-slate-400 leading-tight">
                                {s.archived_at
                                  ? `${format(new Date(s.archived_at), 'd MMM yyyy')} · ${s.archived_by_name || 'automatic'}`
                                  : 'Date unknown'}
                              </p>
                            </div>
                          ) : isSuperAdmin ? (
                            <button onClick={() => setStatusTarget(s)} title="Change enrolment status"
                              className={clsx(
                                'px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap hover:ring-2 hover:ring-offset-1 hover:ring-brand-300 transition-all',
                                statusClasses(s.enrollment_status)
                              )}>
                              {statusLabel(s.enrollment_status)}
                            </button>
                          ) : (
                            <span title="Enrolment status is set by a super admin."
                              className={clsx(
                                'px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
                                statusClasses(s.enrollment_status)
                              )}>
                              {statusLabel(s.enrollment_status)}
                            </span>
                          )}
                        </td>
                      )}
                      <td>
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', GENDER_STYLE[s.gender] || 'bg-slate-100 text-slate-600')}>
                          {s.gender}
                        </span>
                      </td>
                      {isAdmin && (
                        <td>
                          {/* An archived row gets one action, not four. Editing a
                              learner or their guardians while they are off the roll
                              invites changes nobody will see; restoring first is the
                              honest order. */}
                          <div className="flex items-center gap-1 justify-start">
                            {showArchived ? (
                              <button onClick={() => setArchiveTarget({ student: s, archiving: false })}
                                title="Restore to the active roll"
                                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors whitespace-nowrap">
                                <ArchiveRestore size={14}/> Restore
                              </button>
                            ) : (
                              <>
                                <button onClick={() => setEditTarget(s)} title="Edit student info"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                                  <Pencil size={15}/>
                                </button>
                                <button
                                  title="Manage guardians"
                                  onClick={async () => {
                                    try {
                                      const res = await studentApi.get(s.id)
                                      setEditGuardians({ student: res.data.student })
                                    } catch {}
                                  }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                                  <UserPlus size={15}/>
                                </button>
                                <button onClick={() => setArchiveTarget({ student: s, archiving: true })}
                                  title="Archive student — takes them off the active roll, keeps the record"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                                  <Archive size={15}/>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                      <td>
                        <Link to={`/students/${s.id}`}
                          title="View student details"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors inline-flex">
                          <ChevronRight size={16}/>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} students
                </p>
                <div className="flex gap-2">
                  <button disabled={pagination.page <= 1}
                    onClick={() => fetchStudents(pagination.page - 1)}
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">← Prev</button>
                  <button disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchStudents(pagination.page + 1)}
                    className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add New Student" size="lg" selfScroll>
        <StudentForm mode="create" onSubmit={handleCreate} onClose={() => setShowCreate(false)} gradeOptions={scopedGrades}/>
      </Modal>

      <BatchUploadModal
        open={showBatch}
        onClose={() => setShowBatch(false)}
        onSuccess={() => fetchStudents()}
      />

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Student Information" size="lg" selfScroll>
        {editTarget && <StudentForm mode="edit" initial={editTarget} onSubmit={handleEdit} onClose={() => setEditTarget(null)} gradeOptions={scopedGrades}/>}
      </Modal>

      <Modal open={!!editGuardians} onClose={() => setEditGuardians(null)} title="Manage Guardians / Parents" size="lg">
        {editGuardians && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center font-bold text-brand-700">
                {nameInitial(editGuardians.student)}
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">{formatName(editGuardians.student)}</p>
                <p className="text-xs text-slate-500 font-mono">
                  LRN: {editGuardians.student.lrn} · {editGuardians.student.grade_level} {editGuardians.student.section}
                </p>
              </div>
            </div>
            <GuardianManager
              studentId={editGuardians.student.id}
              guardians={editGuardians.student.guardians || []}
              onRefresh={refreshGuardians}
            />
            <div className="pt-2 border-t border-slate-100">
              <button onClick={() => setEditGuardians(null)} className="btn-secondary w-full justify-center">Done</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!statusTarget} onClose={() => setStatusTarget(null)} title="Enrolment Status">
        {statusTarget && (
          <StatusChange student={statusTarget}
            onConfirm={handleStatusChange}
            onClose={() => setStatusTarget(null)}/>
        )}
      </Modal>

      <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)}
        title={archiveTarget?.archiving === false ? 'Restore Student' : 'Archive Student'}>
        {archiveTarget && (
          <ArchiveConfirm
            student={archiveTarget.student}
            archiving={archiveTarget.archiving}
            onConfirm={handleArchive}
            onClose={() => setArchiveTarget(null)}/>
        )}
      </Modal>
    </div>
  )
}
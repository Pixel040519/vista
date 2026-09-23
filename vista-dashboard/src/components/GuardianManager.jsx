import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Pencil, Phone, Mail, Home, Users, Check, Minus, Lock, Search,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Modal, PhoneInput } from './UI'
import { useGuardianEmailCheck, describeEmailCheck } from './GuardianEmailCheck'
import { studentApi } from '../api/client'
import { formatName, nameInitial, titleCase } from '../utils/nameHelper'
import {
  accessOf, accessClasses, accessLabel, accessShortLabel, accessDetail, canChangeEmail,
} from '../utils/parentAccess'

// Manage Guardians / Parents, as a list and a detail panel.
//
// It replaced a single column of rows that each carried four unlabelled icon
// buttons and expanded an edit form in place, pushing the rest of the list down.
// Here the list only selects; everything about one guardian — contact, what they
// may do for the learner, their app access — sits in labelled sections on the
// right, and every action is a button with words on it.

// Same list as AddStudentWizard.jsx and the batch upload.
const RELATIONSHIPS = ['Mother','Father','Guardian','Grandmother','Grandfather','Aunt','Uncle','Sibling','Other']

const sameAddress = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

const emptyForm = (student) => ({
  surname: '', first_name: '', middle_name: '', relationship: 'Mother',
  phone: '', email: '', home_address: '', same_address: !!student?.home_address,
  is_emergency_contact: false, invite: false,
})

const formFrom = (g, student) => ({
  surname: g.surname || '', first_name: g.first_name || '', middle_name: g.middle_name || '',
  relationship: g.relationship || 'Guardian', phone: g.phone || '', email: g.email || '',
  home_address: g.home_address || '',
  same_address: sameAddress(g.home_address, student?.home_address),
  is_emergency_contact: !!g.is_emergency_contact,
  invite: false,
})

// The other learners on a guardian's account, as one readable phrase. A scoped
// admin receives siblings outside their grade scope unnamed, so those are counted.
const otherLearnersText = (g) => {
  const list = g?.other_learners || []
  const named = list.filter(o => o.name).map(o => `${o.name} (${o.grade_level})`)
  const hidden = list.length - named.length
  if (hidden) named.push(`${hidden} learner${hidden === 1 ? '' : 's'} in another grade level`)
  return named.join(', ')
}

// A search result carries the account's own status; the list chip reads states.
const accountState = (status) => status === 'active' ? 'active' : status === 'revoked' ? 'revoked' : 'pending'

function Section({ title, children }) {
  return (
    <section className="space-y-2.5">
      <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{title}</h5>
      {children}
    </section>
  )
}

function Confirm({ open, title, children, confirmLabel, busy, onConfirm, onCancel }) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title} size="sm">
      <div className="space-y-4">
        <div className="text-sm text-slate-600 leading-relaxed space-y-2">{children}</div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger disabled:opacity-60">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function GuardianManager({ student, onRefresh, onClose }) {
  const guardians = student.guardians || []
  const learner = student.first_name || 'this learner'

  const [selectedId, setSelectedId] = useState(guardians[0]?.id ?? null)
  const [mode, setMode] = useState('view') // 'view' | 'edit' | 'add'
  const [form, setForm] = useState(() => emptyForm(student))
  const [baseline, setBaseline] = useState(form)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null) // { kind: 'revoke' | 'remove' }

  // Adding only: link a parent account that already exists, or enter someone new.
  // It starts unanswered, as in the Add Student wizard, so the form never
  // defaults down the wrong path — the usual mistake being a second, separate
  // entry for a parent whose account already covers this learner's sibling.
  const [addKind, setAddKind] = useState(null) // null | 'link' | 'new'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const searchSeq = useRef(0)

  // What saving this email would do, asked of the API when a field is left.
  // It never says whose an address is — see GuardianEmailCheck.jsx.
  const emailCheck = useGuardianEmailCheck(student.id)

  // Debounced, and an answer for an older query is dropped.
  useEffect(() => {
    if (mode !== 'add' || addKind !== 'link' || picked || !query.trim()) {
      setResults([]); setSearching(false); return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(() => {
      studentApi.searchParents(query.trim(), student.id)
        .then(res => { if (seq === searchSeq.current) setResults(res.data.parents || []) })
        .catch(() => { if (seq === searchSeq.current) setResults([]) })
        .finally(() => { if (seq === searchSeq.current) setSearching(false) })
    }, 250)
    return () => clearTimeout(t)
  }, [query, mode, addKind, picked, student.id])

  // Keep the selection meaningful across refreshes: a guardian that has just been
  // added is selected, and one that has just been removed hands over to the first.
  const knownIds = useRef(new Set(guardians.map(g => g.id)))
  useEffect(() => {
    const ids = guardians.map(g => g.id)
    const added = ids.find(id => !knownIds.current.has(id))
    knownIds.current = new Set(ids)
    if (added) { setSelectedId(added); return }
    if (!ids.includes(selectedId)) setSelectedId(ids[0] ?? null)
  }, [guardians]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = guardians.find(g => g.id === selectedId) || null
  const editing = mode === 'edit' || mode === 'add'
  const dirty = editing && (JSON.stringify(form) !== JSON.stringify(baseline) || (mode === 'add' && addKind !== null))
  const linking = mode === 'add' && addKind === 'link'
  const showNewFields = mode === 'edit' || (mode === 'add' && addKind === 'new')
  const canSubmitForm = mode === 'edit' ? dirty : (addKind === 'new' || (linking && !!picked))
  const set = (patch) => setForm(f => ({ ...f, ...patch }))

  const counts = useMemo(() => ({
    total: guardians.length,
    app: guardians.filter(g => accessOf(g).id === 'active').length,
  }), [guardians])

  const startEdit = () => {
    const f = formFrom(selected, student)
    setForm(f); setBaseline(f); setMode('edit'); emailCheck.reset()
  }
  const startAdd = () => {
    const f = emptyForm(student)
    setForm(f); setBaseline(f); setMode('add')
    setAddKind(null); setQuery(''); setPicked(null); setResults([]); emailCheck.reset()
  }
  const cancelEdit = () => setMode('view')

  // The server's message names what happened to portal access (invited, reissued,
  // restored, linked to an existing account), so it is shown verbatim.
  const run = async (request) => {
    const res = await request()
    toast.success(res.data?.message || 'Saved.', { duration: 6000 })
    await onRefresh()
  }

  const submit = async (e) => {
    e.preventDefault()

    // Linking: the account supplies name, email and mobile number, so the
    // payload carries only what belongs to this learner. The names are sent
    // because the schema requires them; the server copies them from the account.
    if (linking) {
      const home_address = picked.home_address
        || (form.same_address ? (student.home_address || '') : form.home_address.trim())
      setSaving(true)
      try {
        await run(() => studentApi.addGuardian(student.id, {
          link_parent_id: picked.id,
          surname: picked.surname, first_name: picked.first_name, middle_name: picked.middle_name || '',
          relationship: form.relationship,
          home_address,
          is_emergency_contact: form.is_emergency_contact,
        }))
        setMode('view')
      } catch { /* the API client already toasts the reason; keep the form */ }
      finally { setSaving(false) }
      return
    }
    const payload = {
      surname: titleCase(form.surname.trim()),
      first_name: titleCase(form.first_name.trim()),
      middle_name: titleCase(form.middle_name.trim()),
      relationship: form.relationship,
      phone: form.phone,
      home_address: form.same_address ? (student.home_address || '') : form.home_address.trim(),
      is_emergency_contact: form.is_emergency_contact,
    }
    // A locked address is left out entirely rather than resent, so an activated
    // account can never be touched by an edit to the guardian's name.
    const emailLocked = mode === 'edit' && !canChangeEmail(selected)
    if (!emailLocked) payload.email = form.email.trim()
    if (mode === 'add' || !selected?.has_account) payload.invite = form.invite

    setSaving(true)
    try {
      await run(() => mode === 'add'
        ? studentApi.addGuardian(student.id, payload)
        : studentApi.updateGuardian(student.id, selected.id, payload))
      setMode('view')
    } catch { /* the API client already toasts the reason; keep the form */ }
    finally { setSaving(false) }
  }

  const confirmAction = async () => {
    setBusy(true)
    try {
      if (confirm.kind === 'remove') await run(() => studentApi.removeGuardian(student.id, selected.id))
      setConfirm(null)
    } catch {} finally { setBusy(false) }
  }

  // Only the contact-only email field is checked: a linked guardian's email is
  // the account's own and follows its own rules.
  const checksEmail = mode === 'add' || !selected?.has_account
  const recheck = (patch = {}) => { if (checksEmail) emailCheck.check({ ...form, ...patch }) }
  const emailView = checksEmail ? describeEmailCheck(emailCheck.current(form)) : null

  const openConfirm = (kind) => setConfirm({ kind })

  return (
    // A fixed height on wider screens so the modal does not jump as guardians
    // with more or less to show are selected; each column scrolls on its own.
    <div className="flex flex-col flex-1 min-h-0 -mx-4 sm:-mx-6 -my-5 sm:h-[min(640px,calc(84vh_-_58px))]">
      {/* The learner these guardians belong to */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700 flex-shrink-0">
            {nameInitial(student)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{formatName(student)}</p>
            <p className="text-xs text-slate-500">
              <span className="font-mono">{student.lrn}</span> · {student.grade_level}{student.section ? ` · ${student.section}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span>{counts.total} guardian{counts.total === 1 ? '' : 's'}</span>
          <span>{counts.app} use{counts.app === 1 ? 's' : ''} the parent app</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto sm:overflow-hidden grid grid-cols-1 sm:grid-cols-[280px_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]">
        {/* ── List ───────────────────────────────────────────── */}
        <div className="bg-slate-50 border-b sm:border-b-0 sm:border-r border-slate-100 p-4 flex flex-col gap-3 sm:overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Guardians</span>
            <button type="button" onClick={startAdd} disabled={editing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-brand-600 hover:bg-brand-50 disabled:text-slate-400 disabled:hover:bg-white disabled:cursor-not-allowed">
              <Plus size={14}/> Add guardian
            </button>
          </div>

          {guardians.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">No guardians yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {guardians.map(g => {
                const state = accessOf(g).id
                const isSel = g.id === selectedId && mode !== 'add'
                const roles = [g.relationship, g.is_emergency_contact && 'Emergency'].filter(Boolean).join(' · ')
                return (
                  <button key={g.id} type="button" disabled={editing && !isSel}
                    aria-current={isSel ? 'true' : undefined}
                    onClick={() => { setSelectedId(g.id); setMode('view') }}
                    className={clsx('w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors',
                      isSel ? 'bg-white border-brand-200 ring-2 ring-brand-500/10' : 'border-transparent hover:bg-white',
                      editing && !isSel && 'opacity-50 cursor-not-allowed hover:bg-transparent')}>
                    <span className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                      isSel ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600')}>
                      {nameInitial(g)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 truncate">{formatName(g)}</span>
                      <span className={clsx('block text-xs truncate', isSel && mode === 'edit' ? 'text-amber-700 font-medium' : 'text-slate-500')}>
                        {isSel && mode === 'edit' ? (dirty ? 'Editing · unsaved changes' : 'Editing') : roles}
                      </span>
                    </span>
                    <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap', accessClasses(state))}>
                      {accessShortLabel(state)}
                    </span>
                  </button>
                )
              })}
              {mode === 'add' && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-brand-200 bg-white ring-2 ring-brand-500/10">
                  <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center"><Plus size={14}/></span>
                  <span className="text-sm font-semibold text-slate-900">New guardian</span>
                </div>
              )}
            </div>
          )}

          <p className="mt-auto text-xs leading-relaxed text-slate-500">
            {editing ? 'Save or cancel to switch to another guardian.' : 'Emergency contacts are listed first.'}
          </p>
        </div>

        {/* ── Detail / form ──────────────────────────────────── */}
        {editing ? (
          <form onSubmit={submit} className="flex flex-col min-h-0">
            <div className="flex-1 sm:overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
              <div>
                <h4 className="text-lg font-bold text-slate-900">{mode === 'add' ? 'Add a guardian' : 'Edit guardian'}</h4>
                {/* Only a contact-only guardian is this learner's alone. One with
                    an account is a person: their name and contact details belong
                    to that account, so a save reaches it and every learner on it.
                    Where there are others, the banner below names them and this
                    line stays out of its way. */}
                <p className="text-[13px] text-slate-500">
                  {mode === 'add'
                    ? `Someone who looks after ${learner}.`
                    : !selected?.has_account
                      ? `Changes apply to ${learner}’s record only.`
                      : (selected.other_learners || []).length === 0
                        ? 'Their name and contact details also update their parent app account.'
                        : ''}
                </p>
              </div>

              {mode === 'add' && (
                <Section title="How are they being added?">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      ['link', 'Already has a parent account', 'Search and link their existing account'],
                      ['new', 'New guardian', 'Enter their details'],
                    ].map(([kind, title, sub]) => (
                      <button key={kind} type="button" aria-pressed={addKind === kind}
                        onClick={() => { setAddKind(kind); setPicked(null); setQuery('') }}
                        className={clsx('flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors',
                          addKind === kind ? 'border-brand-500 border-[1.5px] bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
                        <span className={clsx('w-4 h-4 rounded-full flex-shrink-0 bg-white',
                          addKind === kind ? 'border-[5px] border-brand-500' : 'border-[1.5px] border-slate-300')}/>
                        <span className="flex flex-col">
                          <span className={clsx('text-[13px] font-semibold', addKind === kind ? 'text-brand-700' : 'text-slate-700')}>{title}</span>
                          <span className="text-xs text-slate-500">{sub}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Link when this parent already uses VISTA, for example for a sibling. One login then covers all their children.
                  </p>
                </Section>
              )}

              {linking && (
                <Section title="Parent account">
                  {picked ? (
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-brand-200 bg-brand-50/50">
                      <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {nameInitial(picked)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{formatName(picked)}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {picked.email} · guardian of {Number(picked.linked_students)} learner{Number(picked.linked_students) === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap', accessClasses(accountState(picked.account_status)))}>
                        {accessShortLabel(accountState(picked.account_status))}
                      </span>
                      <button type="button" onClick={() => setPicked(null)}
                        className="text-[13px] font-medium text-brand-600 hover:text-brand-700">Change</button>
                    </div>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-slate-700">Search parent accounts
                        <span className="relative block mt-1.5">
                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                          <input className="input pl-9" autoFocus value={query} placeholder="Name or email"
                            onChange={e => setQuery(e.target.value)}/>
                        </span>
                      </label>
                      {query.trim() && (
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                          {searching && results.length === 0 ? (
                            <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
                          ) : results.length === 0 ? (
                            <p className="px-3 py-3 text-sm text-slate-500">
                              No parent account matches “{query.trim()}”.{' '}
                              <button type="button" onClick={() => { setAddKind('new'); setQuery('') }}
                                className="font-medium text-brand-600 hover:text-brand-700">Enter them as a new guardian</button>
                            </p>
                          ) : results.map(p => (
                            <button key={p.id} type="button" disabled={p.already_linked}
                              onClick={() => { setPicked(p); setQuery('') }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-white">
                              <span className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                                p.already_linked ? 'bg-slate-100 text-slate-400' : 'bg-slate-200 text-slate-600')}>
                                {nameInitial(p)}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className={clsx('block text-sm font-medium truncate', p.already_linked ? 'text-slate-500' : 'text-slate-900')}>{formatName(p)}</span>
                                <span className="block text-xs text-slate-500 truncate">
                                  {p.already_linked
                                    ? `Already a guardian of ${learner}`
                                    : `${p.email} · guardian of ${Number(p.linked_students)} learner${Number(p.linked_students) === 1 ? '' : 's'}`}
                                </span>
                              </span>
                              <span className={clsx('text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap', accessClasses(accountState(p.account_status)))}>
                                {accessShortLabel(accountState(p.account_status))}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {picked && (
                    <>
                      <p className="text-xs text-slate-500">Name, email and mobile number come from their account.</p>
                      <label className="block text-sm font-medium text-slate-700 sm:max-w-xs">Relationship to {learner}
                        <select className="input mt-1.5" value={form.relationship} onChange={e => set({ relationship: e.target.value })}>
                          {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                        </select>
                      </label>
                      {picked.home_address ? (
                        <p className="text-xs text-slate-500">Home address on file: <span className="text-slate-700">{picked.home_address}</span></p>
                      ) : (
                        <>
                          {student.home_address && (
                            <label className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 rounded-xl cursor-pointer">
                              <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={form.same_address}
                                onChange={e => set({ same_address: e.target.checked })}/>
                              <span className="text-[13px] font-medium text-slate-700">Lives at {learner}’s address</span>
                              <span className="text-xs text-slate-500 truncate">{student.home_address}</span>
                            </label>
                          )}
                          {(!form.same_address || !student.home_address) && (
                            <label className="block text-sm font-medium text-slate-700">Home address
                              <textarea className="input mt-1.5 resize-none min-h-16" required value={form.home_address}
                                placeholder="House No., Street, Barangay, Municipality/City, Province"
                                onChange={e => set({ home_address: e.target.value })}/>
                            </label>
                          )}
                        </>
                      )}
                      <div className={clsx('rounded-xl border px-3.5 py-3 text-xs leading-relaxed',
                        picked.account_status === 'revoked' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600')}>
                        {picked.account_status === 'active' && <>{learner} will appear in their VISTA Parent app. No invitation is needed.</>}
                        {picked.account_status === 'pending' && <>Their account has not been activated yet. {learner} will appear once they activate it.</>}
                        {picked.account_status === 'revoked' && <>App access for this account is revoked. They won’t see {learner} in the app until access is restored.</>}
                      </div>
                    </>
                  )}
                </Section>
              )}

              {mode === 'edit' && selected?.has_account && (selected.other_learners || []).length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-xs leading-relaxed text-blue-800">
                  <p className="font-semibold text-blue-900">This parent’s account also covers {otherLearnersText(selected)}.</p>
                  <p className="mt-1">
                    {canChangeEmail(selected) ? 'Name, mobile number, email and home address' : 'Name, mobile number and home address'} are the parent’s own, so saving updates them there too.
                    Relationship and emergency contact apply to {learner} only.
                  </p>
                </div>
              )}

              {showNewFields && (<>
              <Section title="Name & relationship">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block text-sm font-medium text-slate-700">Surname
                    <input className="input mt-1.5" value={form.surname} required onChange={e => set({ surname: e.target.value })} onBlur={() => recheck()}/>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">First name
                    <input className="input mt-1.5" value={form.first_name} required onChange={e => set({ first_name: e.target.value })} onBlur={() => recheck()}/>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">Middle name <span className="text-xs font-normal text-slate-400">optional</span>
                    <input className="input mt-1.5" value={form.middle_name} onChange={e => set({ middle_name: e.target.value })}/>
                  </label>
                </div>
                <label className="block text-sm font-medium text-slate-700 sm:max-w-xs">Relationship to {learner}
                  <select className="input mt-1.5" value={form.relationship} onChange={e => set({ relationship: e.target.value })}>
                    {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </label>
              </Section>

              <Section title="Contact">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm font-medium text-slate-700">Mobile number
                    <PhoneInput className="input mt-1.5 pr-10" value={form.phone} required onChange={v => set({ phone: v })}/>
                  </label>
                  {/* A guardian with an account still shows their address here, so
                      Contact reads whole — but read-only: it is the account's
                      identity, and the one place it can be corrected (while the
                      parent has not activated) is the access section below. */}
                  {mode === 'edit' && selected?.has_account ? (
                    <label className="block text-sm font-medium text-slate-700">Registered Email Address
                      <input type="email" value={form.email} readOnly disabled
                        className="input mt-1.5 bg-slate-50 text-slate-500 cursor-not-allowed"/>
                      {canChangeEmail(selected) && (
                        <span className="block text-xs font-normal text-slate-500 mt-1.5">
                          Change it under Parent/Guardian Account Access below.
                        </span>
                      )}
                    </label>
                  ) : (
                    <label className="block text-sm font-medium text-slate-700">
                      {form.invite ? 'Registered Email Address' : 'Email'}{' '}
                      {!form.invite && <span className="text-xs font-normal text-slate-400">optional</span>}
                      <input type="email" value={form.email} required={form.invite}
                        className={clsx('input mt-1.5', emailView?.invalid && '!border-red-400 focus:!ring-red-500/20')}
                        aria-invalid={emailView?.invalid || undefined}
                        placeholder="name@email.com" onChange={e => set({ email: e.target.value })} onBlur={() => recheck()}/>
                      {emailView && (
                        <span className="block text-xs font-normal mt-1.5 leading-relaxed text-red-600">
                          {emailView.message}
                          {mode === 'add' && emailView.account && (
                            <>
                              {' '}
                              <button type="button" onClick={() => { setAddKind('link'); setPicked(emailView.account); emailCheck.reset() }}
                                className="font-medium text-brand-600 hover:text-brand-700 underline underline-offset-2">
                                Link that account instead
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </label>
                  )}
                </div>
                {student.home_address && (
                  <label className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 rounded-xl cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={form.same_address}
                      onChange={e => set({ same_address: e.target.checked })}/>
                    <span className="text-[13px] font-medium text-slate-700">Lives at {learner}’s address</span>
                    <span className="text-xs text-slate-500 truncate">{student.home_address}</span>
                  </label>
                )}
                {(!form.same_address || !student.home_address) && (
                  <label className="block text-sm font-medium text-slate-700">Home address
                    <textarea className="input mt-1.5 resize-none min-h-16" required value={form.home_address}
                      placeholder="House No., Street, Barangay, Municipality/City, Province"
                      onChange={e => set({ home_address: e.target.value })}/>
                  </label>
                )}
              </Section>
              </>)}

              {(showNewFields || (linking && picked)) && (
              <Section title="Emergency contact">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className={clsx('flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer',
                    form.is_emergency_contact ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-700')}>
                    <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={form.is_emergency_contact}
                      onChange={e => set({ is_emergency_contact: e.target.checked })}/>
                    <span className="text-sm font-medium">Emergency contact</span>
                  </label>
                </div>
              </Section>
              )}

              {showNewFields && (
              <Section title="Parent/Guardian Account Access">
                {mode === 'add' || !selected?.has_account ? (
                  <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={form.invite}
                        onChange={e => set({ invite: e.target.checked })}/>
                      <span className="text-sm font-medium text-slate-800">Add Invitation</span>
                    </label>
                    <p className="text-xs leading-relaxed text-slate-500">
                      {form.invite
                        ? <>The email above is authorized for the VISTA Parent app. <strong className="font-semibold text-slate-700">No message is sent now</strong> — they enter this email in the app, receive a one-time code and create their own password.</>
                        : 'Leave off for a contact-only guardian. You can tick this later from Edit.'}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500"><Lock size={12}/> VISTA never asks you to set or view a parent’s password.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-semibold', accessClasses(accessOf(selected).id))}>
                        {accessLabel(accessOf(selected).id)}
                      </span>
                      <span className="text-xs text-slate-500">{accessDetail(selected)}</span>
                    </div>
                    {canChangeEmail(selected) ? (
                      <label className="block text-sm font-medium text-slate-700">Registered Email Address
                        <input type="email" className="input mt-1.5" value={form.email} required
                          onChange={e => set({ email: e.target.value })}/>
                        <span className="block text-xs font-normal text-slate-500 mt-1.5">
                          Can still be corrected because {selected.first_name || 'they'} never activated. Saving a new address cancels any code already requested.
                        </span>
                      </label>
                    ) : (
                      <div>
                        <p className="text-xs text-slate-500">Registered Email Address</p>
                        <p className="text-sm text-slate-900 mt-0.5">{selected.email}</p>
                        <p className="text-xs text-slate-500 mt-1.5">
                          Activated with this address, so it can’t be changed here.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Section>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-slate-100 bg-white">
              <span className="text-xs font-medium text-amber-700">{dirty ? 'Unsaved changes' : ''}</span>
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={cancelEdit} disabled={saving} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving || !canSubmitForm || !!emailView?.invalid} className="btn-primary disabled:opacity-60">
                  {saving ? 'Saving…' : linking ? 'Link guardian' : mode === 'add' ? 'Add guardian' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
        ) : selected ? (
          // One quiet page: three light sections with no boxes around them.
          // The Parent app section only REPORTS the state — reissuing, restoring
          // and revoking moved to Account Management -> Parents, because they act
          // on the account and reach every child on it, which is not a fact this
          // learner's page is in a position to present.
          <div className="flex flex-col min-h-0">
            <div className="flex-1 sm:overflow-y-auto px-5 sm:px-8 py-6 space-y-7">
              <div className="flex items-center gap-3.5">
                <span className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-semibold flex-shrink-0">
                  {nameInitial(selected)}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xl font-bold text-slate-900 truncate">{formatName(selected)}</h4>
                  <p className="text-sm text-slate-500">{selected.relationship}</p>
                </div>
                <button type="button" onClick={startEdit} className="btn-secondary !py-2">
                  <Pencil size={15}/> Edit
                </button>
              </div>

              <Section title="Contact">
                <div className="space-y-3">
                  <ContactLine icon={Phone}>
                    {selected.phone ? <span className="font-mono">{selected.phone}</span> : <span className="text-slate-500">No mobile number</span>}
                  </ContactLine>
                  <ContactLine icon={Mail}>
                    {selected.email || <span className="text-slate-500">No email on file</span>}
                  </ContactLine>
                  <ContactLine icon={Home}>
                    {selected.home_address || <span className="text-slate-500">No home address</span>}
                  </ContactLine>
                  {selected.has_account && (selected.other_learners || []).length > 0 && (
                    <ContactLine icon={Users}>Also guardian of {otherLearnersText(selected)}</ContactLine>
                  )}
                </div>
              </Section>

              <Section title={`For ${learner}`}>
                <div className="space-y-2.5">
                  <Permission on={selected.is_emergency_contact}>
                    {selected.is_emergency_contact ? 'Emergency contact' : 'Not an emergency contact'}
                  </Permission>
                </div>
              </Section>

              <Section title="Parent app">
                <AccessStatus guardian={selected}/>
              </Section>
            </div>

            <div className="px-5 sm:px-8 py-3 border-t border-slate-100">
              <button type="button" onClick={() => openConfirm('remove')}
                className="text-[13px] font-medium text-red-700 hover:text-red-800">
                Remove as {learner}’s guardian
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center gap-2 p-10">
            <p className="text-sm font-semibold text-slate-700">No guardians yet</p>
            <p className="text-sm text-slate-500 max-w-xs">Add the people who can pick {learner} up or be called in an emergency.</p>
            <button type="button" onClick={startAdd} className="btn-primary mt-2"><Plus size={15}/> Add guardian</button>
          </div>
        )}
      </div>

      <div className="flex justify-end px-4 sm:px-6 py-3 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary">Done</button>
      </div>

      {selected && (
        <>
          <Confirm open={confirm?.kind === 'remove'} title="Remove guardian?" confirmLabel="Remove guardian"
            busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
            <p><strong className="text-slate-800">{formatName(selected)}</strong> will no longer be listed as {learner}’s guardian and cannot pick them up.</p>
            {selected.has_account && <p>If {learner} is the only child on their app account, that account is deleted too.</p>}
          </Confirm>
        </>
      )}
    </div>
  )
}

function ContactLine({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-3 text-sm leading-relaxed text-slate-900">
      <Icon size={16} className="text-slate-400 mt-0.5 flex-shrink-0" aria-hidden="true"/>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Permission({ on, children }) {
  return (
    <div className={clsx('flex items-center gap-3 text-sm', on ? 'text-slate-900' : 'text-slate-500')}>
      <span className={clsx('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
        on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}>
        {on ? <Check size={14} strokeWidth={2.5}/> : <Minus size={14} strokeWidth={2.5}/>}
      </span>
      {children}
    </div>
  )
}

// Status and email, reported and not acted on.
//
// The "Manage access" menu that used to live here is gone: re-issuing,
// restoring and revoking act on the ACCOUNT, so they reach every child on it —
// a scope this learner's page cannot show and should not decide from. They are
// in Account Management -> Parents, which lists the account with all of its
// children. What stays here is granting access to a guardian who has none,
// because that belongs to the guardian being entered rather than to an account
// that already exists, and it is the only path to it: a contact-only guardian
// has no `users` row, so the Parents tab cannot list them.
function AccessStatus({ guardian: g }) {
  const state = accessOf(g).id
  const detail = state === 'none'
    ? (g.email ? 'Not invited to the parent app' : 'Add an email with Edit to invite them')
    : accessDetail(g)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-[13px] font-medium whitespace-nowrap', accessClasses(state))}>
          {accessLabel(state)}
        </span>
        <span className="flex-1 min-w-0 text-sm text-slate-600 truncate">{state === 'none' ? '' : g.email}</span>
      </div>
      {detail && <p className="text-[13px] text-slate-500">{detail}</p>}
      {state !== 'none' && (
        <p className="text-[13px] text-slate-500">
          Re-issue, restore or revoke this account in Account Management &rarr; Parents — it covers every child on it.
        </p>
      )}
    </div>
  )
}

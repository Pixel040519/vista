import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, MoreHorizontal, X, Plus, Info, Phone, Mail, Home } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Modal, PhoneInput } from './UI'
import { useGuardianEmailCheck, describeEmailCheck } from './GuardianEmailCheck'
import { studentApi } from '../api/client'
import {
  accessOf, accessClasses, accessLabel, accessDetail, grantLabel, canInvite, canRevoke,
} from '../utils/parentAccess'

// The Parents tab of Account Management — Version A of the design.
//
// It is a roster, the same shape as Teachers, Admins and Guards: search, state
// chips, one table, a per-row Manage access menu. Everything it writes goes
// through an endpoint that already existed, so this is a second ENTRY POINT to
// each rule and never a second rule: `PUT /guardians/:gid` for the person's own
// details (which fans out to every learner on the account and to `users`),
// `POST /guardians` with `link_parent_id` to attach a learner, and the
// invitation routes for access.
//
// What it owns that a learner's page cannot: every account at once, the whole
// of one account — all its children, not just the learner you came from — and
// therefore the access actions, which reach every one of those children.

// Same list as GuardianManager.jsx, AddStudentWizard.jsx and the batch upload.
const RELATIONSHIPS = ['Mother','Father','Guardian','Grandmother','Grandfather','Aunt','Uncle','Sibling','Other']

// The five derived states, in the order an admin works through them: the ones
// needing attention first, the settled ones last.
const STATES = [
  { id: '',           label: 'All'                   },
  { id: 'active',     label: 'Active'                },
  { id: 'pending',    label: 'Pending Activation'    },
  { id: 'in_progress',label: 'Activation In Progress'},
  { id: 'expired',    label: 'Expired'               },
  { id: 'revoked',    label: 'Revoked'               },
]

const childName = (c) => `${c.surname}, ${c.first_name}`
const gradeShort = (g) => (g === 'Kinder' ? 'Kinder' : String(g || '').replace('Grade ', 'G'))
// Two letters for the avatar. `nameInitial()` in utils/nameHelper.js gives one,
// which reads as an abbreviation of nothing next to a "Surname, First" label.
const initials = (p) =>
  `${(p.surname || '')[0] || ''}${(p.first_name || '')[0] || ''}`.toUpperCase() || '?'

export default function ParentAccounts({ createOpen, onCloseCreate, onCountChange }) {
  const [parents, setParents]   = useState([])
  const [summary, setSummary]   = useState({})
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [state, setState]       = useState('')
  const [selected, setSelected] = useState(null)   // the account in the panel
  const [menuFor, setMenuFor]   = useState(null)   // account id whose menu is open

  const fetchParents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await studentApi.listParents({ search, state, limit: 100 })
      setParents(res.data.parents || [])
      setSummary(res.data.summary || {})
      setTotal(res.data.total || 0)
      onCountChange?.(res.data.all_total || 0)
    } catch { /* interceptor toasts */ }
    setLoading(false)
  }, [search, state, onCountChange])

  // Debounced, like the Teachers and Admins tabs.
  useEffect(() => {
    const t = setTimeout(fetchParents, 300)
    return () => clearTimeout(t)
  }, [fetchParents])

  // The open menu belongs to a row; anything that changes the rows under it
  // closes it, or it would hang over a different account than it was opened on.
  useEffect(() => { setMenuFor(null) }, [parents])
  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    const esc = (e) => { if (e.key === 'Escape') setMenuFor(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', esc) }
  }, [menuFor])

  // The panel renders a copy of the row, so a refetch has to hand it the new
  // one — otherwise adding a child leaves the list correct and the panel still
  // showing what was true before the save.
  useEffect(() => {
    if (!selected) return
    const fresh = parents.find(p => p.id === selected.id)
    if (fresh && fresh !== selected) setSelected(fresh)
  }, [parents]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10"
            placeholder="Search by parent name, email, or the learner they look after"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATES
            .map(s => ({
              ...s,
              n: s.id ? (summary[s.id] || 0) : Object.values(summary).reduce((a, b) => a + b, 0),
            }))
            // A state nobody is in is not a filter worth offering. Two chips are
            // never dropped, both for the reason the Enrollment page found the
            // hard way: **All**, which is how you get back, and the **selected**
            // one — which renders at 0 if it has to, or choosing a state whose
            // last account just changed would hide the control still filtering
            // the list, leaving an empty table that reads as "no parents".
            .filter(s => !s.id || s.n > 0 || state === s.id)
            .map(({ n, ...s }) => (
              <button key={s.id || 'all'} onClick={() => setState(s.id)}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                  state === s.id
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                )}>
                {s.label} <span className="opacity-70">{n}</span>
              </button>
            ))}
        </div>
      </div>

      {/* Roster */}
      <div className="card overflow-visible">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Parent</th>
                <th>Looks after</th>
                <th>Parent app access</th>
                <th>Registered email</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">Loading parent accounts…</td></tr>
              )}
              {!loading && !parents.length && (
                <tr><td colSpan={5} className="py-12 text-center">
                  <p className="text-sm text-slate-500">
                    {search || state ? 'No parent accounts match these filters.' : 'No parent accounts yet.'}
                  </p>
                  {(search || state) && (
                    <button onClick={() => { setSearch(''); setState('') }}
                      className="mt-2 text-sm font-semibold text-brand-600">Clear filters</button>
                  )}
                </td></tr>
              )}
              {!loading && parents.map((p) => {
                const access = accessOf(p)
                return (
                  // `!` is required: `.table-base tbody tr:hover` in index.css is
                  // a class plus two elements, so it outranks a bare utility and
                  // a plain `hover:bg-…` here silently does nothing — the same
                  // specificity trap as `!text-center` on a table header. The
                  // brand tint is stronger than the default slate-50/60 on
                  // purpose: these rows open a panel, so the hover has to read
                  // as "clickable" rather than as a faint stripe.
                  <tr key={p.id} className="hover:!bg-brand-50 cursor-pointer transition-colors"
                    onClick={() => setSelected(p)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 shrink-0 rounded-full bg-brand-50 text-brand-700 grid place-items-center text-xs font-bold">
                          {initials(p)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{p.surname}, {p.first_name}</div>
                          <div className="text-xs text-slate-500">{p.phone || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {p.children.map(c => (
                          <span key={c.guardian_id}
                            className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                            {childName(c)} · {gradeShort(c.grade_level)}
                          </span>
                        ))}
                        {p.other_children > 0 && (
                          <span className="px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-500 text-xs"
                            title="This account also covers learners outside your grade levels">
                            +{p.other_children} outside your grades
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={clsx('inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-semibold border', accessClasses(access.id))}>
                        {accessLabel(access.id)}
                      </span>
                      <div className="text-xs text-slate-500 mt-1">{accessDetail(p)}</div>
                    </td>
                    <td className="text-sm text-slate-700">{p.email}</td>
                    <td className="relative text-right" onClick={e => e.stopPropagation()}>
                      <button
                        aria-label={`Manage access for ${p.surname}, ${p.first_name}`}
                        onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === p.id ? null : p.id) }}
                        className="w-8 h-8 grid place-items-center rounded-lg border border-slate-200 hover:bg-slate-50">
                        <MoreHorizontal size={16} className="text-slate-600" />
                      </button>
                      {menuFor === p.id && (
                        <AccessMenu parent={p} onDone={() => { setMenuFor(null); fetchParents() }} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && !!parents.length && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Showing {parents.length} of {total} account{total === 1 ? '' : 's'}</span>
          <span>No password is ever set or shown here — a parent chooses their own in the VISTA Parent app.</span>
        </div>
      )}

      {selected && (
        <ParentPanel parent={selected} onClose={() => setSelected(null)}
          onChanged={fetchParents} />
      )}

      {createOpen && (
        <AddParentModal onClose={onCloseCreate}
          onCreated={() => { onCloseCreate(); fetchParents() }} />
      )}
    </div>
  )
}

/* ── Manage access ────────────────────────────────────────────────────────
 * Only the actions the state allows, each with a line saying what it does.
 * Reissue and Restore are the same endpoint — `grantLabel()` decides which
 * word, because a revoked account that already holds a password is being
 * switched back on, not re-invited.
 */
function AccessMenu({ parent, onDone }) {
  const [busy, setBusy] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const access = accessOf(parent)
  // Access is per account, so any child's row reaches it. A scoped admin is
  // only ever handed in-scope children, which is what the API's own scope
  // check on that learner then accepts.
  const anchor = parent.children[0]
  const kids = parent.children.length + (parent.other_children || 0)

  const run = async (fn, done) => {
    setBusy(true)
    try {
      const res = await fn()
      toast.success(res.data?.message || done, { duration: 6000 })
      onDone()
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  return (
    <>
      <div onClick={e => e.stopPropagation()}
        className="absolute right-4 top-full z-20 mt-1 w-80 p-1.5 text-left bg-white border border-slate-200 rounded-2xl shadow-xl">
        <div className="px-2.5 pt-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Manage access
        </div>
        {canInvite(access.id) && (
          <button disabled={busy}
            onClick={() => run(
              () => studentApi.inviteGuardian(anchor.student_id, anchor.guardian_id),
              'Invitation issued.'
            )}
            className="block w-full px-2.5 py-2 text-left rounded-xl hover:bg-slate-50 disabled:opacity-50">
            <span className="block text-sm font-semibold text-slate-900">{grantLabel(parent)}</span>
            <span className="block mt-0.5 text-[11.5px] leading-snug text-slate-500">
              {access.id === 'revoked'
                ? 'Switches the account back on. They already chose a password, so nothing is re-sent.'
                : 'Restarts the 30 days. Sends nothing — the parent asks for the code from the app.'}
            </span>
          </button>
        )}
        {canRevoke(access.id) && (
          <>
            <div className="h-px mx-2 my-1.5 bg-slate-200" />
            <button disabled={busy} onClick={() => setConfirmRevoke(true)}
              className="block w-full px-2.5 py-2 text-left rounded-xl hover:bg-slate-50 disabled:opacity-50">
              <span className="block text-sm font-semibold text-red-700">Revoke access</span>
              <span className="block mt-0.5 text-[11.5px] leading-snug text-slate-500">
                Cuts off the app for {kids === 1 ? 'their child' : `all ${kids} children`} on this account.
              </span>
            </button>
          </>
        )}
        {!canInvite(access.id) && !canRevoke(access.id) && (
          <p className="px-2.5 py-2 text-[11.5px] leading-snug text-slate-500">
            Nothing to change here.
          </p>
        )}
      </div>

      <Modal open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title="Revoke parent app access?" size="sm">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            <strong className="text-slate-900">{parent.surname}, {parent.first_name}</strong> will no longer be able
            to sign in to the VISTA Parent app.
          </p>
          <p>
            One email is one login, so this reaches{' '}
            <strong className="text-slate-900">{kids === 1 ? 'their child' : `all ${kids} of their children`}</strong>,
            not just one. Their guardian records, pickup authorization and history are untouched, and access can be
            restored later.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setConfirmRevoke(false)} className="btn-secondary">Cancel</button>
          <button disabled={busy}
            onClick={() => run(
              () => studentApi.revokeGuardianAccess(anchor.student_id, anchor.guardian_id),
              'Access revoked.'
            )}
            className="btn-primary !bg-red-600 hover:!bg-red-700">Revoke access</button>
        </div>
      </Modal>
    </>
  )
}

/* ── One account, and the children on it ──────────────────────────────────
 * The reason this tab exists alongside Manage Guardians: attaching another
 * learner to an account that already exists. Everything else here is read-only
 * — a parent's name and number are edited on the learner, where the save
 * already reaches every learner on the account.
 */
function ParentPanel({ parent, onClose, onChanged }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setEditing(false); setAdding(false) }, [parent.id])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !adding && !editing) onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, adding, editing])

  const access = accessOf(parent)
  const kids = parent.children.length + (parent.other_children || 0)

  // Portalled into document.body, and z-50 to match Modal — the same reason
  // Modal does it. Rendered in place, the panel sits inside the page root's
  // stacking context (`animate-fade-in` creates one), so its z-index only
  // competed with its own siblings and the Topbar painted over it despite
  // being z-20. z-50 also clears the sidebar, which is z-40.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="relative w-full max-w-xl h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-fade-in">
        <div className="px-6 py-5 border-b border-slate-200 flex items-start gap-3">
          <div className="w-11 h-11 shrink-0 rounded-full bg-brand-50 text-brand-700 grid place-items-center text-sm font-bold">
            {initials(parent)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-slate-900">{parent.surname}, {parent.first_name}</h3>
            {/* The pill must never break: "Pending Activation" and "Activation
                In Progress" are two words wide and wrapped inside the rounded
                border, which read as two separate chips. It stays whole and the
                detail beside it moves to its own line instead. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
              <span className={clsx('shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold border', accessClasses(access.id))}>
                {accessLabel(access.id)}
              </span>
              <span className="text-xs text-slate-500">{accessDetail(parent)}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X size={18} className="text-slate-600" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {editing ? (
            <ParentDetailsForm parent={parent} onCancel={() => setEditing(false)}
              onSaved={() => { setEditing(false); onChanged() }} />
          ) : (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Contact</h4>
                <button onClick={() => setEditing(true)}
                  className="text-xs font-semibold text-brand-600">Edit details</button>
              </div>
              <div className="flex items-center gap-2.5 text-sm text-slate-700">
                <Phone size={15} className="text-slate-400" />{parent.phone || '—'}
              </div>
              <div className="flex items-center gap-2.5 text-sm text-slate-700">
                <Mail size={15} className="text-slate-400" />{parent.email}
                <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[11px] text-slate-500">Registered</span>
              </div>
              {parent.home_address && (
                <div className="flex items-start gap-2.5 text-sm text-slate-700">
                  <Home size={15} className="mt-0.5 shrink-0 text-slate-400" />{parent.home_address}
                </div>
              )}
              <p className="text-[11.5px] leading-snug text-slate-500">
                These are the person’s own details, so a save reaches every learner on this account — the same write
                Manage Guardians makes.
              </p>
            </section>
          )}

          <section className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Children · {parent.children.length}
              </h4>
              <span className="text-[11.5px] text-slate-500">They see these learners in the app</span>
            </div>
            {parent.children.map(c => (
              <div key={c.guardian_id} className="flex items-center gap-3 px-3.5 py-2.5 border border-slate-200 rounded-xl">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{childName(c)}</div>
                  <div className="text-[11.5px] text-slate-500">
                    {c.grade_level}{c.section ? ` · ${c.section}` : ''} · {c.relationship}
                  </div>
                </div>
                <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-semibold',
                  c.is_authorized_pickup ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {c.is_authorized_pickup ? 'Pickup' : 'No pickup'}
                </span>
                <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-semibold',
                  c.is_emergency_contact ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {c.is_emergency_contact ? 'Emergency' : 'No emergency'}
                </span>
              </div>
            ))}
            {parent.other_children > 0 && (
              <p className="text-[11.5px] text-slate-500">
                This account also covers {parent.other_children} learner{parent.other_children === 1 ? '' : 's'} outside
                your grade levels.
              </p>
            )}

            {adding
              ? <AddChild parent={parent} onCancel={() => setAdding(false)}
                  onAdded={() => { setAdding(false); onChanged() }} />
              : <button onClick={() => setAdding(true)}
                  className="w-full h-10 flex items-center justify-center gap-2 text-sm font-semibold text-brand-600
                             border border-dashed border-slate-300 rounded-xl hover:bg-slate-50">
                  <Plus size={16} /> Add a child to this account
                </button>}
          </section>

          <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Parent app access</h4>
            <div className="px-3.5 py-3 border border-slate-200 rounded-xl">
              <p className="text-xs leading-relaxed text-slate-500">
                {access.id === 'active'
                  ? 'Activated with this address, so it can’t be changed here.'
                  : 'Reissue, revoke and restore are on the Manage access menu in the list.'}
                {' '}Revoking reaches{' '}
                <strong className="text-slate-700 font-semibold">
                  {kids === 1 ? 'their child' : `all ${kids} children`}
                </strong> — the records stay.
              </p>
            </div>
          </section>
        </div>
      </aside>
    </div>,
    document.body
  )
}

/* ── The person's own details ─────────────────────────────────────────────
 * Only the SHARED fields — the ones `PUT /guardians/:gid` writes to every
 * `parent_student` row of the account and to `users`. Relationship, pickup and
 * emergency are deliberately absent: those are per learner, and the panel
 * already lists them under each child, where they mean something.
 *
 * This is a second entry point to one rule, not a second rule — the same
 * endpoint Manage Guardians calls, with the same fan-out. Any child's
 * `(student_id, guardian_id)` reaches it, and a scoped admin only ever holds
 * in-scope ones.
 *
 * The registered email is editable only while the parent has never set a
 * password (`has_password`, not `account_status` — a revoked account has still
 * proved it owns the address). There is no early email check here on purpose:
 * `guardian-email-check` would look this very account up and report the address
 * as taken by a parent account, refusing the parent their own email. The PUT
 * excludes the row's own account, so the server is the right judge.
 */
function ParentDetailsForm({ parent, onCancel, onSaved }) {
  const [form, setForm] = useState({
    surname: parent.surname || '',
    first_name: parent.first_name || '',
    middle_name: parent.middle_name || '',
    phone: parent.phone || '',
    home_address: parent.home_address || '',
    email: parent.email || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const emailEditable = !parent.has_password
  const anchor = parent.children[0]
  const reach = parent.children.length + (parent.other_children || 0)

  const dirty = ['surname','first_name','middle_name','phone','home_address','email']
    .some(k => (form[k] || '') !== (parent[k] || ''))
  const ready = form.surname.trim() && form.first_name.trim() && form.phone && dirty

  const save = async () => {
    setBusy(true)
    try {
      const payload = {
        surname: form.surname.trim(),
        first_name: form.first_name.trim(),
        middle_name: form.middle_name.trim(),
        phone: form.phone,
        home_address: form.home_address.trim(),
      }
      // Left out entirely unless it may change AND did — the handler skips a
      // field it is not sent, and sending an unchanged address would put the
      // save down the email-change path for nothing.
      if (emailEditable && form.email.trim() !== (parent.email || '')) payload.email = form.email.trim()
      const res = await studentApi.updateGuardian(anchor.student_id, anchor.guardian_id, payload)
      toast.success(res.data?.message || 'Parent updated.', { duration: 6000 })
      onSaved()
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Edit contact</h4>
        <span className="text-[11.5px] text-slate-500">
          Reaches {reach === 1 ? 'their child' : `all ${reach} children`}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">Surname
          <input className="input mt-1.5" required value={form.surname}
            onChange={e => set({ surname: e.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-700">First name
          <input className="input mt-1.5" required value={form.first_name}
            onChange={e => set({ first_name: e.target.value })} />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">
          Middle name <span className="text-xs font-normal text-slate-400">optional</span>
          <input className="input mt-1.5" value={form.middle_name}
            onChange={e => set({ middle_name: e.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Mobile number
          <PhoneInput className="input mt-1.5 pr-10" required value={form.phone}
            onChange={v => set({ phone: v })} />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">Home address
        <input className="input mt-1.5" value={form.home_address}
          onChange={e => set({ home_address: e.target.value })} />
      </label>

      <label className="block text-sm font-medium text-slate-700">Registered Email Address
        <input type="email" className={clsx('input mt-1.5', !emailEditable && 'bg-slate-50 text-slate-500 cursor-not-allowed')}
          value={form.email} readOnly={!emailEditable} disabled={!emailEditable}
          onChange={e => set({ email: e.target.value })} />
        <span className="block mt-1.5 text-xs font-normal text-slate-500">
          {emailEditable
            ? 'Still correctable because they have never set a password. Saving a new address cancels any unused code.'
            : 'They activated with this address, so it is their sign-in identity and can’t be changed.'}
        </span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary !h-9 !px-3 !text-[12.5px]">Cancel</button>
        <button disabled={!ready || busy} onClick={save}
          className="btn-primary !h-9 !px-4 !text-[12.5px] disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

/* ── Attach an existing learner to this account ───────────────────────────
 * Posts `link_parent_id`, so the server copies the account's name, email and
 * phone onto the new row rather than trusting anything typed here. A learner
 * already on the account is listed disabled with the reason — offered and then
 * refused is worse than never offered.
 */
function AddChild({ parent, onCancel, onAdded }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [picked, setPicked] = useState(null)
  const [rel, setRel] = useState('Mother')
  const [pickup, setPickup] = useState(true)
  const [emergency, setEmergency] = useState(false)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const mine = useMemo(
    () => new Set(parent.children.map(c => c.student_id)),
    [parent.children]
  )

  useEffect(() => {
    if (picked) return
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    const mySeq = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await studentApi.list({ search: term, limit: 8 })
        if (seq.current === mySeq) setResults(res.data.students || [])
      } catch { /* interceptor toasts */ }
    }, 300)
    return () => clearTimeout(t)
  }, [q, picked])

  const save = async () => {
    setBusy(true)
    try {
      // `guardianSchema` requires a home address even on the link path, so one
      // has to be resolved here. Same precedence GuardianManager uses: the
      // address already on the account, else the learner's own — a parent who
      // lives with one child almost always lives with the other, and the
      // learner's is never blank (it is required when they are created).
      const home_address = parent.home_address || picked.home_address || ''
      const res = await studentApi.addGuardian(picked.id, {
        link_parent_id: parent.id,
        surname: parent.surname,
        first_name: parent.first_name,
        relationship: rel,
        home_address,
        is_authorized_pickup: pickup,
        is_emergency_contact: emergency,
      })
      toast.success(res.data?.message || 'Child added.', { duration: 6000 })
      onAdded()
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  return (
    <div className="p-3.5 bg-slate-50 border border-slate-300 rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <Plus size={15} className="text-brand-600" />
        <h5 className="text-[13px] font-bold text-slate-900">Add a child to this account</h5>
      </div>

      {picked ? (
        <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-xl">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900">{picked.surname}, {picked.first_name}</div>
            <div className="text-[11.5px] text-slate-500">
              {picked.grade_level}{picked.section ? ` · ${picked.section}` : ''} · LRN {picked.lrn}
            </div>
          </div>
          <button onClick={() => { setPicked(null); setQ('') }}
            className="text-xs font-semibold text-brand-600">Change</button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10" autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search a learner by name or LRN to add them" />
          </div>
          {!!results.length && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {results.map(s => {
                const already = mine.has(s.id)
                return (
                  <button key={s.id} disabled={already} onClick={() => setPicked(s)}
                    className={clsx(
                      'flex items-center gap-3 w-full px-3.5 py-2.5 text-left border-b border-slate-100 last:border-b-0',
                      already ? 'cursor-not-allowed' : 'hover:bg-brand-50/60'
                    )}>
                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-[13px] font-semibold', already ? 'text-slate-400' : 'text-slate-900')}>
                        {s.surname}, {s.first_name}
                      </div>
                      <div className={clsx('text-[11.5px]', already ? 'text-slate-400' : 'text-slate-500')}>
                        {s.grade_level}{s.section ? ` · ${s.section}` : ''} · LRN {s.lrn}
                      </div>
                    </div>
                    <span className={clsx('text-[11.5px]', already ? 'text-slate-500' : 'font-semibold text-brand-600')}>
                      {already ? 'Already on this account' : 'Add'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
          Relationship
          <select className="input !h-9 !py-0 !w-auto text-[12.5px]" value={rel} onChange={e => setRel(e.target.value)}>
            {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" checked={pickup} onChange={e => setPickup(e.target.checked)} />
          Pickup
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} />
          Emergency
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onCancel} className="btn-secondary !h-9 !px-3 !text-[12.5px]">Cancel</button>
          <button disabled={!picked || busy} onClick={save}
            className="btn-primary !h-9 !px-4 !text-[12.5px] disabled:opacity-50">
            {busy ? 'Adding…' : 'Add child'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Add parent — Version C, one modal ────────────────────────────────────
 * The children are part of the create, never a step after it: an account with
 * no learner is a state nothing in the app can express, and the server refuses
 * it too (`children` is min(1)). Save stays disabled until one is listed.
 *
 * There is no "send the invitation?" switch. An account exists only because an
 * email was authorized, so creating one without inviting would ask for a row
 * the model has no state for — the note says what happens instead.
 */
const emptyChild = () => ({
  key: Math.random().toString(36).slice(2),
  student: null, relationship: 'Mother', is_authorized_pickup: true, is_emergency_contact: false,
})

function AddParentModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ surname: '', first_name: '', middle_name: '', phone: '', email: '' })
  const [children, setChildren] = useState([emptyChild()])
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm(f => ({ ...f, ...patch }))

  // The same early check the guardian forms use: a taken address is refused
  // before the save, red, with no button that switches flows.
  const emailCheck = useGuardianEmailCheck(null)
  const emailView = describeEmailCheck(emailCheck.current(form))

  const picked = children.filter(c => c.student)
  const ready = form.surname.trim() && form.first_name.trim() && form.phone && form.email
    && picked.length > 0 && !emailView?.invalid

  const save = async () => {
    setBusy(true)
    try {
      const res = await studentApi.createParent({
        surname: form.surname.trim(),
        first_name: form.first_name.trim(),
        middle_name: form.middle_name.trim(),
        phone: form.phone,
        email: form.email.trim(),
        children: picked.map(c => ({
          student_id: c.student.id,
          relationship: c.relationship,
          is_authorized_pickup: c.is_authorized_pickup,
          is_emergency_contact: c.is_emergency_contact,
        })),
      })
      toast.success(res.data?.message || 'Parent added.', { duration: 7000 })
      onCreated()
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  return (
    // `selfScroll` hands the body `overflow-hidden` and expects the children to
    // do the scrolling — so the sections below sit in their own scroll area and
    // the footer stays pinned. Without that the modal simply clipped everything
    // past 84vh, which hid the second child row and the button that adds it.
    <Modal open onClose={onClose} title="Add parent" size="lg" selfScroll>
      <p className="-mt-1 mb-4 shrink-0 text-[12.5px] text-slate-500">
        They become a guardian of every learner you add below.
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
        <section className="space-y-3">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Parent details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">Surname
              <input className="input mt-1.5" required value={form.surname}
                onChange={e => set({ surname: e.target.value })} />
            </label>
            <label className="block text-sm font-medium text-slate-700">First name
              <input className="input mt-1.5" required value={form.first_name}
                onChange={e => set({ first_name: e.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Middle name <span className="text-xs font-normal text-slate-400">optional</span>
              <input className="input mt-1.5" value={form.middle_name}
                onChange={e => set({ middle_name: e.target.value })} />
            </label>
            <label className="block text-sm font-medium text-slate-700">Mobile number
              <PhoneInput className="input mt-1.5 pr-10" required value={form.phone}
                onChange={v => set({ phone: v })} />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Parent app access</h4>
          <label className="block text-sm font-medium text-slate-700">Registered Email Address
            <input type="email" required value={form.email}
              className={clsx('input mt-1.5', emailView?.invalid && '!border-red-400 focus:!ring-red-500/20')}
              onChange={e => set({ email: e.target.value })}
              onBlur={() => emailCheck.check(form)} />
            {emailView?.invalid && (
              <span className="block mt-1.5 text-xs font-normal text-red-600">{emailView.message}</span>
            )}
          </label>
          <div className="flex gap-2.5 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl">
            <Info size={15} className="shrink-0 mt-0.5 text-brand-600" />
            <p className="text-[11.5px] leading-relaxed text-slate-600">
              Saving authorizes this address for the VISTA Parent app. No password is set here and nothing is sent
              now — the parent asks for a code from the app and chooses their own password.
            </p>
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Children</h4>
            <span className="text-[11.5px] font-semibold text-amber-700">At least one required</span>
          </div>
          {children.map((c, i) => (
            <ChildRow key={c.key} row={c}
              taken={picked.filter(p => p.key !== c.key).map(p => p.student.id)}
              onChange={(patch) => setChildren(cs => cs.map(x => x.key === c.key ? { ...x, ...patch } : x))}
              onRemove={children.length > 1 ? () => setChildren(cs => cs.filter(x => x.key !== c.key)) : null} />
          ))}
          <button onClick={() => setChildren(cs => [...cs, emptyChild()])}
            className="w-full h-10 flex items-center justify-center gap-2 text-sm font-semibold text-brand-600
                       border border-dashed border-slate-300 rounded-xl hover:bg-slate-50">
            <Plus size={16} /> Add another child
          </button>
        </section>
      </div>

      <div className="mt-4 pt-4 shrink-0 border-t border-slate-200 flex items-center justify-between gap-4">
        <p className="text-[11.5px] leading-snug text-slate-500 max-w-xs">
          The account and {picked.length === 1 ? 'the child' : `all ${picked.length} children`} are saved together,
          or not at all.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button disabled={!ready || busy} onClick={save} className="btn-primary disabled:opacity-50">
            {busy ? 'Saving…' : picked.length > 1 ? `Add parent & ${picked.length} children` : 'Add parent'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ChildRow({ row, taken, onChange, onRemove }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const seq = useRef(0)

  useEffect(() => {
    if (row.student) return
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    const mySeq = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await studentApi.list({ search: term, limit: 8 })
        if (seq.current === mySeq) setResults(res.data.students || [])
      } catch { /* interceptor toasts */ }
    }, 300)
    return () => clearTimeout(t)
  }, [q, row.student])

  return (
    <div className="p-3.5 border border-slate-200 rounded-xl space-y-3">
      {row.student ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900">{row.student.surname}, {row.student.first_name}</div>
            <div className="text-[11.5px] text-slate-500">
              {row.student.grade_level}{row.student.section ? ` · ${row.student.section}` : ''} · LRN {row.student.lrn}
            </div>
          </div>
          <button onClick={() => { onChange({ student: null }); setQ('') }}
            className="text-xs font-semibold text-brand-600">Change</button>
          {onRemove && (
            <button onClick={onRemove} aria-label="Remove this child"
              className="w-7 h-7 grid place-items-center rounded-lg hover:bg-slate-100">
              <X size={15} className="text-slate-500" />
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-10" value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search a learner by name or LRN" />
            </div>
            {onRemove && (
              <button onClick={onRemove} aria-label="Remove this child"
                className="w-8 h-8 shrink-0 grid place-items-center rounded-lg hover:bg-slate-100">
                <X size={16} className="text-slate-500" />
              </button>
            )}
          </div>
          {!!results.length && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {results.map(s => {
                const already = taken.includes(s.id)
                return (
                  <button key={s.id} disabled={already} onClick={() => onChange({ student: s })}
                    className={clsx(
                      'flex items-center gap-3 w-full px-3.5 py-2.5 text-left border-b border-slate-100 last:border-b-0',
                      already ? 'cursor-not-allowed' : 'hover:bg-brand-50/60'
                    )}>
                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-[13px] font-semibold', already ? 'text-slate-400' : 'text-slate-900')}>
                        {s.surname}, {s.first_name}
                      </div>
                      <div className={clsx('text-[11.5px]', already ? 'text-slate-400' : 'text-slate-500')}>
                        {s.grade_level}{s.section ? ` · ${s.section}` : ''} · LRN {s.lrn}
                      </div>
                    </div>
                    {already && <span className="text-[11.5px] text-slate-500">Already added above</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
          Relationship
          <select className="input !h-9 !py-0 !w-auto text-[12.5px]" value={row.relationship}
            onChange={e => onChange({ relationship: e.target.value })}>
            {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" checked={row.is_authorized_pickup}
            onChange={e => onChange({ is_authorized_pickup: e.target.checked })} />
          Pickup
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" checked={row.is_emergency_contact}
            onChange={e => onChange({ is_emergency_contact: e.target.checked })} />
          Emergency
        </label>
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Relationship, pickup and emergency are set per child — they may fetch one and not another.
      </p>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Plus, Phone, Mail, Home, RotateCcw, ShieldCheck, Pencil, UserRound, ShieldOff, UserMinus, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Modal, PhoneInput } from './UI'
import { useGuardianEmailCheck, describeEmailCheck } from './GuardianEmailCheck'
import { studentApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  PARENT_ACCESS_STATES, accessOf, resolveParentAccess, canInvite, canRevoke,
} from '../utils/parentAccess'
import {
  whenSignedIn, invitedLine, expiredLine, IN_PROGRESS_LINE, invitationOpenUntil,
} from '../utils/accessDisplay'
import {
  RosterFilters, stateChips, PersonCell, AccessChip, AccessCell, RowActions, RowMenu, useRowMenus,
  WhatHappensNext, InvitationCreated, titled, DiscardButton,
} from './AccountRoster'

// The Parents tab of Account Management.
//
// It is the same roster as Teachers and Admins — built from the same pieces in
// AccountRoster.jsx, so the three tabs read as one page: search and state chips,
// one table (person · what they cover · account access · actions), an Edit
// pencil and a ⋯ menu, and the same "Invitation created" confirmation. What is
// genuinely different stays different: a parent covers children rather than
// classes, so their account panel lists children, and their access is revoked
// rather than deactivated.
//
// Everything it writes goes through an endpoint that already existed, so this
// is a second ENTRY POINT to each rule and never a second rule: `PUT
// /guardians/:gid` for the person's own details (which fans out to every
// learner on the account and to `users`), `POST /guardians` with
// `link_parent_id` to attach a learner, and the invitation routes for access.

// Same list as GuardianManager.jsx, AddStudentWizard.jsx and the batch upload.
const RELATIONSHIPS = ['Mother','Father','Guardian','Grandmother','Grandfather','Aunt','Uncle','Sibling','Other']

// The parent states in the order the staff tabs list theirs; Revoked stands
// where Deactivated does. 'none' never appears here — every row is an account.
const STATES = ['active', 'pending', 'in_progress', 'expired', 'revoked']
  .map(id => PARENT_ACCESS_STATES.find(s => s.id === id))

const childName = (c) => `${c.surname}, ${c.first_name}`
const gradeShort = (g) => (g === 'Kinder' ? 'Kinder' : String(g || '').replace('Grade ', 'G'))

/** The one line under the chip — the staff tabs' wording, a parent's facts. */
const parentAccessDetail = (p, meId) => {
  switch (accessOf(p).id) {
    case 'active':      return p.last_login_at ? `Last signed in ${whenSignedIn(p.last_login_at)}` : 'Has activated the VISTA Parent app'
    case 'pending':     return invitedLine(p.invitation, meId)
    case 'in_progress': return IN_PROGRESS_LINE
    case 'expired':     return expiredLine(p.invitation)
    case 'revoked':     return 'Access revoked · guardian records unchanged'
    default:            return ''
  }
}

/** The steps a parent follows — in the app, not on this site. */
const parentSteps = (email) => [
  'Open the VISTA Parent app on their phone',
  'Tap "Activate my account"',
  `Enter ${email} and follow the code sent there`,
]

const PARENT_NEXT = [
  <>Saving sends nothing. The account waits as <b className="text-blue-700">Pending Activation</b> for 30 days.</>,
  <>Tell them to open the VISTA Parent app and tap <b className="text-slate-800">Activate my account</b>.</>,
  <>They enter this email, receive a 6-digit code, and create their password.</>,
]

export default function ParentAccounts({ createOpen, onOpenCreate, onCloseCreate, onCountsChange }) {
  const { user } = useAuth()
  const meId = user?.id
  const [parents, setParents]   = useState([])
  const [summary, setSummary]   = useState(null)   // null until the first load
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [state, setState]       = useState('')
  const [panel, setPanel]       = useState(null)   // { id, mode: 'view' | 'edit' | 'add' }
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [created, setCreated]   = useState(null)   // the account just invited
  const [busy, setBusy]         = useState(false)
  const menus = useRowMenus()

  const fetchParents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await studentApi.listParents({ search, state, limit: 100 })
      const sum = res.data.summary || {}
      setParents(res.data.parents || [])
      setSummary(sum)
      setTotal(res.data.total || 0)
      onCountsChange?.({
        total: res.data.all_total || 0,
        waiting: (sum.pending || 0) + (sum.in_progress || 0) + (sum.expired || 0),
      })
    } catch { /* interceptor toasts */ }
    setLoading(false)
  }, [search, state, onCountsChange])

  // Debounced, like the Teachers and Admins tabs.
  useEffect(() => {
    const t = setTimeout(fetchParents, 300)
    return () => clearTimeout(t)
  }, [fetchParents])

  // The panel shows the row as it is in the list, so a refetch hands it the new
  // one — adding a child must not leave the panel showing what was true before.
  const selected = panel ? parents.find(p => p.id === panel.id) : null

  // Access is per account, so any child's (student, guardian) pair reaches it.
  // A scoped admin is only ever handed in-scope children, which is what the
  // API's own scope check on that learner then accepts.
  const anchorOf = (p) => p.children[0]
  const kidsOf = (p) => p.children.length + (p.other_children || 0)

  const run = async (fn, done) => {
    setBusy(true)
    try {
      const res = await fn()
      toast.success(res.data?.message || done, { duration: 6000 })
      fetchParents()
      return true
    } catch { return false /* interceptor toasts */ } finally { setBusy(false) }
  }

  const grant = (p) => run(
    () => studentApi.inviteGuardian(anchorOf(p).student_id, anchorOf(p).guardian_id),
    'Invitation issued.'
  )

  const revoke = async () => {
    const p = revokeTarget
    const ok = await run(
      () => studentApi.revokeGuardianAccess(anchorOf(p).student_id, anchorOf(p).guardian_id),
      'Access revoked.'
    )
    if (ok) setRevokeTarget(null)
  }

  // Only what the state allows, in the same shape as the staff menus: grant
  // first (Reissue, or Restore for a revoked account that already chose a
  // password), then the account itself, and revoking below the line in red.
  const menuFor = (p) => {
    const access = accessOf(p)
    const items = []
    if (canInvite(access.id)) {
      const restore = access.id === 'revoked' && p.has_password
      items.push({
        key: 'grant', icon: restore ? ShieldCheck : RotateCcw,
        label: restore ? 'Restore access' : 'Reissue invitation',
        hint: restore ? 'They can sign in again with their password' : 'Opens it again for 30 days',
        run: () => grant(p),
      })
    }
    items.push({ key: 'view', icon: UserRound, label: 'View account', hint: 'Contact details and children', run: () => setPanel({ id: p.id, mode: 'view' }) })
    items.push({ key: 'edit', icon: Pencil, label: 'Edit details', run: () => setPanel({ id: p.id, mode: 'edit' }) })
    items.push({ key: 'add', icon: Plus, label: 'Add a child', run: () => setPanel({ id: p.id, mode: 'add' }) })
    const danger = canRevoke(access.id)
      ? [{ key: 'revoke', icon: ShieldOff, label: 'Revoke access', hint: `Reaches ${kidsOf(p) === 1 ? 'their child' : `all ${kidsOf(p)} children`}`, run: () => setRevokeTarget(p) }]
      : []
    return { items, danger }
  }

  const filtered = !!(search || state)

  return (
    <div className="space-y-5">
      {/* No chips until the first load answers — "All 0" would read as "no parents". */}
      <RosterFilters search={search} onSearch={setSearch}
        placeholder="Search by name, email or child" label="Search parents"
        chips={summary ? stateChips(STATES, summary, Object.values(summary).reduce((a, b) => a + b, 0)) : []}
        value={state} onChange={setState} />

      <div className="card overflow-visible">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Parent</th>
                <th>Children</th>
                <th>Account access</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} className="py-10 text-center text-sm text-slate-500">Loading parent accounts…</td></tr>
              )}
              {!loading && !parents.length && (
                <tr><td colSpan={4} className="py-12 text-center">
                  <p className="text-sm text-slate-500">
                    {filtered ? 'No accounts match this filter.' : 'No parent accounts yet. Invite a parent with their email — they choose their own password in the VISTA Parent app.'}
                  </p>
                  {filtered && (
                    <button onClick={() => { setSearch(''); setState('') }}
                      className="mt-2 text-sm font-semibold text-brand-600">Show all</button>
                  )}
                </td></tr>
              )}
              {!loading && parents.map((p) => {
                const key = `parent:${p.id}`
                const access = accessOf(p)
                return (
                  // Rows open the account panel, as the staff tabs' rows do.
                  // `!` is required: `.table-base tbody tr:hover` outranks a bare
                  // `hover:bg-…` (see "Tables" in the dashboard CLAUDE.md).
                  <tr key={p.id} className="hover:!bg-brand-50/60 cursor-pointer transition-colors"
                    onClick={() => setPanel({ id: p.id, mode: 'view' })}>
                    <td><PersonCell person={p} muted={access.id === 'revoked'} /></td>
                    <td className="max-w-xs">
                      <div className="flex flex-wrap gap-1">
                        {p.children.map(c => (
                          <span key={c.guardian_id}
                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
                            {childName(c)} · {gradeShort(c.grade_level)}
                          </span>
                        ))}
                        {p.other_children > 0 && (
                          <span className="px-2 py-0.5 rounded-md border border-dashed border-slate-300 text-slate-500 text-xs"
                            title="This account also covers learners outside your grade levels">
                            +{p.other_children} outside your grades
                          </span>
                        )}
                      </div>
                    </td>
                    <td><AccessCell state={access} detail={parentAccessDetail(p, meId)} /></td>
                    <td>
                      <RowActions editLabel={`Edit ${p.surname}, ${p.first_name}`}
                        onEdit={() => setPanel({ id: p.id, mode: 'edit' })}
                        menu={<RowMenu label={`More actions for ${p.surname}, ${p.first_name}`}
                          open={menus.isOpen(key)} onToggle={menus.toggle(key)} {...menuFor(p)} />} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && total > parents.length && (
        <p className="text-xs text-slate-500">Showing {parents.length} of {total} — search to narrow the list.</p>
      )}

      {selected && (
        <ParentPanel key={`${selected.id}:${panel.mode}`} parent={selected} meId={meId} initialMode={panel.mode}
          onClose={() => setPanel(null)} onChanged={fetchParents} />
      )}

      {createOpen && (
        <InviteParentModal onClose={onCloseCreate}
          onCreated={(account) => { onCloseCreate(); setCreated(account); fetchParents() }} />
      )}

      <Modal open={!!created} onClose={() => setCreated(null)} title="Invite Parent">
        {created && (
          <InvitationCreated
            name={`${created.surname}, ${created.first_name}`}
            email={created.email}
            roleLabel="Parent"
            state={resolveParentAccess({ hasAccount: true, accountStatus: created.account_status, invitation: created.invitation })}
            openUntil={invitationOpenUntil(created.invitation)}
            steps={parentSteps(created.email)}
            onDone={() => setCreated(null)}
            onAnother={() => { setCreated(null); onOpenCreate?.() }} />
        )}
      </Modal>

      <Modal open={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Revoke access?" size="sm">
        {revokeTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              <b className="text-slate-900">{revokeTarget.surname}, {revokeTarget.first_name}</b> will no longer be able
              to sign in to the VISTA Parent app. One email is one login, so this reaches{' '}
              <b className="text-slate-900">{kidsOf(revokeTarget) === 1 ? 'their child' : `all ${kidsOf(revokeTarget)} of their children`}</b>,
              not just one. Their guardian records and history are untouched, and access can be restored later.
            </p>
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button onClick={() => setRevokeTarget(null)} className="btn-secondary">Keep access</button>
              <button disabled={busy} onClick={revoke} className="btn-primary !bg-red-600 hover:!bg-red-700">Revoke access</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── One account, and the children on it ──────────────────────────────────
 * The staff tabs open theirs through `AccountPanel`; this one is its own
 * because a parent's account IS its children, and attaching another learner to
 * an account that already exists is something no learner's page can do. It opens on whatever the row
 * asked for — viewing, the Edit pencil, or the menu's Add a child.
 */
function ParentPanel({ parent, meId, initialMode = 'view', onClose, onChanged }) {
  const [adding, setAdding] = useState(initialMode === 'add')
  const [editing, setEditing] = useState(initialMode === 'edit')
  const [childEdit, setChildEdit] = useState(null)       // guardian_id of the child row being edited
  const [removeTarget, setRemoveTarget] = useState(null) // the child row being removed
  // Escape closes the panel only when nothing is half-done in it: no form open,
  // and no confirmation sitting on top of it.
  const busyHere = adding || editing || !!childEdit || !!removeTarget
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !busyHere) onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, busyHere])

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
          <div className="w-11 h-11 shrink-0 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-sm font-bold">
            {`${(parent.surname || '')[0] || ''}${(parent.first_name || '')[0] || ''}`.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-slate-900">{parent.surname}, {parent.first_name}</h3>
            {/* The chip must never break: "Activation In Progress" wrapped inside
                its rounded border read as two chips. It stays whole and the
                detail moves to its own line instead. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              <AccessChip state={access} />
              <span className="text-xs text-slate-500">{parentAccessDetail(parent, meId)}</span>
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
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Contact</h4>
                <button onClick={() => setEditing(true)}
                  className="text-xs font-semibold text-brand-600">Edit details</button>
              </div>
              <div className="flex items-center gap-2.5 text-sm text-slate-700">
                <Phone size={15} className="text-slate-400" />{parent.phone || '—'}
              </div>
              <div className="flex items-center gap-2.5 text-sm text-slate-700">
                <Mail size={15} className="text-slate-400" />{parent.email}
                <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[11px] text-slate-500">Sign-in email</span>
              </div>
              {parent.home_address && (
                <div className="flex items-start gap-2.5 text-sm text-slate-700">
                  <Home size={15} className="mt-0.5 shrink-0 text-slate-400" />{parent.home_address}
                </div>
              )}
              <p className="text-xs leading-snug text-slate-500">
                These are the person’s own details, so a save reaches every learner on this account — the same write
                Manage Guardians makes.
              </p>
            </section>
          )}

          <section className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Children · {parent.children.length}
              </h4>
              <span className="text-xs text-slate-500">They see these learners in the app</span>
            </div>
            {parent.children.map(c => childEdit === c.guardian_id
              ? <ChildForm key={c.guardian_id} child={c} onCancel={() => setChildEdit(null)}
                  onSaved={() => { setChildEdit(null); onChanged() }} />
              : (
              <div key={c.guardian_id} className="flex items-center gap-3 px-3.5 py-2.5 border border-slate-200 rounded-xl">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{childName(c)}</div>
                  <div className="text-xs text-slate-500">
                    {c.grade_level}{c.section ? ` · ${c.section}` : ''} · {c.relationship}
                  </div>
                </div>
                <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-semibold',
                  c.is_emergency_contact ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {c.is_emergency_contact ? 'Emergency' : 'No emergency'}
                </span>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => setChildEdit(c.guardian_id)}
                    aria-label={`Edit relationship and emergency contact for ${childName(c)}`} title="Edit for this child"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                    <Pencil size={15} />
                  </button>
                  {/* Never on the last child: the server deletes a parent account
                      left with no learners, so this would quietly destroy the
                      login and its history. Revoking is the undoable way to cut
                      someone off. `kids` includes children outside the caller's
                      grades, which the delete counts too. */}
                  <button onClick={() => setRemoveTarget(c)} disabled={kids <= 1}
                    aria-label={`Remove ${childName(c)} from this guardian`}
                    title={kids <= 1
                      ? 'This is their only child. Removing it would delete the account — revoke access instead.'
                      : 'Remove from this guardian'}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400">
                    <UserMinus size={15} />
                  </button>
                </div>
              </div>
            ))}
            {parent.other_children > 0 && (
              <p className="text-xs text-slate-500">
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
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Account access</h4>
            <div className="px-3.5 py-3 border border-slate-200 rounded-xl">
              <p className="text-xs leading-relaxed text-slate-500">
                {access.id === 'active'
                  ? 'Activated with this address, so it can’t be changed here.'
                  : 'Reissue, revoke and restore are on the ⋯ menu in the list.'}
                {' '}Revoking reaches{' '}
                <strong className="text-slate-700 font-semibold">
                  {kids === 1 ? 'their child' : `all ${kids} children`}
                </strong> — the records stay.
              </p>
            </div>
          </section>
        </div>
      </aside>

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title={removeTarget ? `Remove ${removeTarget.first_name} from this guardian?` : ''} size="sm">
        {removeTarget && (
          <RemoveChild parent={parent} child={removeTarget} kids={kids}
            onClose={() => setRemoveTarget(null)}
            onRemoved={() => { setRemoveTarget(null); onChanged() }} />
        )}
      </Modal>
    </div>,
    document.body
  )
}

/* ── What they are to one child ───────────────────────────────────────────
 * Relationship and emergency contact are the two PER-LEARNER fields, so this
 * sends only those: `PUT /guardians/:gid` writes them to this one row and leaves
 * the account and its other children alone — the same request Manage Guardians
 * makes from the learner's side.
 */
function ChildForm({ child, onCancel, onSaved }) {
  const start = { relationship: child.relationship || 'Guardian', is_emergency_contact: !!child.is_emergency_contact }
  const [form, setForm] = useState(start)
  const [busy, setBusy] = useState(false)
  const dirty = form.relationship !== start.relationship || form.is_emergency_contact !== start.is_emergency_contact

  const save = async () => {
    setBusy(true)
    try {
      const res = await studentApi.updateGuardian(child.student_id, child.guardian_id, form)
      toast.success(res.data?.message || 'Guardian updated.', { duration: 6000 })
      onSaved()
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  return (
    <div className="px-3.5 py-3 border border-brand-200 bg-brand-50/40 rounded-xl space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">{childName(child)}</div>
        <div className="text-xs text-slate-500">
          {child.grade_level}{child.section ? ` · ${child.section}` : ''} · applies to this child only
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <label className="block text-sm font-medium text-slate-700">Relationship
          <select className="input mt-1.5" value={form.relationship}
            onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}>
            {/* Keep a stored value the list no longer offers, rather than
                silently showing the first option and saving that. */}
            {!RELATIONSHIPS.includes(form.relationship) && <option>{form.relationship}</option>}
            {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 h-[42px] text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={form.is_emergency_contact}
            onChange={e => setForm(f => ({ ...f, is_emergency_contact: e.target.checked }))} />
          Emergency contact
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <DiscardButton onClick={() => setForm(start)} disabled={!dirty || busy} />
        <button onClick={onCancel} className="btn-secondary !h-9 !px-3 !text-[12.5px]">Cancel</button>
        <button disabled={!dirty || busy} onClick={save}
          className="btn-primary !h-9 !px-4 !text-[12.5px] disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

/* ── Removing them from one child ─────────────────────────────────────────
 * `DELETE /guardians/:gid` — the guardian entry goes, so they stop being this
 * learner's guardian entirely. That is NOT revoking access, which keeps every
 * entry and only stops sign-in, for all children at once. The panel never
 * offers this on the last child, because the server then deletes the account.
 *
 * The learner's other guardians are read on open so the dialog can say when
 * the learner would be left with nobody on record, or no emergency contact.
 */
function RemoveChild({ parent, child, kids, onClose, onRemoved }) {
  const [others, setOthers] = useState(null)   // the learner's other guardians; null while loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    studentApi.get(child.student_id)
      .then(res => { if (live) setOthers((res.data.student?.guardians || []).filter(g => g.id !== child.guardian_id)) })
      .catch(() => { if (live) setOthers([]) })
    return () => { live = false }
  }, [child.student_id, child.guardian_id])

  const remove = async () => {
    setBusy(true)
    try {
      await studentApi.removeGuardian(child.student_id, child.guardian_id)
      toast.success(`${parent.first_name} is no longer ${child.first_name}'s guardian.`, { duration: 6000 })
      onRemoved()
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  const left = kids - 1
  const noGuardians = others && others.length === 0
  const noEmergency = others && !noGuardians && child.is_emergency_contact && !others.some(g => g.is_emergency_contact)

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 leading-relaxed">
        <b className="text-slate-900">{parent.surname}, {parent.first_name}</b> will no longer be{' '}
        <b className="text-slate-900">{childName(child)}</b>'s {(child.relationship || 'guardian').toLowerCase()}
        {child.is_emergency_contact && ' or emergency contact'}, and {child.first_name} disappears from their VISTA
        Parent app. Their account and their other {left === 1 ? 'child stay' : `${left} children stay`} as they are.
      </p>
      <p className="text-xs text-slate-500 leading-relaxed">
        This is not the same as revoking access, which keeps them on every child and only stops them signing in.
      </p>
      {(noGuardians || noEmergency) && (
        <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
            {noGuardians
              ? `${child.first_name} will have no guardians on record.`
              : `${child.first_name} will have no emergency contact.`}
            {' '}Add one from their record under Manage Guardians.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button onClick={onClose} className="btn-secondary">Keep</button>
        <button disabled={busy || others === null} onClick={remove} className="btn-primary !bg-red-600 hover:!bg-red-700">
          {others === null ? 'Checking…' : busy ? 'Removing…' : `Remove ${child.first_name}`}
        </button>
      </div>
    </div>
  )
}

/* ── The person's own details ─────────────────────────────────────────────
 * Only the SHARED fields — the ones `PUT /guardians/:gid` writes to every
 * `parent_student` row of the account and to `users`. Relationship and
 * emergency contact are deliberately absent: those are per learner, and the panel
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
// The form's values as the account holds them — the starting point, and what
// Discard changes puts back.
const parentFields = (parent) => ({
  surname: parent.surname || '',
  first_name: parent.first_name || '',
  middle_name: parent.middle_name || '',
  phone: parent.phone || '',
  home_address: parent.home_address || '',
  email: parent.email || '',
})

function ParentDetailsForm({ parent, onCancel, onSaved }) {
  const [form, setForm] = useState(() => parentFields(parent))
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
        <DiscardButton onClick={() => setForm(parentFields(parent))} disabled={!dirty || busy} />
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

/* ── Invite Parent ────────────────────────────────────────────────────────
 * Laid out like Invite Teacher and Invite Admin — the person in one row, then
 * Sign-in email beside Mobile number, then what this account covers, then
 * "What happens next" — with the one thing a parent needs that staff do not:
 * their children. Those are part of the create, never a step after it: an
 * account with no learner is a state nothing in the app can express, and the
 * server refuses it too (`children` is min(1)). Save stays disabled until one
 * is listed.
 *
 * There is no "send the invitation?" switch. An account exists only because an
 * email was authorized, so creating one without inviting would ask for a row
 * the model has no state for.
 */
const emptyChild = () => ({
  key: Math.random().toString(36).slice(2),
  student: null, relationship: 'Mother', is_emergency_contact: false,
})

const FIELD_LABEL = 'block text-sm font-medium text-slate-700 mb-1.5'
const SECTION_LABEL = 'text-xs font-semibold text-slate-500 uppercase tracking-wider'

function InviteParentModal({ onClose, onCreated }) {
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
          is_emergency_contact: c.is_emergency_contact,
        })),
      })
      onCreated(res.data.parent)
    } catch { /* interceptor toasts */ } finally { setBusy(false) }
  }

  return (
    // `selfScroll` hands the body `overflow-hidden` and expects the children to
    // do the scrolling — so the sections below sit in their own scroll area and
    // the footer stays pinned. Without that the modal simply clipped everything
    // past 84vh, which hid the second child row and the button that adds it.
    <Modal open onClose={onClose} size="lg" selfScroll
      title={titled('Invite Parent', "They'll choose their own password when they activate the VISTA Parent app.")}>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-6">
        <section className="space-y-3">
          <p className={SECTION_LABEL}>Parent details</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={FIELD_LABEL} htmlFor="ip-surname">Surname</label>
              <input id="ip-surname" className="input" placeholder="Dela Cruz" required value={form.surname}
                onChange={e => set({ surname: e.target.value })} />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="ip-first">First name</label>
              <input id="ip-first" className="input" placeholder="Juan" required value={form.first_name}
                onChange={e => set({ first_name: e.target.value })} />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="ip-middle">Middle name <span className="text-slate-500 font-normal">(optional)</span></label>
              <input id="ip-middle" className="input" placeholder="Santos" value={form.middle_name}
                onChange={e => set({ middle_name: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_1fr] gap-3">
            <div>
              <label className={FIELD_LABEL} htmlFor="ip-email">Sign-in email</label>
              <input id="ip-email" type="email" required placeholder="name@email.com" value={form.email}
                className={clsx('input', emailView?.invalid && '!border-red-400 focus:!ring-red-500/20')}
                onChange={e => set({ email: e.target.value })}
                onBlur={() => emailCheck.check(form)} />
              {emailView?.invalid
                ? <p className="mt-1.5 text-xs text-red-600">{emailView.message}</p>
                : <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                    They'll sign in to the app with this address. You can still correct it until they activate.
                  </p>}
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="ip-phone">Mobile number</label>
              <PhoneInput id="ip-phone" className="input pr-10" required value={form.phone}
                onChange={v => set({ phone: v })} />
            </div>
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <p className={SECTION_LABEL}>Children</p>
            <span className="text-xs text-slate-500">They become a guardian of every learner listed</span>
          </div>
          {children.map((c) => (
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

        <WhatHappensNext steps={PARENT_NEXT} />
      </div>

      <div className="mt-4 pt-4 shrink-0 border-t border-slate-100 flex justify-end gap-3">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={!ready || busy} onClick={save} className="btn-primary disabled:opacity-50">
          {busy ? 'Creating…' : 'Create invitation'}
        </button>
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
          <input type="checkbox" checked={row.is_emergency_contact}
            onChange={e => onChange({ is_emergency_contact: e.target.checked })} />
          Emergency
        </label>
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Relationship and emergency contact are set per child.
      </p>
    </div>
  )
}

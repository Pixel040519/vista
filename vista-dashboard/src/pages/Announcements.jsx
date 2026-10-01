// ============================================================
// ANNOUNCEMENTS PAGE
// ============================================================
// A post can appear in two places: inside VISTA — staff, and parents in the
// vista_parent app, who can be pushed a notification — and on the public
// website. Every admin gets the two as separate tabs, and a post in both places
// is listed on both. The website is the super admin's: only they post or edit
// there, while scoped admins read its live posts so they know what the public
// has been told. Teachers only ever see VISTA (the API never sends them a
// website-only post), so their page is a plain reading feed with no tabs.
//
// The admin view is a board grouped by state — Scheduled, Live now, Drafts,
// then Expired folded away — so "what is out there and what is coming" reads
// at a glance. Cards show the opening of a post, never all of it; the whole
// post opens in a reading view. There are no count tiles above the board on
// purpose: the section headings already carry the counts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format as fmt, formatDistanceToNowStrict } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  Megaphone, Plus as PlusIcon, Pencil, Trash2, Globe, Pin, BellRing, MonitorSmartphone,
  MoreHorizontal, Search, ChevronRight, Info, FileText, Clock, Lock, Eye,
} from 'lucide-react'
import AnnouncementChanges from '../components/AnnouncementChanges'
import { announcementApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'
import AnnouncementForm, {
  AUDIENCE_LABEL, PARENT_AUDIENCES, STATES, CATEGORIES, categoryStyle,
} from '../components/AnnouncementForm'

const TABS = {
  vista: {
    label: 'VISTA Portal',
    icon: MonitorSmartphone,
    subtitle: 'Notices inside VISTA for staff, and for parents in the VISTA app',
    note: 'Seen only by people signed in to VISTA: teachers and admins on this Announcements page, and parents in the VISTA Parent app.',
    button: 'Post to VISTA',
    empty: ['Nothing posted in VISTA yet', 'Post a notice for staff or parents.'],
  },
  website: {
    label: 'Public Website',
    icon: Globe,
    subtitle: "Posts on the school's public website",
    note: "Anyone visiting the school website can read these — no login needed. The newest nine appear in Home's news carousel; every post is on its Announcements page.",
    button: 'Post to Website',
    empty: ['Nothing on the website yet', 'Until there is, the website says there are no announcements right now.'],
    // What a scoped admin sees instead: the tab is read-only for them.
    readOnlySubtitle: "What the school's public website is showing right now",
    readOnlyNote: 'What visitors to the school website can read right now. Only the super admin posts or edits here.',
    readOnlyEmpty: ['Nothing on the website right now', 'The website says there are no announcements.'],
  },
}

// Who actually reads a VISTA post, by audience. Admins see every post on this
// page because they manage it, which is not the post reaching staff — so a
// parents-only post reads "the parent app", never "teachers". Says *who*, not
// "the dashboard": the Dashboard page shows no announcements.
const REACH_TEXT = {
  all:      'teachers, admins and the parent app',
  parents:  'the parent app',
  teachers: 'teachers in VISTA',
  admins:   'admins in VISTA',
}

// The viewer's own posts are tinted so they can be found at a glance on a
// board shared with other admins. The name also reads "You", so the tint is
// never the only signal. ! because .card sets its own border and background.
const MINE_CARD = '!border-brand-200 !bg-brand-50/50'

// Which tab a post belongs on. A post in both places belongs on both.
const inTab = (a, t) => (t === 'website' ? a.is_public : a.in_vista !== false)

// "VISTA and the parent app", "the public website", or all three — for the
// delete confirmation, which has to say everywhere a post disappears from.
function reachText(a) {
  const places = []
  if (a.in_vista !== false) {
    places.push('VISTA')
    if (PARENT_AUDIENCES.includes(a.target_audience)) places.push('the parent app')
  }
  if (a.is_public) places.push('the public website')
  return places.length > 1 ? `${places.slice(0, -1).join(', ')} and ${places.at(-1)}` : places[0]
}

const initialsOf = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
const when = (a) => new Date(a.published_at || a.created_at)

function Avatar({ name, size = 'w-6 h-6 text-[10px]' }) {
  return (
    <span aria-hidden="true"
      className={clsx('rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center flex-shrink-0', size)}>
      {initialsOf(name)}
    </span>
  )
}

function StateChip({ state, children }) {
  const st = STATES[state] || STATES.published
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', st.cls)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', st.dot)} />
      {children || st.label}
    </span>
  )
}

function Badge({ icon: Icon, children, cls = 'bg-white text-slate-700' }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap shadow-sm', cls)}>
      {Icon && <Icon size={12} />} {children}
    </span>
  )
}

// Who can read a tab, on hover or keyboard focus. A real tooltip rather than
// the browser's `title`, which is slow to appear and came with a "?" cursor.
function InfoTip({ text }) {
  return (
    <span className="relative group self-center ml-1 mb-px">
      <button type="button" aria-label={text}
        className="w-7 h-7 grid place-items-center rounded-lg cursor-default text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
        <Info size={16} />
      </button>
      <span role="tooltip"
        className="pointer-events-none absolute right-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 top-full mt-2 z-30 w-72 max-w-[80vw] rounded-xl bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg opacity-0 invisible transition-opacity duration-100 group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible">
        {text}
      </span>
    </span>
  )
}

function SectionHead({ title, count, children }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{count}</span>
      <span className="flex-1 h-px bg-slate-200" />
      {children}
    </div>
  )
}

// The post's photo, or the category tile the website would draw without one.
function Cover({ a, className, iconSize = 36 }) {
  const cs = categoryStyle(a.category)
  if (a.image_url) return <img src={a.image_url} alt="" className={clsx('object-cover bg-slate-100', className)} />
  return (
    <span className={clsx('flex items-center justify-center', cs.tile, className)}>
      <cs.icon size={iconSize} strokeWidth={1.6} />
    </span>
  )
}

// Edit / Delete behind one button, so a card carries one quiet control
// instead of two loud ones.
function PostMenu({ a, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button type="button" aria-label={`Actions for ${a.title}`} aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-20 w-44 p-1 bg-white border border-slate-200 rounded-xl shadow-xl">
          <button type="button" onClick={() => { setOpen(false); onEdit(a) }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50">
            <Pencil size={14} /> Edit
          </button>
          <button type="button" onClick={() => { setOpen(false); onDelete(a) }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

// A live (or expired) post on the board.
function PostCard({ a, tab, showAudience, manage, mine, onOpen, onEdit, onDelete, muted }) {
  const cs = categoryStyle(a.category)
  const other = tab === 'website'
    ? (a.in_vista !== false && <Badge icon={MonitorSmartphone}>Also in VISTA</Badge>)
    : (a.is_public && <Badge icon={Globe} cls="bg-white text-violet-700">Also on website</Badge>)
  return (
    <article className={clsx('card flex flex-col min-w-0 transition-shadow hover:shadow-md', mine && MINE_CARD, muted && 'opacity-75')}>
      <button type="button" onClick={() => onOpen(a)} className="text-left flex flex-col flex-1">
        <span className="relative block w-full overflow-hidden rounded-t-2xl">
          <Cover a={a} className="w-full h-32" />
          <span className="absolute top-3 left-3 right-3 flex justify-between gap-2">
            <span>{a.is_pinned && a.state === 'published' && <Badge icon={Pin} cls="bg-white text-amber-800">Pinned</Badge>}</span>
            <span>{other}</span>
          </span>
        </span>
        <span className="px-4 pt-4 pb-3 flex flex-col gap-1.5 flex-1">
          <span className={clsx('text-[11px] font-bold uppercase tracking-wider', cs.text)}>
            {a.category}
            {showAudience && (
              <span className="normal-case tracking-normal font-semibold text-slate-500">
                {' · '}{a.in_vista === false ? 'Website only' : AUDIENCE_LABEL[a.target_audience] || a.target_audience}
              </span>
            )}
          </span>
          <span className="font-bold text-slate-900 leading-snug line-clamp-2 break-words">{a.title}</span>
          <span className="text-sm text-slate-600 leading-relaxed line-clamp-2 break-words">{a.content}</span>
        </span>
      </button>
      <div className={clsx('mx-4 py-3 border-t flex items-center gap-2 text-xs text-slate-500', mine ? 'border-brand-100' : 'border-slate-100')}>
        <Avatar name={a.posted_by_name} />
        <span className={clsx('truncate', mine ? 'font-semibold text-brand-700' : 'font-medium text-slate-700')}>{mine ? 'You' : a.posted_by_name || 'Unknown'}</span>
        <span aria-hidden="true">·</span>
        <span className="whitespace-nowrap">{fmt(when(a), 'MMM d')}</span>
        <span className="flex-1" />
        {a.state === 'published' && a.expires_at && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`Takes down ${fmt(new Date(a.expires_at), 'MMM d, yyyy h:mm a')}`}>
            <Clock size={12} /> Until {fmt(new Date(a.expires_at), 'MMM d')}
          </span>
        )}
        {a.notified_at && (
          <span className="text-emerald-600" title="Parents notified"><BellRing size={14} aria-label="Parents notified" /></span>
        )}
        {manage && <PostMenu a={a} onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </article>
  )
}

function ScheduledRow({ a, showAudience, manage, mine, onOpen, onEdit, onDelete }) {
  const at = when(a)
  return (
    <article className={clsx('card p-4 flex flex-col sm:flex-row sm:items-center gap-4', mine && MINE_CARD)}>
      <button type="button" onClick={() => onOpen(a)} className="flex items-center gap-4 text-left flex-1 min-w-0">
        <span className="w-16 h-[72px] rounded-xl bg-blue-50 flex flex-col items-center justify-center flex-shrink-0">
          <span className="text-[11px] font-bold tracking-wider text-blue-700 uppercase">{fmt(at, 'MMM')}</span>
          <span className="text-2xl leading-none font-bold text-slate-900">{fmt(at, 'd')}</span>
          <span className="text-xs text-slate-500 mt-0.5">{fmt(at, 'EEE')}</span>
        </span>
        <span className="flex flex-col gap-1 min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <StateChip state="scheduled">
              Goes live {fmt(at, 'h:mm a')} · {formatDistanceToNowStrict(at, { addSuffix: true })}
            </StateChip>
            <span className="text-xs text-slate-500">
              {a.category}{showAudience && ` · ${a.in_vista === false ? 'Website only' : AUDIENCE_LABEL[a.target_audience]}`}
              {mine && <span className="font-semibold text-brand-700"> · by you</span>}
            </span>
          </span>
          <span className="font-bold text-slate-900 break-words">{a.title}</span>
          <span className="text-sm text-slate-600 truncate">{a.content}</span>
        </span>
      </button>
      {manage && (
        <span className="flex items-center gap-1.5 self-end sm:self-auto">
          <button type="button" onClick={() => onEdit(a)} className="btn-secondary !py-2"><Pencil size={14} /> Edit</button>
          <PostMenu a={a} onEdit={onEdit} onDelete={onDelete} />
        </span>
      )}
    </article>
  )
}

function DraftRow({ a, showAudience, manage, mine, onEdit, onDelete }) {
  return (
    <article className={clsx('rounded-2xl border border-dashed p-4 flex flex-col sm:flex-row sm:items-center gap-3', mine ? 'border-brand-300 bg-brand-50/50' : 'border-slate-300 bg-white')}>
      <span className="flex items-center gap-3.5 flex-1 min-w-0">
        <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
          <FileText size={18} />
        </span>
        <span className="min-w-0">
          <span className="block font-bold text-slate-900 break-words">{a.title}</span>
          <span className="block text-xs text-slate-500 mt-0.5">
            {a.category}{showAudience && ` · ${a.in_vista === false ? 'Website only' : AUDIENCE_LABEL[a.target_audience]}`}
            {' · '}Last edited {fmt(new Date(a.updated_at || a.created_at), 'MMM d')}
            {mine ? ' by you' : a.posted_by_name ? ` by ${a.posted_by_name}` : ''} · Not visible to anyone yet
          </span>
        </span>
      </span>
      {manage && (
        <span className="flex items-center gap-1.5 self-end sm:self-auto">
          <button type="button" onClick={() => onEdit(a)} className="btn-secondary !py-2"><Pencil size={14} /> Continue editing</button>
          <PostMenu a={a} onEdit={onEdit} onDelete={onDelete} />
        </span>
      )}
    </article>
  )
}

function ReachRow({ icon: Icon, label, children, muted }) {
  return (
    <div className="grid grid-cols-[28px_120px_minmax(0,1fr)] sm:grid-cols-[28px_150px_minmax(0,1fr)] items-center gap-2.5 py-2.5 border-t border-slate-100 text-sm">
      <span className={clsx('w-7 h-7 rounded-lg flex items-center justify-center', muted ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-600')}>
        <Icon size={15} />
      </span>
      <span className="font-semibold text-slate-700">{label}</span>
      <span className={muted ? 'text-slate-500' : 'text-slate-700'}>{children}</span>
    </div>
  )
}

// The whole post. Cards only ever show its opening, so this is where it is read.
// The author stays named on the post, so a save by anyone else — the super
// admin may edit any post — is shown as one. `last_edit_*` comes from
// announcement_edits, which records only such saves and so survives the author
// re-saving afterwards; `updated_by` covers edits made before that table existed.
function otherEdit(a) {
  if (a.last_edit_at) return { name: a.last_edit_by_name, at: a.last_edit_at }
  if (a.updated_by && a.updated_by !== a.posted_by) return { name: a.updated_by_name, at: a.updated_at }
  return null
}

// "View changes" swaps the body for AnnouncementChanges rather than opening a
// second modal on top of this one.
function PostView({ a, userId, isAnyAdmin, manage, onClose, onEdit, onDelete }) {
  const [showChanges, setShowChanges] = useState(false)
  useEffect(() => { setShowChanges(false) }, [a?.id])
  if (!a) return null
  const cs = categoryStyle(a.category)
  const long = (d) => fmt(new Date(d), 'EEE, MMM d, yyyy · h:mm a')
  const edit = otherEdit(a)

  if (showChanges) {
    return (
      <Modal open onClose={onClose} title="What changed" size="lg">
        <AnnouncementChanges post={a} userId={userId} onBack={() => setShowChanges(false)} />
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="Announcement" size="lg">
      <div className="space-y-4">
        {isAnyAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <StateChip state={a.state} />
            {a.is_pinned && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800">
                <Pin size={12} /> Pinned
              </span>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <p className={clsx('text-xs font-bold uppercase tracking-wider', cs.text)}>{a.category}</p>
          <h2 className="text-xl font-bold text-slate-900 leading-snug break-words">{a.title}</h2>
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Avatar name={a.posted_by_name} size="w-5 h-5 text-[9px]" />
            {a.posted_by_name || 'Unknown'} · {a.state === 'draft' ? `Last edited ${long(a.updated_at || a.created_at)}` : long(when(a))}
          </p>
        </div>
        {a.image_url && <img src={a.image_url} alt="" className="w-full max-h-72 rounded-xl object-cover bg-slate-100" />}
        <p className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words select-text">{a.content}</p>

        {/* Under the text it is about, apart from the byline, so the author line
            stays the author's and the edit reads as a note on the post. What
            changed is only behind View changes, for the author and the editor. */}
        {edit && (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
            <span className="w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0">
              <Pencil size={13} />
            </span>
            <span className="min-w-0 flex-1 text-sm leading-tight">
              <span className="block text-slate-700">
                Edited by <span className="font-semibold text-slate-900">{edit.name || 'another admin'}</span>
              </span>
              {edit.at && <span className="block text-xs text-slate-500 mt-0.5">{long(edit.at)}</span>}
            </span>
            {a.can_view_edits && (
              <button type="button" onClick={() => setShowChanges(true)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-brand-600 hover:bg-brand-50">
                <Eye size={15} /> View changes
              </button>
            )}
          </div>
        )}

        {isAnyAdmin && (
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Where it appears</h3>
            {a.in_vista !== false ? (
              <ReachRow icon={MonitorSmartphone} label="VISTA Portal">
                {AUDIENCE_LABEL[a.target_audience]} — {REACH_TEXT[a.target_audience] || 'VISTA'}
              </ReachRow>
            ) : (
              <ReachRow icon={MonitorSmartphone} label="VISTA Portal" muted>Not shown inside VISTA</ReachRow>
            )}
            {a.is_public && <ReachRow icon={Globe} label="Public website">Home news carousel and the Announcements page</ReachRow>}
            {a.notified_at && <ReachRow icon={BellRing} label="Parents notified">Push sent {long(a.notified_at)}</ReachRow>}
            {a.state === 'scheduled' && <ReachRow icon={Clock} label="Goes live">{long(a.published_at)}</ReachRow>}
            {a.expires_at && (
              <ReachRow icon={Clock} label={a.state === 'expired' ? 'Taken down' : 'Takes down'}>{long(a.expires_at)}</ReachRow>
            )}
          </div>
        )}

        {isAnyAdmin && !manage && a.is_public && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Lock size={13} /> Only the super admin can edit or remove website posts.
          </p>
        )}

        {manage && (
          <div className="flex gap-2.5 pt-1">
            <button type="button" onClick={() => onDelete(a)}
              className="btn-secondary !text-red-600 hover:!bg-red-50"><Trash2 size={15} /> Delete</button>
            <span className="flex-1" />
            <button type="button" onClick={() => onEdit(a)} className="btn-primary"><Pencil size={15} /> Edit</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function SearchBox({ value, onChange, className }) {
  return (
    <label className={clsx('relative block', className)}>
      <span className="sr-only">Search announcements</span>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input type="search" className="input !pl-9" placeholder="Search announcements"
        value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
    </label>
  )
}

const matches = (a, q) => {
  if (!q) return true
  const s = q.toLowerCase()
  return a.title.toLowerCase().includes(s) || a.content.toLowerCase().includes(s)
}

// ── Teacher feed ─────────────────────────────────────────────
// Teachers only read: pinned posts lead as larger cards, then the rest as a
// list. Everything the API sends them is already live and meant for them.
function TeacherFeed({ posts, onOpen }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('All')
  const present = CATEGORIES.filter(c => posts.some(a => a.category === c))
  const shown = posts.filter(a => matches(a, q) && (category === 'All' || a.category === category))
  const pinned = shown.filter(a => a.is_pinned)
  const rest = shown.filter(a => !a.is_pinned)

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">School-wide notices and updates</p>
        </div>
        {posts.length > 0 && <SearchBox value={q} onChange={setQ} className="w-full sm:w-64" />}
      </div>

      {present.length > 1 && (
        <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
          {['All', ...present].map(c => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
              className={clsx(
                'px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors',
                category === c ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              )}>
              {c}
            </button>
          ))}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="card"><EmptyState icon={Megaphone} title="No announcements yet" description="Check back later for school updates." /></div>
      ) : shown.length === 0 ? (
        <div className="card"><EmptyState icon={Search} title="Nothing matches" description="Try another word or category." /></div>
      ) : (
        <>
          {pinned.map(a => {
            const cs = categoryStyle(a.category)
            return (
              <button key={a.id} type="button" onClick={() => onOpen(a)}
                className="card overflow-hidden w-full text-left grid sm:grid-cols-[240px_minmax(0,1fr)] hover:shadow-md transition-shadow">
                <span className="relative block">
                  <Cover a={a} className="w-full h-40 sm:h-full sm:min-h-[200px]" iconSize={48} />
                  <span className="absolute top-3 left-3"><Badge icon={Pin} cls="bg-white text-amber-800">Pinned</Badge></span>
                </span>
                <span className="p-5 sm:p-6 flex flex-col gap-2">
                  <span className={clsx('text-xs font-bold uppercase tracking-wider', cs.text)}>{a.category}</span>
                  <span className="text-xl font-bold text-slate-900 leading-snug break-words">{a.title}</span>
                  <span className="text-[15px] text-slate-600 leading-relaxed line-clamp-3 break-words">{a.content}</span>
                  <span className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                    <Avatar name={a.posted_by_name} />
                    {a.posted_by_name} · {fmt(when(a), 'EEE, MMM d')}
                    <span className="flex-1" />
                    <span className="inline-flex items-center gap-1 font-semibold text-brand-600">Read more <ChevronRight size={14} /></span>
                  </span>
                </span>
              </button>
            )
          })}

          {rest.length > 0 && (
            <div className="card overflow-hidden">
              <h2 className="px-5 sm:px-6 py-4 text-[15px] font-bold text-slate-900">Latest</h2>
              {rest.map(a => {
                const cs = categoryStyle(a.category)
                const d = when(a)
                return (
                  <button key={a.id} type="button" onClick={() => onOpen(a)}
                    className="w-full text-left flex gap-4 sm:gap-5 px-5 sm:px-6 py-4 border-t border-slate-100 hover:bg-slate-50/70">
                    <span className="w-12 flex flex-col items-center flex-shrink-0 pt-0.5">
                      <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{fmt(d, 'MMM')}</span>
                      <span className="text-2xl leading-tight font-bold text-slate-900">{fmt(d, 'd')}</span>
                      <span className="text-xs text-slate-500">{fmt(d, 'EEE')}</span>
                    </span>
                    <span className="flex flex-col gap-1 min-w-0">
                      <span className={clsx('inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider', cs.text)}>
                        <cs.icon size={13} /> {a.category}
                      </span>
                      <span className="font-bold text-slate-900 break-words">{a.title}</span>
                      <span className="text-sm text-slate-600 leading-relaxed line-clamp-2 break-words">{a.content}</span>
                      <span className="text-xs text-slate-500">{a.posted_by_name}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Announcements() {
  const { user, isAnyAdmin, isSuperAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading]   = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing]   = useState(null) // announcement being edited, or null for new
  const [viewing, setViewing]   = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [q, setQ]               = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [showExpired, setShowExpired] = useState(false)

  // Admins get both tabs; teachers only ever see VISTA.
  const tab = isAnyAdmin && searchParams.get('tab') === 'website' ? 'website' : 'vista'
  // The website tab is read-only for scoped admins: no post button, no "My
  // posts" (the API sends them only live website posts), and canManage()
  // already refuses every public post.
  const readOnlyTab = tab === 'website' && !isSuperAdmin
  const setTab = (next) => {
    setSearchParams(next === 'website' ? { tab: 'website' } : {}, { replace: true })
    setMineOnly(false)
    setShowExpired(false)
  }

  const load = () => {
    announcementApi.list()
      .then(res => setAnnouncements(res.data.announcements || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // ?view=<id> opens that post — the bell sends an author here when another
  // admin has edited their announcement. The param is consumed so a refresh
  // or Back does not reopen it, and a website-only post switches tabs.
  useEffect(() => {
    const id = searchParams.get('view')
    if (!id || loading) return
    const a = announcements.find(x => x.id === id)
    const keepTab = searchParams.get('tab') === 'website'
    const toWebsite = a && isAnyAdmin && (!inTab(a, 'vista') || (keepTab && inTab(a, 'website')))
    setSearchParams(toWebsite ? { tab: 'website' } : {}, { replace: true })
    if (a) setViewing(a)
    else toast.error('That announcement is no longer available.')
  }, [loading, announcements, searchParams])

  // Mirrors assertCanEdit() in announcement.routes.js.
  const canManage = (a) => isSuperAdmin || (a.posted_by === user?.id && !a.is_public)

  const openNew  = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (a) => { setViewing(null); setEditing(a); setFormOpen(true) }
  const askDelete = (a) => { setViewing(null); setDeleting(a) }
  const closeForm = () => { setFormOpen(false); setEditing(null) }

  const handleDelete = async () => {
    if (!deleting) return
    setSaving(true)
    try {
      await announcementApi.remove(deleting.id)
      toast.success('Announcement deleted.')
      setDeleting(null)
      load()
    } catch {}
    setSaving(false)
  }

  const tabCounts = useMemo(() => ({
    vista: announcements.filter(a => inTab(a, 'vista')).length,
    website: announcements.filter(a => inTab(a, 'website')).length,
  }), [announcements])

  const tabPosts = useMemo(
    () => (isAnyAdmin ? announcements.filter(a => inTab(a, tab)) : announcements),
    [announcements, isAnyAdmin, tab]
  )

  const visible = tabPosts.filter(a => matches(a, q) && (!mineOnly || a.posted_by === user?.id))
  const filtering = !!q || mineOnly

  // The API already orders pinned live posts first, then newest; scheduled
  // posts read soonest-first instead, since that is the order they will go out.
  const groups = useMemo(() => ({
    scheduled: visible.filter(a => a.state === 'scheduled').sort((x, y) => when(x) - when(y)),
    live:      visible.filter(a => a.state === 'published'),
    drafts:    visible.filter(a => a.state === 'draft'),
    expired:   visible.filter(a => a.state === 'expired'),
  }), [visible])

  const confirmDelete = (
    <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete announcement?" size="sm">
      <p className="text-sm text-slate-600">
        This removes "{deleting?.title}" from {deleting ? reachText(deleting) : ''}.
        This action cannot be undone.
      </p>
      <div className="flex gap-3 pt-4">
        <button type="button" onClick={() => setDeleting(null)} className="btn-secondary flex-1">Cancel</button>
        <button type="button" onClick={handleDelete} disabled={saving}
          className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700">
          {saving ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </Modal>
  )

  if (!isAnyAdmin) {
    return (
      <div className="animate-fade-in">
        {loading ? <LoadingSpinner /> : <TeacherFeed posts={announcements} onOpen={setViewing} />}
        <PostView a={viewing} userId={user?.id} onClose={() => setViewing(null)} />
      </div>
    )
  }

  const meta = TABS[tab]
  const subtitle = readOnlyTab ? meta.readOnlySubtitle : meta.subtitle
  const [emptyTitle, emptyText] = readOnlyTab ? meta.readOnlyEmpty : meta.empty
  // A website post is listed under the website tab already, so naming its
  // audience there would only repeat "Website only" or the VISTA badge.
  const showAudience = tab === 'vista'
  const rowProps = (a) => ({
    a, tab, showAudience, manage: canManage(a), mine: a.posted_by === user?.id,
    onOpen: setViewing, onEdit: openEdit, onDelete: askDelete,
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {readOnlyTab ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
            <Lock size={13} /> View only · managed by the Super Admin
          </span>
        ) : (
          <button onClick={openNew} className="btn-primary">
            <PlusIcon size={16} /> {isSuperAdmin ? meta.button : 'Post Announcement'}
          </button>
        )}
      </div>

      <div className="flex flex-col-reverse md:flex-row md:items-end gap-3 border-b border-slate-200">
        <div className="flex items-end min-w-0">
        <div className="flex items-end gap-1 -mb-px overflow-x-auto">
          {Object.entries(TABS).map(([id, t]) => (
            <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
              className={clsx(
                'inline-flex items-center gap-2 px-3.5 h-11 text-sm font-semibold transition-colors border-b-2 whitespace-nowrap',
                tab === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}>
              <t.icon size={15} />
              {t.label}
              <span className={clsx(
                'px-1.5 py-0.5 rounded-full text-xs font-medium',
                tab === id ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
              )}>
                {tabCounts[id]}
              </span>
            </button>
          ))}
        </div>
        {/* Outside the scrolling tab strip, which would clip the tooltip. */}
        <InfoTip text={readOnlyTab ? meta.readOnlyNote : meta.note} />
        </div>
        <span className="flex-1" />
        {tabPosts.length > 0 && (
          <div className="flex items-center gap-2 pb-2">
            <SearchBox value={q} onChange={setQ} className="flex-1 md:w-64" />
            {tab === 'vista' && (
              <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(m => !m)}
                className={clsx('btn-secondary whitespace-nowrap', mineOnly && '!bg-brand-50 !border-brand-200 !text-brand-700')}>
                My posts
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? <LoadingSpinner /> : tabPosts.length === 0 ? (
        <div className="card">
          <EmptyState icon={meta.icon} title={emptyTitle} description={emptyText} />
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState icon={Search} title="Nothing matches"
            description={mineOnly && !q ? 'You have not posted anything here yet.' : 'No announcements match your search.'}
            action={filtering && (
              <button type="button" className="btn-secondary" onClick={() => { setQ(''); setMineOnly(false) }}>
                Clear filters
              </button>
            )} />
        </div>
      ) : (
        <div className="space-y-6">
          {groups.scheduled.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="Scheduled" count={groups.scheduled.length} />
              {groups.scheduled.map(a => <ScheduledRow key={a.id} {...rowProps(a)} />)}
            </section>
          )}

          {groups.live.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="Live now" count={groups.live.length}>
                <span className="hidden sm:inline text-xs text-slate-500">Pinned first, then newest</span>
              </SectionHead>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {groups.live.map(a => <PostCard key={a.id} {...rowProps(a)} />)}
              </div>
            </section>
          )}

          {groups.drafts.length > 0 && (
            <section className="space-y-3">
              <SectionHead title="Drafts" count={groups.drafts.length} />
              {groups.drafts.map(a => <DraftRow key={a.id} {...rowProps(a)} />)}
            </section>
          )}

          {groups.expired.length > 0 && (
            <section className="space-y-3">
              <button type="button" aria-expanded={showExpired} onClick={() => setShowExpired(s => !s)}
                className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl border border-slate-200 bg-white/70 hover:bg-white text-left">
                <ChevronRight size={16} className={clsx('text-slate-500 transition-transform', showExpired && 'rotate-90')} />
                <span className="text-sm font-bold text-slate-700">Expired</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">{groups.expired.length}</span>
                <span className="hidden sm:inline text-sm text-slate-500">Taken down automatically — kept here for your records</span>
              </button>
              {showExpired && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {groups.expired.map(a => <PostCard key={a.id} {...rowProps(a)} muted />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <AnnouncementForm
        open={formOpen}
        channel={isSuperAdmin ? tab : 'vista'}
        editing={editing}
        onClose={closeForm}
        onSaved={() => { closeForm(); load() }}
      />

      <PostView a={viewing} userId={user?.id} isAnyAdmin manage={viewing ? canManage(viewing) : false}
        onClose={() => setViewing(null)} onEdit={openEdit} onDelete={askDelete} />

      {confirmDelete}
    </div>
  )
}

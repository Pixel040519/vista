// ============================================================
// ANNOUNCEMENTS PAGE
// ============================================================
// A post can appear in two places: inside VISTA — staff, and parents in the
// vista_parent app, who can be pushed a notification — and on the public
// website. Every admin gets the two as separate tabs, and a post in both places
// is listed on both. The website is the super admin's: only they post or edit
// there, while scoped admins read its live posts so they know what the public
// has been told. Teachers only ever see VISTA (the API never sends them a
// website-only post), so their page has no tabs at all.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format as fmt } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  Megaphone, Plus as PlusIcon, Pencil, Trash2, Globe, Pin, BellRing, MonitorSmartphone,
} from 'lucide-react'
import { announcementApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'
import AnnouncementForm, {
  AUDIENCE_LABEL, PARENT_AUDIENCES, STATES,
} from '../components/AnnouncementForm'

const TABS = {
  vista: {
    label: 'VISTA Portal',
    icon: MonitorSmartphone,
    subtitle: 'Notices inside VISTA for staff, and for parents in the VISTA app',
    note: 'Seen only by people signed in to VISTA — staff on the dashboard, parents in the VISTA app.',
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

export default function Announcements() {
  const { user, isAnyAdmin, isSuperAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading]   = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing]   = useState(null) // announcement being edited, or null for new
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [filter, setFilter]     = useState('all') // all | mine | published | scheduled | draft

  // Admins get both tabs; teachers only ever see VISTA.
  const tab = isAnyAdmin && searchParams.get('tab') === 'website' ? 'website' : 'vista'
  // The website tab is read-only for scoped admins: no post button, no filters
  // (the API sends them only live website posts), and canManage() already
  // refuses every public post.
  const readOnlyTab = tab === 'website' && !isSuperAdmin
  const setTab = (next) => {
    setSearchParams(next === 'website' ? { tab: 'website' } : {}, { replace: true })
    setFilter('all')
  }

  const load = () => {
    announcementApi.list()
      .then(res => setAnnouncements(res.data.announcements || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // Mirrors assertCanEdit() in announcement.routes.js.
  const canManage = (a) => isSuperAdmin || (a.posted_by === user?.id && !a.is_public)

  const openNew  = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (a) => { setEditing(a); setFormOpen(true) }
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

  const counts = useMemo(() => {
    const c = { all: tabPosts.length, mine: 0, published: 0, scheduled: 0, draft: 0 }
    for (const a of tabPosts) {
      if (a.posted_by === user?.id) c.mine++
      if (c[a.state] !== undefined) c[a.state]++
    }
    return c
  }, [tabPosts, user?.id])

  const visible = tabPosts.filter(a =>
    filter === 'all' ? true
    : filter === 'mine' ? a.posted_by === user?.id
    : a.state === filter
  )

  // Every website post is the super admin's own, so "My posts" would repeat "All".
  const FILTERS = [
    ['all', 'All'],
    ...(tab === 'website' ? [] : [['mine', 'My posts']]),
    ['published', 'Published'], ['scheduled', 'Scheduled'], ['draft', 'Drafts'],
  ]

  const meta = TABS[tab]
  const subtitle = !isAnyAdmin ? 'School-wide notices and updates'
    : readOnlyTab ? meta.readOnlySubtitle : meta.subtitle
  const [emptyTitle, emptyText] = !isAnyAdmin ? ['No announcements yet', 'Check back later for school updates.']
    : readOnlyTab ? meta.readOnlyEmpty : meta.empty

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {isAnyAdmin && !readOnlyTab && (
          <button onClick={openNew} className="btn-primary">
            <PlusIcon size={16} /> {isSuperAdmin ? meta.button : 'Post Announcement'}
          </button>
        )}
      </div>

      {isAnyAdmin && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-200">
            {Object.entries(TABS).map(([id, t]) => (
              <button key={id} onClick={() => setTab(id)}
                className={clsx(
                  'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px',
                  tab === id
                    ? 'border-brand-500 text-brand-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
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
          <p className="text-xs sm:text-sm text-slate-500">{readOnlyTab ? meta.readOnlyNote : meta.note}</p>
        </div>
      )}

      {isAnyAdmin && !readOnlyTab && (
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border ${
                filter === id
                  ? 'bg-brand-50 text-brand-700 border-brand-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
              }`}
            >
              {label} <span className="text-slate-400">{counts[id]}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? <LoadingSpinner /> : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={isAnyAdmin ? meta.icon : Megaphone}
            title={filter === 'all' ? emptyTitle : 'Nothing here'}
            description={filter === 'all' ? emptyText : 'No announcements match this filter.'}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(a => {
            const st = STATES[a.state] || STATES.published
            const audience = AUDIENCE_LABEL[a.target_audience] || a.target_audience
            return (
              <div key={a.id} className="card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                    {a.image_url ? (
                      <img src={a.image_url} alt="" className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover flex-shrink-0 bg-slate-100" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <Megaphone size={18} className="text-brand-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {a.is_pinned && <Pin size={14} className="text-brand-600" aria-label="Pinned" />}
                        <h3 className="font-semibold text-slate-900 break-words">{a.title}</h3>
                      </div>
                      <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap break-words">{a.content}</p>
                      <div className="flex items-center gap-2 mt-3 flex-wrap text-xs">
                        {isAnyAdmin && <span className={`px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>}
                        <span className="px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">{a.category}</span>
                        {tab === 'vista' ? (
                          <>
                            <span className="px-2 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">{audience}</span>
                            {a.is_public && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-700">
                                <Globe size={12} /> Also on website
                              </span>
                            )}
                          </>
                        ) : a.in_vista !== false && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">
                            <MonitorSmartphone size={12} /> Also in VISTA · {audience}
                          </span>
                        )}
                        {a.notified_at && isAnyAdmin && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700">
                            <BellRing size={12} /> Parents notified
                          </span>
                        )}
                        <span className="text-slate-400">
                          {a.posted_by_name ? `By ${a.posted_by_name} · ` : ''}
                          {a.state === 'scheduled' ? 'Goes live ' : ''}
                          {fmt(new Date(a.published_at || a.created_at), a.state === 'scheduled' ? 'MMM d, yyyy h:mm a' : 'MMM d, yyyy')}
                          {a.expires_at && a.state !== 'expired' ? ` · until ${fmt(new Date(a.expires_at), 'MMM d, h:mm a')}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isAnyAdmin && canManage(a) && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(a)} title="Edit announcement"
                        className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => setDeleting(a)} title="Delete announcement"
                        className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {isAnyAdmin && (
        <AnnouncementForm
          open={formOpen}
          channel={isSuperAdmin ? tab : 'vista'}
          editing={editing}
          onClose={closeForm}
          onSaved={() => { closeForm(); load() }}
        />
      )}

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
    </div>
  )
}

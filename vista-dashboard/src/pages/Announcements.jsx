// ============================================================
// ANNOUNCEMENTS PAGE
// ============================================================
// One announcement system with several reaches: staff (admins / teachers),
// parents — who read it in the vista_parent app, and can be pushed a
// notification — and, for the super admin only, the public website.
import { useEffect, useMemo, useRef, useState } from 'react'
import { format as fmt } from 'date-fns'
import toast from 'react-hot-toast'
import {
  Megaphone, Plus as PlusIcon, Pencil, Trash2, Globe, Pin, BellRing, ImagePlus, X as XIcon,
} from 'lucide-react'
import { announcementApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'

const AUDIENCES = [
  { id: 'all',      label: 'Everyone' },
  { id: 'parents',  label: 'Parents only' },
  { id: 'teachers', label: 'Teachers only' },
  { id: 'admins',   label: 'Admins only' },
]
const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES.map(a => [a.id, a.label]))
// Only these reach parents, and so only these may be public or notify anyone.
// The API and a table CHECK enforce the same rule.
const PARENT_AUDIENCES = ['all', 'parents']

const CATEGORIES = ['General', 'Enrollment', 'Event', 'Academic', 'Holiday', 'Suspension']

const STATES = {
  published: { label: 'Published', cls: 'bg-emerald-50 text-emerald-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700' },
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' },
  expired:   { label: 'Expired',   cls: 'bg-amber-50 text-amber-700' },
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const EMPTY_FORM = {
  title: '', summary: '', content: '', category: 'General', target_audience: 'all',
  is_public: false, is_pinned: false, mode: 'publish', publish_at: '', expires_at: '',
  notify_parents: false, image_consent: false, remove_image: false,
}

// <input type="datetime-local"> speaks local wall-clock time with no zone.
const toLocalInput = (iso) => (iso ? fmt(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '')

function formFrom(a) {
  return {
    ...EMPTY_FORM,
    title: a.title,
    summary: a.summary || '',
    content: a.content,
    category: a.category || 'General',
    target_audience: a.target_audience || 'all',
    is_public: !!a.is_public,
    is_pinned: !!a.is_pinned,
    mode: a.state === 'draft' ? 'draft' : a.state === 'scheduled' ? 'schedule' : 'publish',
    publish_at: a.state === 'scheduled' ? toLocalInput(a.published_at) : '',
    expires_at: toLocalInput(a.expires_at),
  }
}

export default function Announcements() {
  const { user, isAnyAdmin, isSuperAdmin } = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [editing, setEditing]   = useState(null) // announcement being edited, or null for new
  const [form, setForm]         = useState(EMPTY_FORM)
  const [image, setImage]       = useState(null) // { file, preview } for a newly chosen image
  const [deleting, setDeleting] = useState(null)
  const [filter, setFilter]     = useState('all') // all | mine | public | published | scheduled | draft
  const fileRef = useRef(null)

  const load = () => {
    announcementApi.list()
      .then(res => setAnnouncements(res.data.announcements || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // The object URL for a preview must be released or it leaks for the session.
  useEffect(() => () => { if (image?.preview) URL.revokeObjectURL(image.preview) }, [image])

  const set = (patch) => setForm(p => ({ ...p, ...patch }))

  // Mirrors assertCanEdit() in announcement.routes.js.
  const canManage = (a) => isSuperAdmin || (a.posted_by === user?.id && !a.is_public)

  const openNew = () => {
    setEditing(null); setForm(EMPTY_FORM); setImage(null); setShowForm(true)
  }
  const openEdit = (a) => {
    setEditing(a); setForm(formFrom(a)); setImage(null); setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditing(null); setImage(null) }

  const reachesParents = PARENT_AUDIENCES.includes(form.target_audience)
  const alreadyNotified = !!editing?.notified_at
  const canNotify = reachesParents && form.mode === 'publish' && !alreadyNotified
  const existingImage = editing?.image_url && !form.remove_image ? editing.image_url : null
  const shownImage = image?.preview || existingImage

  const setAudience = (target_audience) => {
    const parents = PARENT_AUDIENCES.includes(target_audience)
    set({
      target_audience,
      // A staff-only post can never be public or notify parents.
      ...(parents ? {} : { is_public: false, notify_parents: false }),
    })
  }

  const pickImage = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Choose a JPEG, PNG or WEBP photo.'); return
    }
    if (file.size > MAX_IMAGE_BYTES) { toast.error('Photo must be 4 MB or smaller.'); return }
    setImage({ file, preview: URL.createObjectURL(file) })
    set({ remove_image: false })
  }

  const clearImage = () => {
    setImage(null)
    set({ remove_image: !!editing?.image_url, image_consent: false })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (image && !form.image_consent) {
      toast.error('Confirm the photo can be shared before posting.'); return
    }
    const fd = new FormData()
    fd.append('title', form.title)
    fd.append('content', form.content)
    fd.append('summary', form.summary)
    fd.append('category', form.category)
    fd.append('target_audience', form.target_audience)
    fd.append('is_public', String(isSuperAdmin && reachesParents && form.is_public))
    fd.append('is_pinned', String(form.is_pinned))
    fd.append('status', form.mode)
    fd.append('publish_at', form.mode === 'schedule' ? fromLocalInput(form.publish_at) : '')
    fd.append('expires_at', fromLocalInput(form.expires_at))
    fd.append('notify_parents', String(canNotify && form.notify_parents))
    fd.append('remove_image', String(form.remove_image && !image))
    if (image) {
      fd.append('image', image.file)
      fd.append('image_consent', String(form.image_consent))
    }

    setSaving(true)
    try {
      const res = editing
        ? await announcementApi.update(editing.id, fd)
        : await announcementApi.create(fd)
      toast.success(res.data.message || 'Saved.')
      closeForm()
      load()
    } catch {}
    setSaving(false)
  }

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

  const counts = useMemo(() => {
    const c = { all: announcements.length, mine: 0, public: 0, published: 0, scheduled: 0, draft: 0 }
    for (const a of announcements) {
      if (a.posted_by === user?.id) c.mine++
      if (a.is_public) c.public++
      if (c[a.state] !== undefined) c[a.state]++
    }
    return c
  }, [announcements, user?.id])

  const visible = announcements.filter(a =>
    filter === 'all' ? true
    : filter === 'mine' ? a.posted_by === user?.id
    : filter === 'public' ? a.is_public
    : a.state === filter
  )

  const FILTERS = [
    ['all', 'All'], ['mine', 'My posts'],
    ...(isSuperAdmin ? [['public', 'On website']] : []),
    ['published', 'Published'], ['scheduled', 'Scheduled'], ['draft', 'Drafts'],
  ]

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">
            {isSuperAdmin
              ? 'Notices for staff, parents in the VISTA app, and the school website'
              : 'School-wide notices and updates'}
          </p>
        </div>
        {isAnyAdmin && (
          <button onClick={openNew} className="btn-primary">
            <PlusIcon size={16} /> Post Announcement
          </button>
        )}
      </div>

      {isAnyAdmin && (
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
            icon={Megaphone}
            title={filter === 'all' ? 'No announcements yet' : 'Nothing here'}
            description={filter === 'all' ? 'Check back later for school updates.' : 'No announcements match this filter.'}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(a => {
            const st = STATES[a.state] || STATES.published
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
                      {a.summary && <p className="text-sm text-slate-700 mt-1 font-medium">{a.summary}</p>}
                      <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap break-words">{a.content}</p>
                      <div className="flex items-center gap-2 mt-3 flex-wrap text-xs">
                        {isAnyAdmin && <span className={`px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>}
                        <span className="px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">{a.category}</span>
                        <span className="px-2 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">
                          {AUDIENCE_LABEL[a.target_audience] || a.target_audience}
                        </span>
                        {a.is_public && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-700">
                            <Globe size={12} /> Website
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

      <Modal open={showForm} onClose={closeForm} title={editing ? 'Edit Announcement' : 'Post Announcement'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Title *</label>
            <input className="input" maxLength={255} placeholder="Announcement title" value={form.title}
              onChange={e => set({ title: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Summary</label>
            <input className="input" maxLength={300} placeholder="One line shown on cards and in notifications"
              value={form.summary} onChange={e => set({ summary: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Content *</label>
            <textarea className="input min-h-32 resize-y" placeholder="Write the announcement..."
              value={form.content} onChange={e => set({ content: e.target.value })} required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
              <select className="input" value={form.category} onChange={e => set({ category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Audience in VISTA</label>
              <select className="input" value={form.target_audience} onChange={e => setAudience(e.target.value)}>
                {AUDIENCES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl border border-slate-200 p-3.5">
            {isSuperAdmin && (
              <label className={`flex items-start gap-2.5 text-sm ${reachesParents ? 'text-slate-700' : 'text-slate-400'}`}>
                <input type="checkbox" className="mt-0.5" disabled={!reachesParents}
                  checked={reachesParents && form.is_public}
                  onChange={e => set({ is_public: e.target.checked })} />
                <span>
                  <span className="font-medium">Also show on the public website</span>
                  <span className="block text-xs text-slate-500">
                    {reachesParents
                      ? 'Anyone visiting the school site can read it — no login needed.'
                      : 'Staff-only posts cannot be public. Choose Everyone or Parents only.'}
                  </span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={form.is_pinned}
                onChange={e => set({ is_pinned: e.target.checked })} />
              <span>
                <span className="font-medium">Pin to the top</span>
                <span className="block text-xs text-slate-500">Pinned posts are listed first while they are live.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2.5 text-sm ${canNotify ? 'text-slate-700' : 'text-slate-400'}`}>
              <input type="checkbox" className="mt-0.5" disabled={!canNotify}
                checked={canNotify && form.notify_parents}
                onChange={e => set({ notify_parents: e.target.checked })} />
              <span>
                <span className="font-medium">Notify parents</span>
                <span className="block text-xs text-slate-500">
                  {alreadyNotified ? 'Parents were already notified about this post.'
                    : !reachesParents ? 'This audience does not include parents.'
                    : form.mode !== 'publish' ? 'Available only when publishing now.'
                    : 'Sends a notification to every parent with an active VISTA account.'}
                </span>
              </span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Photo</label>
            {shownImage ? (
              <div className="relative inline-block">
                <img src={shownImage} alt="" className="h-36 max-w-full rounded-xl object-cover border border-slate-200" />
                <button type="button" onClick={clearImage} title="Remove photo"
                  className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/90 text-slate-700 shadow hover:bg-white">
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="btn-secondary">
                <ImagePlus size={16} /> Add a photo
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickImage} />
            {image && (
              <label className="flex items-start gap-2.5 text-sm text-slate-700 mt-2.5">
                <input type="checkbox" className="mt-0.5" checked={form.image_consent}
                  onChange={e => set({ image_consent: e.target.checked })} />
                <span>
                  This photo shows no identifiable learners, or the school has their parents' consent on file.
                  <span className="block text-xs text-slate-500">Required under the Data Privacy Act. Location data is removed from the photo automatically.</span>
                </span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">When</label>
              <select className="input" value={form.mode} onChange={e => set({ mode: e.target.value })}>
                <option value="publish">{editing && editing.state !== 'draft' && editing.state !== 'scheduled' ? 'Keep published' : 'Publish now'}</option>
                <option value="schedule">Schedule for later</option>
                <option value="draft">Save as draft</option>
              </select>
            </div>
            {form.mode === 'schedule' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Goes live *</label>
                <input type="datetime-local" className="input" required value={form.publish_at}
                  onChange={e => set({ publish_at: e.target.value })} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Take down on</label>
              <input type="datetime-local" className="input" value={form.expires_at}
                onChange={e => set({ expires_at: e.target.value })} />
              <p className="text-xs text-slate-500 mt-1">Optional. Hidden everywhere after this time.</p>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={closeForm} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? 'Saving...'
                : form.mode === 'draft' ? 'Save Draft'
                : form.mode === 'schedule' ? 'Schedule'
                : editing ? 'Save Changes' : 'Post Announcement'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete announcement?" size="sm">
        <p className="text-sm text-slate-600">
          This removes "{deleting?.title}" from VISTA{deleting?.is_public ? ', the parent app and the public website' : ' and the parent app'}.
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

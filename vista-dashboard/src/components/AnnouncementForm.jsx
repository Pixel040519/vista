// ============================================================
// ANNOUNCEMENT FORM
// ============================================================
// One post, two places it can appear: inside VISTA (staff, and parents in the
// vista_parent app) and on the public website. The page opens this form from
// one of them — its `channel` — and that place is fixed on; the other is an
// optional "Also…" so a post can still go to both on purpose. Scoped admins only
// ever post to VISTA. The API enforces every rule this form shows.
import { useEffect, useRef, useState } from 'react'
import { format as fmt } from 'date-fns'
import toast from 'react-hot-toast'
import { Globe, BellRing, ImagePlus, MonitorSmartphone, X as XIcon } from 'lucide-react'
import { announcementApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Modal } from './UI'

export const AUDIENCES = [
  { id: 'all',      label: 'Everyone' },
  { id: 'parents',  label: 'Parents only' },
  { id: 'teachers', label: 'Teachers only' },
  { id: 'admins',   label: 'Admins only' },
]
export const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES.map(a => [a.id, a.label]))
// Only these reach parents, and so only these may be public or notify anyone.
// The API and a table CHECK enforce the same rule.
export const PARENT_AUDIENCES = ['all', 'parents']

export const CATEGORIES = ['General', 'Enrollment', 'Event', 'Academic', 'Holiday', 'Suspension']

export const STATES = {
  published: { label: 'Published', cls: 'bg-emerald-50 text-emerald-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700' },
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' },
  expired:   { label: 'Expired',   cls: 'bg-amber-50 text-amber-700' },
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

// in_vista / is_public hold the *optional* place only; the channel's own place
// is always on (see inVista / isPublic in the component).
const EMPTY_FORM = {
  title: '', content: '', category: 'General', target_audience: 'all',
  in_vista: false, is_public: false, is_pinned: false, mode: 'publish', publish_at: '', expires_at: '',
  notify_parents: false, image_consent: false, remove_image: false,
}

// <input type="datetime-local"> speaks local wall-clock time with no zone.
const toLocalInput = (iso) => (iso ? fmt(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '')

function formFrom(a) {
  return {
    ...EMPTY_FORM,
    title: a.title,
    content: a.content,
    category: a.category || 'General',
    target_audience: a.target_audience || 'all',
    in_vista: a.in_vista !== false,
    is_public: !!a.is_public,
    is_pinned: !!a.is_pinned,
    mode: a.state === 'draft' ? 'draft' : a.state === 'scheduled' ? 'schedule' : 'publish',
    publish_at: a.state === 'scheduled' ? toLocalInput(a.published_at) : '',
    expires_at: toLocalInput(a.expires_at),
  }
}

function Check({ checked, disabled, onChange, title, hint }) {
  return (
    <label className={`flex items-start gap-2.5 text-sm ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>
      <input type="checkbox" className="mt-0.5" disabled={disabled}
        checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{title}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  )
}

function ReachChip({ icon: Icon, children, cls }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${cls}`}>
      <Icon size={12} /> {children}
    </span>
  )
}

/**
 * @param channel  'vista' | 'website' — where this form posts. Fixed on.
 * @param editing  the announcement being edited, or null for a new one
 */
export default function AnnouncementForm({ open, channel = 'vista', editing, onClose, onSaved }) {
  const { isSuperAdmin } = useAuth()
  const [form, setForm]     = useState(EMPTY_FORM)
  const [image, setImage]   = useState(null) // { file, preview } for a newly chosen image
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setForm(editing ? formFrom(editing) : EMPTY_FORM)
    setImage(null)
  }, [open, editing])

  // The object URL for a preview must be released or it leaks for the session.
  useEffect(() => () => { if (image?.preview) URL.revokeObjectURL(image.preview) }, [image])

  const set = (patch) => setForm(p => ({ ...p, ...patch }))

  const onWebsite = channel === 'website'
  const reachesParents = PARENT_AUDIENCES.includes(form.target_audience)
  // The channel's own place is always on; the other is the optional "Also…".
  const inVista  = !onWebsite || form.in_vista
  const isPublic = isSuperAdmin && (onWebsite || (form.is_public && reachesParents))
  const alreadyNotified = !!editing?.notified_at
  const canNotify = inVista && reachesParents && form.mode === 'publish' && !alreadyNotified
  const willNotify = canNotify && form.notify_parents
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
    fd.append('category', form.category)
    fd.append('target_audience', form.target_audience)
    fd.append('in_vista', String(inVista))
    fd.append('is_public', String(isPublic))
    fd.append('is_pinned', String(form.is_pinned))
    fd.append('status', form.mode)
    fd.append('publish_at', form.mode === 'schedule' ? fromLocalInput(form.publish_at) : '')
    fd.append('expires_at', fromLocalInput(form.expires_at))
    fd.append('notify_parents', String(willNotify))
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
      onSaved?.()
    } catch {}
    setSaving(false)
  }

  const notifyHint = alreadyNotified ? 'Parents were already notified about this post.'
    : !reachesParents ? 'This audience does not include parents.'
    : form.mode !== 'publish' ? 'Available only when publishing now.'
    : 'Sends a notification to every parent with an active VISTA account.'

  const title = editing ? 'Edit Announcement'
    : !isSuperAdmin ? 'Post Announcement'
    : onWebsite ? 'Post to the Website' : 'Post to VISTA'

  const submitLabel = saving ? 'Saving...'
    : form.mode === 'draft' ? 'Save Draft'
    : form.mode === 'schedule' ? 'Schedule'
    : editing ? 'Save Changes'
    : !isSuperAdmin ? 'Post Announcement'
    : onWebsite ? 'Post to Website' : 'Post to VISTA'

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Title *</label>
          <input className="input" maxLength={255} placeholder="Announcement title" value={form.title}
            onChange={e => set({ title: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Content *</label>
          <textarea className="input min-h-32 resize-y" placeholder="Write the announcement..."
            value={form.content} onChange={e => set({ content: e.target.value })} required />
          <p className="text-xs text-slate-500 mt-1">The opening lines are what cards and notifications show, so lead with the main point.</p>
        </div>

        {onWebsite ? (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
            <select className="input" value={form.category} onChange={e => set({ category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-slate-500 mt-1">Also picks the picture the website draws when the post has no photo.</p>
          </div>
        ) : (
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
        )}

        <div className="space-y-2.5 rounded-xl border border-slate-200 p-3.5">
          <Check
            checked={form.is_pinned}
            onChange={v => set({ is_pinned: v })}
            title="Pin to the top"
            hint={onWebsite
              ? "Listed first in the website's news carousel and Announcements page while it is live."
              : 'Pinned posts are listed first while they are live.'}
          />

          {onWebsite ? (
            <>
              <Check
                checked={form.in_vista}
                onChange={v => set({ in_vista: v, ...(v ? {} : { notify_parents: false }) })}
                title="Also show in VISTA"
                hint="Puts the same post inside VISTA too — for staff, and for parents in the VISTA app."
              />
              {form.in_vista && (
                <div className="ml-6 space-y-2.5 border-l-2 border-slate-100 pl-3.5">
                  <div className="max-w-xs">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Audience in VISTA</label>
                    <select className="input" value={form.target_audience} onChange={e => setAudience(e.target.value)}>
                      {AUDIENCES.filter(a => PARENT_AUDIENCES.includes(a.id)).map(a => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <Check
                    checked={canNotify && form.notify_parents}
                    disabled={!canNotify}
                    onChange={v => set({ notify_parents: v })}
                    title="Notify parents"
                    hint={notifyHint}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <Check
                checked={canNotify && form.notify_parents}
                disabled={!canNotify}
                onChange={v => set({ notify_parents: v })}
                title="Notify parents"
                hint={notifyHint}
              />
              {isSuperAdmin && (
                <Check
                  checked={reachesParents && form.is_public}
                  disabled={!reachesParents}
                  onChange={v => set({ is_public: v })}
                  title="Also post on the public website"
                  hint={reachesParents
                    ? 'Anyone visiting the school site can read it — no login needed.'
                    : 'Staff-only posts cannot be public. Choose Everyone or Parents only.'}
                />
              )}
            </>
          )}
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
          {isPublic && !shownImage && (
            <p className="text-xs text-slate-500 mt-1">Optional. On the website it becomes the post's card image; without one the site draws a tile for the category.</p>
          )}
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

        {/* Where the save will put it — the one line that confirms the reach. */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs">
          <span className="font-medium text-slate-600 mr-0.5">
            {form.mode === 'draft' ? 'Once published, appears on'
              : form.mode === 'schedule' ? 'Once live, appears on'
              : 'Appears on'}
          </span>
          {isPublic && <ReachChip icon={Globe} cls="bg-violet-50 text-violet-700">Public website</ReachChip>}
          {inVista && (
            <ReachChip icon={MonitorSmartphone} cls="bg-brand-50 text-brand-700">
              VISTA · {AUDIENCE_LABEL[form.target_audience] || form.target_audience}
            </ReachChip>
          )}
          {willNotify && <ReachChip icon={BellRing} cls="bg-emerald-50 text-emerald-700">Parents notified</ReachChip>}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

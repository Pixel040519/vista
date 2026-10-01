// ============================================================
// ANNOUNCEMENT FORM
// ============================================================
// One post, two places it can appear: inside VISTA (staff, and parents in the
// vista_parent app) and on the public website. The page opens this form from
// one of them — its `channel` — and that place is fixed on; the other is an
// optional second "Post to" card so a post can still go to both on purpose.
// Scoped admins only ever post to VISTA, so they get no "Post to" choice at all.
// The API enforces every rule this form shows.
//
// Layout is one column in three bands: what the post says (title, message,
// category, audience), where and when it goes (Post to, Notify parents, When),
// and "More options" (photo, pin, take-down) folded away because most posts
// need none of them. The footer's "Appears on" line is the one confirmation of
// reach before saving.
import { useEffect, useRef, useState } from 'react'
import { format as fmt } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  Globe, BellRing, ImagePlus, MonitorSmartphone, X as XIcon, ChevronRight, Lock, Info,
  Megaphone, ClipboardList, CalendarDays, BookOpen, Sun, CloudRain,
} from 'lucide-react'
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

// The tile drawn for a post with no photo — the same idea the website uses, so
// a post looks like itself in both places. Class strings are written out in
// full because Tailwind's scanner only sees whole class names.
export const CATEGORY_STYLE = {
  General:    { icon: Megaphone,     tile: 'bg-slate-100 text-slate-600',    text: 'text-slate-600' },
  Enrollment: { icon: ClipboardList, tile: 'bg-brand-50 text-brand-600',     text: 'text-brand-600' },
  Event:      { icon: CalendarDays,  tile: 'bg-amber-50 text-amber-700',     text: 'text-amber-700' },
  Academic:   { icon: BookOpen,      tile: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-700' },
  Holiday:    { icon: Sun,           tile: 'bg-rose-50 text-rose-700',       text: 'text-rose-700' },
  Suspension: { icon: CloudRain,     tile: 'bg-orange-50 text-orange-700',   text: 'text-orange-700' },
}
export const categoryStyle = (c) => CATEGORY_STYLE[c] || CATEGORY_STYLE.General

export const STATES = {
  published: { label: 'Published', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700',       dot: 'bg-blue-500' },
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400' },
  expired:   { label: 'Expired',   cls: 'bg-amber-50 text-amber-700',     dot: 'bg-amber-500' },
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

// Who the API notifies in the bell when the post goes live, by audience.
const STAFF_NOTICE = {
  all:      'Teachers & admins notified',
  teachers: 'Teachers notified',
  admins:   'Admins notified',
}

// in_vista / is_public hold the *optional* place only; the channel's own place
// is always on (see inVista / isPublic in the component). `mode` is the When
// choice — 'publish' or 'schedule'; a draft is saved by its own button.
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
    // A draft opens on "Publish now": the When choice says what happens when
    // it is posted, and saving it as a draft again is the Save draft button.
    mode: a.state === 'scheduled' ? 'schedule' : 'publish',
    publish_at: a.state === 'scheduled' ? toLocalInput(a.published_at) : '',
    expires_at: toLocalInput(a.expires_at),
  }
}

function Field({ label, optional, hint, children }) {
  return (
    <div>
      <span className="flex items-baseline gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {optional && <span className="text-xs font-normal text-slate-500">Optional</span>}
      </span>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function Switch({ checked, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative w-10 h-6 rounded-full flex-shrink-0 transition-colors disabled:cursor-not-allowed',
        checked ? 'bg-brand-500' : 'bg-slate-300',
        disabled && 'opacity-50'
      )}>
      <span className={clsx(
        'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
        checked && 'translate-x-4'
      )} />
    </button>
  )
}

// One of the two places a post can go. `locked` is the channel the form was
// opened from: always on, shown so both places read as one choice.
function PlaceCard({ icon: Icon, title, hint, checked, locked, disabled, onChange }) {
  return (
    <label className={clsx(
      'flex-1 flex items-start gap-3 p-3 rounded-xl border transition-colors',
      checked ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 bg-white',
      disabled ? 'opacity-60 cursor-not-allowed' : locked ? 'cursor-default' : 'cursor-pointer hover:border-slate-300'
    )}>
      <input type="checkbox" className="mt-0.5 accent-brand-500" checked={checked}
        disabled={locked || disabled} onChange={e => onChange?.(e.target.checked)} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Icon size={15} className="text-slate-500" /> {title}
          {locked && <Lock size={12} className="text-slate-400" aria-label="Always on for this tab" />}
        </span>
        <span className="block text-xs text-slate-500 mt-0.5 leading-snug">{hint}</span>
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
  const { user, isSuperAdmin } = useAuth()
  const [form, setForm]       = useState(EMPTY_FORM)
  const [image, setImage]     = useState(null) // { file, preview } for a newly chosen image
  const [saving, setSaving]   = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const fileRef    = useRef(null)
  const titleRef   = useRef(null)
  const contentRef = useRef(null)
  const formRef    = useRef(null)

  useEffect(() => {
    if (!open) return
    setForm(editing ? formFrom(editing) : EMPTY_FORM)
    setImage(null)
    // Open the extras when the post already uses one, so nothing set is hidden.
    setMoreOpen(!!(editing && (editing.image_url || editing.is_pinned || editing.expires_at)))
  }, [open, editing])

  // The object URL for a preview must be released or it leaks for the session.
  useEffect(() => () => { if (image?.preview) URL.revokeObjectURL(image.preview) }, [image])

  const set = (patch) => setForm(p => ({ ...p, ...patch }))

  const onWebsite = channel === 'website'
  const reachesParents = PARENT_AUDIENCES.includes(form.target_audience)
  // The channel's own place is always on; the other is the optional second card.
  const inVista  = !onWebsite || form.in_vista
  const isPublic = isSuperAdmin && (onWebsite || (form.is_public && reachesParents))
  const alreadyNotified = !!editing?.notified_at
  const canNotify = inVista && reachesParents && form.mode === 'publish' && !alreadyNotified
  const willNotify = canNotify && form.notify_parents
  const existingImage = editing?.image_url && !form.remove_image ? editing.image_url : null
  const shownImage = image?.preview || existingImage
  const wasLive = editing && ['published', 'expired'].includes(editing.state)
  // Staff in the audience are told automatically when a post goes live in VISTA
  // (syncStaffNotifications on the API), once per post — so a post that has
  // already been live is not announced again. Parents are the switch above.
  const staffNotice = inVista && !wasLive ? STAFF_NOTICE[form.target_audience] : null
  // Only the super admin can reach someone else's post (assertCanEdit), and the
  // card will go on naming the author, so say so before the save rather than after.
  const othersPost = editing && editing.posted_by && editing.posted_by !== user?.id

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

  // `asDraft` comes from the Save draft button, which sits outside the When
  // choice: a draft needs only a title and message, never a go-live time.
  const save = async (asDraft) => {
    if (asDraft) {
      if (!titleRef.current?.reportValidity() || !contentRef.current?.reportValidity()) return
    } else if (!formRef.current?.reportValidity()) {
      return
    }
    if (image && !form.image_consent) {
      setMoreOpen(true)
      toast.error('Confirm the photo can be shared before posting.'); return
    }
    const status = asDraft ? 'draft' : form.mode
    const fd = new FormData()
    fd.append('title', form.title)
    fd.append('content', form.content)
    fd.append('category', form.category)
    fd.append('target_audience', form.target_audience)
    fd.append('in_vista', String(inVista))
    fd.append('is_public', String(isPublic))
    fd.append('is_pinned', String(form.is_pinned))
    fd.append('status', status)
    fd.append('publish_at', status === 'schedule' ? fromLocalInput(form.publish_at) : '')
    fd.append('expires_at', fromLocalInput(form.expires_at))
    fd.append('notify_parents', String(!asDraft && willNotify))
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
    : 'One push to every parent with an active account. Sent once.'

  const title = editing ? 'Edit Announcement'
    : !isSuperAdmin ? 'Post Announcement'
    : onWebsite ? 'Post to the Website' : 'Post to VISTA'

  const submitLabel = saving ? 'Saving...'
    : form.mode === 'schedule' ? (editing?.state === 'scheduled' ? 'Save changes' : 'Schedule')
    : wasLive ? 'Save changes'
    : editing ? 'Publish'
    : !isSuperAdmin ? 'Post Announcement'
    : onWebsite ? 'Post to Website' : 'Post to VISTA'

  const draftLabel = wasLive ? 'Move to drafts' : 'Save draft'

  const extras = [
    shownImage && 'Photo added',
    form.is_pinned && 'Pinned',
    form.expires_at && `Takes down ${fmt(new Date(form.expires_at), 'MMM d')}`,
  ].filter(Boolean)

  const vistaCard = (
    <PlaceCard key="vista" icon={MonitorSmartphone} title="VISTA Portal"
      hint="Teachers, admins and the parent app"
      checked={inVista} locked={!onWebsite}
      onChange={v => set({ in_vista: v, ...(v ? {} : { notify_parents: false }) })} />
  )
  // Mirrors assertCanPublish(): a post goes public only by its author, so the
  // super admin cannot put an ECE or Elementary admin's post on the website.
  // One already public stays as it is (and can still be taken off).
  const othersPrivatePost = othersPost && !editing.is_public
  const websiteCard = (
    <PlaceCard key="website" icon={Globe} title="Public website"
      hint={othersPrivatePost ? 'Only its author can put it on the website'
        : reachesParents || onWebsite ? 'Anyone can read it — no login needed'
        : 'Only for posts to Everyone or Parents'}
      checked={isPublic} locked={onWebsite}
      disabled={!onWebsite && (!reachesParents || othersPrivatePost)}
      onChange={v => set({ is_public: v })} />
  )

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" selfScroll>
      <form ref={formRef} onSubmit={e => { e.preventDefault(); save(false) }}
        className="flex flex-col flex-1 min-h-0 -mx-4 sm:-mx-6 -my-5">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
          {othersPost && (
            <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-sm text-blue-900">
              <Info size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
              <span>
                You're editing <strong>{editing.posted_by_name || 'another admin'}</strong>'s post.
                They stay listed as the author, the post will show that you edited it, and they can see exactly what you changed.
              </span>
            </div>
          )}
          <Field label="Title">
            <input ref={titleRef} className="input" maxLength={255} placeholder="What is this about?"
              value={form.title} onChange={e => set({ title: e.target.value })} required />
          </Field>
          <Field label="Message"
            hint="Lead with the main point — the opening lines show on cards and in the notification.">
            <textarea ref={contentRef} className="input min-h-32 resize-y" placeholder="Write the announcement..."
              value={form.content} onChange={e => set({ content: e.target.value })} required />
          </Field>

          <div className={clsx('grid gap-4', inVista && 'sm:grid-cols-2')}>
            <Field label="Category"
              hint={isPublic && !inVista ? 'Also picks the picture the website draws when the post has no photo.' : null}>
              <select className="input" value={form.category} onChange={e => set({ category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            {inVista && (
              <Field label="Audience in VISTA">
                <select className="input" value={form.target_audience} onChange={e => setAudience(e.target.value)}>
                  {/* The website form never offers staff audiences: a public post must reach parents. */}
                  {AUDIENCES.filter(a => !onWebsite || PARENT_AUDIENCES.includes(a.id)).map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {isSuperAdmin && (
            <Field label="Post to">
              <div className="flex flex-col sm:flex-row gap-2.5">
                {onWebsite ? [websiteCard, vistaCard] : [vistaCard, websiteCard]}
              </div>
            </Field>
          )}

          {inVista && (
            <div className={clsx(
              'flex items-start justify-between gap-4 rounded-xl px-3.5 py-3',
              canNotify ? 'bg-slate-50' : 'bg-slate-50/60'
            )}>
              <span>
                <span className={clsx('flex items-center gap-1.5 text-sm font-semibold',
                  canNotify ? 'text-slate-900' : 'text-slate-500')}>
                  <BellRing size={15} /> Notify parents
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">{notifyHint}</span>
              </span>
              <Switch label="Notify parents" checked={canNotify && form.notify_parents} disabled={!canNotify}
                onChange={v => set({ notify_parents: v })} />
            </div>
          )}

          <Field label="When">
            <div role="group" aria-label="When" className="flex p-1 bg-slate-100 rounded-xl">
              {[['publish', wasLive ? 'Keep published' : 'Publish now'], ['schedule', 'Schedule for later']].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={form.mode === id}
                  onClick={() => set({ mode: id })}
                  className={clsx(
                    'flex-1 h-9 rounded-lg text-sm font-semibold transition-colors',
                    form.mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}>
                  {label}
                </button>
              ))}
            </div>
            {form.mode === 'schedule' && (
              <div className="mt-3 max-w-xs">
                <label className="block text-xs font-medium text-slate-600 mb-1">Goes live</label>
                <input type="datetime-local" className="input" required value={form.publish_at}
                  onChange={e => set({ publish_at: e.target.value })} />
              </div>
            )}
          </Field>

          <div className="border-t border-slate-100 pt-1">
            <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}
              className="w-full flex items-center gap-2 py-2.5 text-left">
              <ChevronRight size={16} className={clsx('text-slate-500 transition-transform', moreOpen && 'rotate-90')} />
              <span className="text-sm font-semibold text-slate-700">More options</span>
              <span className="text-xs text-slate-500 truncate">
                {extras.length ? extras.join(' · ') : 'Photo, pin to top, take-down date'}
              </span>
            </button>

            {moreOpen && (
              <div className="space-y-5 pl-6 pt-2 pb-1">
                <Field label="Photo" optional
                  hint={isPublic && !shownImage ? "On the website it becomes the post's card image; without one the site draws a tile for the category." : null}>
                  {shownImage ? (
                    <div className="relative inline-block">
                      <img src={shownImage} alt="" className="h-32 max-w-full rounded-xl object-cover border border-slate-200" />
                      <button type="button" onClick={clearImage} aria-label="Remove photo"
                        className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/90 text-slate-700 shadow hover:bg-white">
                        <XIcon size={14} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 hover:bg-slate-50 text-left">
                      <ImagePlus size={20} className="text-slate-500" />
                      <span>
                        <span className="block text-sm font-semibold text-slate-700">Add a photo</span>
                        <span className="block text-xs text-slate-500">JPG, PNG or WEBP, up to 4 MB</span>
                      </span>
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
                </Field>

                <label className="flex items-start gap-2.5 text-sm text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={form.is_pinned}
                    onChange={e => set({ is_pinned: e.target.checked })} />
                  <span>
                    <span className="font-medium">Pin to the top</span>
                    <span className="block text-xs text-slate-500">
                      {isPublic
                        ? "Listed first here and in the website's news carousel while it is live."
                        : 'Listed first while it is live.'}
                    </span>
                  </span>
                </label>

                <div className="max-w-xs">
                  <Field label="Take down on" optional hint="Hidden everywhere after this time.">
                    <input type="datetime-local" className="input" value={form.expires_at}
                      onChange={e => set({ expires_at: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Where the save will put it — the one line that confirms the reach. */}
        <div className="shrink-0 border-t border-slate-100 px-4 sm:px-6 py-3.5 space-y-3 bg-white rounded-b-2xl">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-medium text-slate-600 mr-0.5">
              {form.mode === 'schedule' ? 'Once live, appears on' : 'Appears on'}
            </span>
            {isPublic && <ReachChip icon={Globe} cls="bg-violet-50 text-violet-700">Public website</ReachChip>}
            {inVista && (
              <ReachChip icon={MonitorSmartphone} cls="bg-brand-50 text-brand-700">
                VISTA · {AUDIENCE_LABEL[form.target_audience] || form.target_audience}
              </ReachChip>
            )}
            {willNotify && <ReachChip icon={BellRing} cls="bg-emerald-50 text-emerald-700">Parents notified</ReachChip>}
            {staffNotice && (
              <ReachChip icon={BellRing} cls="bg-amber-50 text-amber-800">
                {staffNotice}{form.mode === 'schedule' ? ' when live' : ''}
              </ReachChip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={onClose} className="btn-secondary !border-transparent !shadow-none">Cancel</button>
            <span className="flex-1" />
            <button type="button" onClick={() => save(true)} disabled={saving} className="btn-secondary">
              {draftLabel}
            </button>
            <button type="submit" disabled={saving} className="btn-primary justify-center">
              {submitLabel}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

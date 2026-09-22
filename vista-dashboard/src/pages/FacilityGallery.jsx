// ============================================================
// FACILITY GALLERY PAGE (super admin)
// ============================================================
// The photos the public website shows under "Our facilities". The first photo
// of each facility is its cover on the site's grid; the rest open in the
// site's viewer in this order. Hidden facilities stay here but leave the site.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Building2, Plus as PlusIcon, Pencil, Trash2, ImagePlus, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, Star, Eye, EyeOff, Check, X as XIcon,
} from 'lucide-react'
import { facilityApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'

const MAX_FILES = 10
const MAX_BYTES = 4 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

function move(list, from, to) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export default function FacilityGallery() {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)

  const [nameModal, setNameModal] = useState(null) // { id?, name }
  const [deleting, setDeleting] = useState(null)   // facility pending delete
  const [upload, setUpload] = useState(null)       // { files: File[], consent }
  const [captionEdit, setCaptionEdit] = useState(null) // { id, caption }
  const fileRef = useRef(null)

  const selected = facilities.find(f => f.id === selectedId) || null

  const load = (keepId) => facilityApi.list()
    .then(res => {
      const list = res.data.facilities || []
      setFacilities(list)
      setSelectedId(prev => {
        const want = keepId ?? prev
        return list.some(f => f.id === want) ? want : list[0]?.id ?? null
      })
    })
    .catch(() => {})
    .finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  // Replace one facility in place from a response that carries it.
  const replace = (facility) =>
    setFacilities(list => list.map(f => (f.id === facility.id ? facility : f)))

  const run = async (fn) => {
    setBusy(true)
    try { await fn() } catch {}
    setBusy(false)
  }

  // ── Facilities ────────────────────────────────────────────
  const saveName = (e) => {
    e.preventDefault()
    const { id, name, is_active } = nameModal
    run(async () => {
      const res = id
        ? await facilityApi.update(id, { name, is_active })
        : await facilityApi.create({ name })
      toast.success(res.data.message)
      setNameModal(null)
      await load(res.data.facility.id)
    })
  }

  const toggleHidden = (f) => run(async () => {
    const res = await facilityApi.update(f.id, { name: f.name, is_active: !f.is_active })
    replace(res.data.facility)
    toast.success(f.is_active ? `${f.name} is hidden from the website.` : `${f.name} is back on the website.`)
  })

  const moveFacility = (index, dir) => run(async () => {
    const ids = move(facilities, index, index + dir).map(f => f.id)
    const res = await facilityApi.reorder(ids)
    setFacilities(res.data.facilities)
  })

  const confirmDelete = () => run(async () => {
    await facilityApi.remove(deleting.id)
    toast.success('Facility deleted.')
    setDeleting(null)
    await load(null)
  })

  // ── Photos ────────────────────────────────────────────────
  const pickFiles = (e) => {
    const all = Array.from(e.target.files || [])
    e.target.value = ''
    if (!all.length) return
    const bad = all.filter(f => !TYPES.includes(f.type) || f.size > MAX_BYTES)
    if (bad.length) toast.error(`${bad.length} file${bad.length === 1 ? ' was' : 's were'} skipped — use JPEG, PNG or WEBP up to 4 MB.`)
    const ok = all.filter(f => !bad.includes(f)).slice(0, MAX_FILES)
    if (all.length - bad.length > MAX_FILES) toast.error(`Up to ${MAX_FILES} photos at a time.`)
    if (ok.length) setUpload({ files: ok, consent: false })
  }

  const submitUpload = (e) => {
    e.preventDefault()
    run(async () => {
      const fd = new FormData()
      upload.files.forEach(f => fd.append('photos', f))
      fd.append('consent', String(upload.consent))
      const res = await facilityApi.addPhotos(selected.id, fd)
      replace(res.data.facility)
      toast.success(res.data.message)
      setUpload(null)
    })
  }

  const movePhoto = (index, to) => run(async () => {
    const ids = move(selected.photos, index, to).map(p => p.id)
    const res = await facilityApi.reorderPhotos(selected.id, ids)
    replace(res.data.facility)
  })

  const saveCaption = (e) => {
    e.preventDefault()
    run(async () => {
      const res = await facilityApi.captionPhoto(captionEdit.id, captionEdit.caption)
      replace(res.data.facility)
      setCaptionEdit(null)
    })
  }

  const removePhoto = (photo) => run(async () => {
    const res = await facilityApi.removePhoto(photo.id)
    replace(res.data.facility)
    toast.success('Photo removed.')
  })

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Facility Gallery</h1>
          <p className="page-subtitle">Photos shown on the school website under "Our facilities"</p>
        </div>
        <button onClick={() => setNameModal({ name: '' })} className="btn-primary">
          <PlusIcon size={16} /> Add Facility
        </button>
      </div>

      {facilities.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Building2}
            title="No facilities yet"
            description="Until one is added, the website keeps showing the photos it was built with."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Facility list */}
          <div className="card p-2 h-fit">
            {facilities.map((f, i) => (
              <div key={f.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${f.id === selectedId ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                <button onClick={() => setSelectedId(f.id)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                  {f.photos[0] ? (
                    <img src={f.photos[0].thumb_url} alt="" className="w-10 h-8 rounded object-cover flex-shrink-0 bg-slate-100" />
                  ) : (
                    <div className="w-10 h-8 rounded bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Building2 size={14} className="text-slate-400" />
                    </div>
                  )}
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium truncate ${f.is_active ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{f.name}</span>
                    <span className="block text-xs text-slate-400">
                      {f.photos.length} photo{f.photos.length === 1 ? '' : 's'}{!f.is_active ? ' · hidden' : ''}
                    </span>
                  </span>
                </button>
                <div className="flex flex-col flex-shrink-0">
                  <button disabled={busy || i === 0} onClick={() => moveFacility(i, -1)} title="Move up"
                    className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronUp size={14} /></button>
                  <button disabled={busy || i === facilities.length - 1} onClick={() => moveFacility(i, 1)} title="Move down"
                    className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronDown size={14} /></button>
                </div>
              </div>
            ))}
          </div>

          {/* Selected facility */}
          {selected && (
            <div className="card p-4 sm:p-5 space-y-4 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900 break-words">{selected.name}</h2>
                  <p className="text-xs text-slate-500">
                    {selected.is_active ? 'Shown on the website' : 'Hidden from the website'}
                    {selected.is_active && selected.photos.length === 0 ? ' once it has a photo' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <button onClick={() => setNameModal({ id: selected.id, name: selected.name, is_active: selected.is_active })}
                    className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50" title="Rename">
                    <Pencil size={16} />
                  </button>
                  <button disabled={busy} onClick={() => toggleHidden(selected)}
                    className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50"
                    title={selected.is_active ? 'Hide from website' : 'Show on website'}>
                    {selected.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button onClick={() => setDeleting(selected)}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50" title="Delete facility">
                    <Trash2 size={16} />
                  </button>
                  <button onClick={() => fileRef.current?.click()} className="btn-primary ml-1">
                    <ImagePlus size={16} /> Add Photos
                  </button>
                  <input ref={fileRef} type="file" multiple accept={TYPES.join(',')} className="hidden" onChange={pickFiles} />
                </div>
              </div>

              {selected.photos.length === 0 ? (
                <EmptyState icon={ImagePlus} title="No photos yet" description="The first photo becomes the cover on the website." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {selected.photos.map((p, i) => (
                    <div key={p.id} className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <div className="relative">
                        <img src={p.thumb_url} alt={p.caption || ''} className="w-full aspect-[4/3] object-cover bg-slate-100" />
                        {i === 0 && (
                          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-400 text-slate-900">
                            <Star size={12} /> Cover
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 space-y-2">
                        {captionEdit?.id === p.id ? (
                          <form onSubmit={saveCaption} className="flex gap-1.5">
                            <input className="input !py-1.5 text-sm" maxLength={200} autoFocus value={captionEdit.caption}
                              onChange={e => setCaptionEdit(c => ({ ...c, caption: e.target.value }))} placeholder="Caption" />
                            <button type="submit" disabled={busy} className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50" title="Save caption"><Check size={16} /></button>
                            <button type="button" onClick={() => setCaptionEdit(null)} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100" title="Cancel"><XIcon size={16} /></button>
                          </form>
                        ) : (
                          <button onClick={() => setCaptionEdit({ id: p.id, caption: p.caption || '' })}
                            className="w-full text-left text-sm text-slate-700 hover:text-brand-700 truncate" title="Edit caption">
                            {p.caption || <span className="text-slate-400 italic">Add a caption</span>}
                          </button>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <button disabled={busy || i === 0} onClick={() => movePhoto(i, i - 1)} title="Move earlier"
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                            <button disabled={busy || i === selected.photos.length - 1} onClick={() => movePhoto(i, i + 1)} title="Move later"
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16} /></button>
                            {i !== 0 && (
                              <button disabled={busy} onClick={() => movePhoto(i, 0)} title="Make cover"
                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Star size={16} /></button>
                            )}
                          </div>
                          <button disabled={busy} onClick={() => removePhoto(p)} title="Remove photo"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Modal open={!!nameModal} onClose={() => setNameModal(null)} title={nameModal?.id ? 'Rename Facility' : 'Add Facility'} size="sm">
        {nameModal && (
          <form onSubmit={saveName} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Name *</label>
              <input className="input" maxLength={100} autoFocus required placeholder="e.g. Library"
                value={nameModal.name} onChange={e => setNameModal(m => ({ ...m, name: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setNameModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center">{busy ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!upload} onClose={() => setUpload(null)} title={`Add photos to ${selected?.name || ''}`}>
        {upload && (
          <form onSubmit={submitUpload} className="space-y-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {upload.files.map((f, i) => (
                <FilePreview key={i} file={f} />
              ))}
            </div>
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={upload.consent}
                onChange={e => setUpload(u => ({ ...u, consent: e.target.checked }))} />
              <span>
                These photos show no identifiable learners, or the school has their parents' consent on file.
                <span className="block text-xs text-slate-500">Required under the Data Privacy Act. Photos are straightened and their location data removed automatically.</span>
              </span>
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => setUpload(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={busy || !upload.consent} className="btn-primary flex-1 justify-center">
                {busy ? 'Uploading...' : `Upload ${upload.files.length} photo${upload.files.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete facility?" size="sm">
        <p className="text-sm text-slate-600">
          This removes "{deleting?.name}" and its {deleting?.photos.length} photo{deleting?.photos.length === 1 ? '' : 's'} from
          the website for good. To take it down for now, hide it instead.
        </p>
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => setDeleting(null)} className="btn-secondary flex-1">Cancel</button>
          <button type="button" onClick={confirmDelete} disabled={busy}
            className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700">
            {busy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function FilePreview({ file }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url ? <img src={url} alt="" className="w-full aspect-square object-cover rounded-lg bg-slate-100" /> : null
}

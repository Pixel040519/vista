// ============================================================
// KEY DATES PAGE (super admin)
// ============================================================
// The admissions calendar the public website shows — "Regular enrollment opens",
// "First day of classes". Each date belongs to a school year, so next year's
// calendar is entered here rather than coded into the site.
//
// "Show on the school website" does two jobs, which is why the banner spells the
// second one out: it puts the row on the site, AND the year owning the soonest
// upcoming published date is the year the site NAMES, in its hero, its CTAs and
// this section's heading. Nothing is derived from active/upcoming — while
// SY 2025-2026 runs, the site advertises enrolment into SY 2026-2027.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarDays, Plus as PlusIcon, Pencil, Trash2, Globe, Info } from 'lucide-react'
import clsx from 'clsx'
import { keyDateApi, curriculumApi } from '../api/client'
import { LoadingSpinner, EmptyState, Modal } from '../components/UI'
import SchoolYearPicker from '../components/SchoolYearPicker'

const KINDS = ['Admissions', 'Event', 'Academic', 'Holiday']

const KIND_TONES = {
  Admissions: 'bg-brand-50 text-brand-700',
  Event:      'bg-violet-50 text-violet-700',
  Academic:   'bg-emerald-50 text-emerald-700',
  Holiday:    'bg-amber-50 text-amber-700',
}

/** Today as YYYY-MM-DD in local time — the API compares against CURRENT_DATE. */
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The rows arrive as plain YYYY-MM-DD strings (the API casts them in SQL), so
 * they are built as local dates here. `new Date('2026-06-08')` parses as UTC
 * midnight and prints as the 7th anywhere west of Greenwich.
 */
const fmt = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** A date is gone from the website once the last day of it has passed. */
const hasPassed = (row) => (row.ends_on || row.starts_on) < today()

/**
 * Mirrors the public read's rule, so nothing here can disagree with the site:
 * among published rows that have not passed, the earliest by start date wins,
 * and its school year is the one the website names.
 */
const advertisedYearId = (rows) => {
  const live = rows.filter(r => r.is_public && !hasPassed(r))
  if (!live.length) return null
  return live.reduce((a, b) => (a.starts_on <= b.starts_on ? a : b)).school_year_id
}

const blank = (school_year_id) => ({
  school_year_id, label: '', starts_on: '', ends_on: '', kind: 'Admissions', is_public: false,
})

export default function KeyDates() {
  const [rows, setRows] = useState([])
  const [schoolYears, setSchoolYears] = useState([])
  const [selectedSYId, setSelectedSYId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null)     // the add/edit modal's draft
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    Promise.all([keyDateApi.list(), curriculumApi.getSchoolYears()])
      .then(([kd, sy]) => {
        const list = kd.data.key_dates || []
        const years = sy.data.school_years || []
        setRows(list)
        setSchoolYears(years)
        // Open on the year the WEBSITE is advertising — that is the calendar
        // being worked on, and the banner talks about it, so landing anywhere
        // else reads as a contradiction. `school_years` comes back ordered by
        // label DESC, so the upcoming fallback is sorted back to nearest-first
        // rather than taking the first row (which is the furthest-away year).
        setSelectedSYId(prev => prev
          || advertisedYearId(list)
          || years.filter(y => y.is_upcoming).sort((a, b) => a.label.localeCompare(b.label))[0]?.id
          || years.find(y => y.is_active)?.id
          || years[0]?.id
          || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const selectedSY = schoolYears.find(y => y.id === selectedSYId) || null
  const visible = useMemo(
    () => rows.filter(r => r.school_year_id === selectedSYId),
    [rows, selectedSYId]
  )

  const advertised = useMemo(() => {
    const id = advertisedYearId(rows)
    return id ? schoolYears.find(y => y.id === id) || null : null
  }, [rows, schoolYears])

  const run = async (fn) => {
    setBusy(true)
    try {
      const res = await fn()
      if (res?.data?.key_dates) setRows(res.data.key_dates)
      if (res?.data?.message) toast.success(res.data.message)
      return res
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong.')
      throw err
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const body = {
      label: form.label.trim(),
      starts_on: form.starts_on,
      ends_on: form.ends_on || null,
      kind: form.kind,
      is_public: form.is_public,
    }
    try {
      if (form.id) await run(() => keyDateApi.update(form.id, body))
      else await run(() => keyDateApi.create({ ...body, school_year_id: form.school_year_id }))
      setForm(null)
    } catch { /* the toast already said so; keep the draft on screen */ }
  }

  if (loading) return <LoadingSpinner />

  const canSave = form && form.label.trim() && form.starts_on
    && (!form.ends_on || form.ends_on >= form.starts_on)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Key Dates</h1>
          <p className="page-subtitle">The admissions calendar shown on the school website</p>
        </div>
        <div className="flex items-center gap-3">
          <SchoolYearPicker
            schoolYears={schoolYears}
            selectedSY={selectedSY}
            onSelect={(sy) => setSelectedSYId(sy.id)}
            canManage={false}
          />
          <button
            onClick={() => setForm(blank(selectedSYId))}
            disabled={!selectedSYId}
            className="btn-primary disabled:opacity-50"
          >
            <PlusIcon size={16} /> Add Date
          </button>
        </div>
      </div>

      {/* The advertised-year rule, stated rather than left to be inferred. */}
      <div className={clsx(
        'card flex items-start gap-3 p-4',
        advertised ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-slate-50'
      )}>
        <Info size={18} className={clsx('mt-0.5 shrink-0', advertised ? 'text-brand-500' : 'text-slate-400')} />
        <div className="text-sm">
          {advertised ? (
            <>
              <p className="font-semibold text-slate-800">
                The website is advertising SY {advertised.label}.
              </p>
              <p className="mt-0.5 text-slate-600">
                It names that school year in its hero, both &ldquo;Ready to enroll&rdquo; banners and
                the key-dates heading, because that year owns the soonest date still to come.
              </p>
              {advertised.id !== selectedSYId && (
                <button
                  onClick={() => setSelectedSYId(advertised.id)}
                  className="mt-1.5 font-semibold text-brand-600 underline-offset-4 hover:underline"
                >
                  Show SY {advertised.label} &rarr;
                </button>
              )}
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-800">
                Nothing is published, so the website names no school year.
              </p>
              <p className="mt-0.5 text-slate-600">
                It shows the registrar&apos;s office details in place of the calendar and reads
                &ldquo;Ready to enroll?&rdquo; without a year. Tick &ldquo;Show on the school
                website&rdquo; on a date still to come to turn it on.
              </p>
            </>
          )}
        </div>
      </div>

      {!visible.length ? (
        <EmptyState
          icon={CalendarDays}
          title={`No key dates for SY ${selectedSY?.label || '—'}`}
          description="Add the enrollment schedule for this school year. Nothing reaches the website until a date is published, and a date drops off the site on its own once it has passed."
          action={selectedSYId && (
            <button onClick={() => setForm(blank(selectedSYId))} className="btn-primary">
              <PlusIcon size={16} /> Add Date
            </button>
          )}
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th className="whitespace-nowrap">Date</th>
                <th className="whitespace-nowrap">What happens</th>
                <th className="whitespace-nowrap">Kind</th>
                <th className="whitespace-nowrap">Website</th>
                <th className="whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const past = hasPassed(row)
                return (
                  <tr key={row.id} className={clsx(past && 'bg-slate-50/70')}>
                    <td className="whitespace-nowrap font-medium text-slate-800">
                      {fmt(row.starts_on)}
                      {row.ends_on && (
                        <span className="text-slate-500"> &ndash; {fmt(row.ends_on)}</span>
                      )}
                    </td>
                    <td className={clsx(past ? 'text-slate-500' : 'text-slate-800')}>{row.label}</td>
                    <td>
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', KIND_TONES[row.kind])}>
                        {row.kind}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.is_public && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                            <Globe size={11} /> On website
                          </span>
                        )}
                        {past && (
                          <span
                            title="This date has passed, so the website no longer shows it."
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                          >
                            Past
                          </span>
                        )}
                        {!row.is_public && !past && (
                          <span className="text-xs text-slate-400">Not shown</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        onClick={() => setForm({ ...row, ends_on: row.ends_on || '' })}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600"
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleting(row)}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Remove"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit key date' : `Add a key date to SY ${selectedSY?.label || ''}`}
      >
        {form && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">What happens</label>
              <input
                className="input"
                value={form.label}
                autoFocus
                placeholder="Regular enrollment opens"
                onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
                <input
                  type="date"
                  className="input"
                  value={form.starts_on}
                  onChange={(e) => setForm(f => ({ ...f, starts_on: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Ends <span className="font-normal text-slate-400">— optional</span>
                </label>
                <input
                  type="date"
                  className="input"
                  value={form.ends_on}
                  min={form.starts_on || undefined}
                  onChange={(e) => setForm(f => ({ ...f, ends_on: e.target.value }))}
                />
                <p className="mt-1 text-xs text-slate-500">
                  For a period, like enrollment running over several weeks.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Kind</label>
              <select
                className="input"
                value={form.kind}
                onChange={(e) => setForm(f => ({ ...f, kind: e.target.value }))}
              >
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.is_public}
                onChange={(e) => setForm(f => ({ ...f, is_public: e.target.checked }))}
              />
              <span className="text-sm">
                <span className="font-medium text-slate-800">Show on the school website</span>
                <span className="mt-0.5 block text-slate-500">
                  Published dates also decide which school year the website names. A date that
                  has passed stops appearing on its own.
                </span>
              </span>
            </label>

            {form.starts_on && form.starts_on < today() && form.is_public && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                This date has already passed, so it will not appear on the website.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={!canSave || busy} className="btn-primary disabled:opacity-50">
                {form.id ? 'Save changes' : 'Add date'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove this key date?" size="sm">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{deleting.label}</span> on{' '}
              {fmt(deleting.starts_on)} will be removed
              {deleting.is_public ? ' and will disappear from the school website.' : '.'}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={async () => {
                  await run(() => keyDateApi.remove(deleting.id)).catch(() => {})
                  setDeleting(null)
                }}
                disabled={busy}
                className="btn-primary !bg-red-600 hover:!bg-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

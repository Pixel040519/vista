// ============================================================
// ANNOUNCEMENT CHANGES
// ============================================================
// What another admin changed in a post, for its author and that editor only —
// the API serves nobody else. Each save by someone other than the author is
// one entry, newest first. The message is shown whole with the words removed
// struck through and the words added highlighted, because a changed date or
// number buried in a paragraph is exactly what the author needs to spot; every
// other field is a plain before → after row.
import { useEffect, useState } from 'react'
import { format as fmt } from 'date-fns'
import clsx from 'clsx'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { announcementApi } from '../api/client'
import { LoadingSpinner } from './UI'
import { AUDIENCE_LABEL, STATES } from './AnnouncementForm'

// Word-level diff: common prefix and suffix are trimmed first, so the LCS only
// runs over the part that changed. Whitespace is kept as its own tokens so the
// text re-joins exactly. A change too large to diff word by word falls back to
// "all of this was removed, all of this was added".
const MAX_CELLS = 250_000
function diffWords(before = '', after = '') {
  const A = before.split(/(\s+)/)
  const B = after.split(/(\s+)/)
  let s = 0
  while (s < A.length && s < B.length && A[s] === B[s]) s++
  let e = 0
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++
  const a = A.slice(s, A.length - e)
  const b = B.slice(s, B.length - e)

  const parts = []
  const push = (type, text) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }

  push('same', A.slice(0, s).join(''))
  if (a.length * b.length > MAX_CELLS) {
    push('del', a.join(''))
    push('ins', b.join(''))
  } else {
    const n = a.length, m = b.length, w = m + 1
    const dp = new Uint32Array((n + 1) * w) // dp[i][j] = LCS of a[i..] and b[j..]
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
      }
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) { push('same', a[i]); i++; j++ }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push('del', a[i]); i++ }
      else { push('ins', b[j]); j++ }
    }
    while (i < n) push('del', a[i++])
    while (j < m) push('ins', b[j++])
  }
  push('same', A.slice(A.length - e).join(''))
  return parts
}

function Diff({ before, after, className }) {
  return (
    <p className={clsx('whitespace-pre-wrap break-words select-text leading-relaxed', className)}>
      {diffWords(before, after).map((p, k) => (
        p.type === 'same' ? <span key={k}>{p.text}</span>
          : p.type === 'del'
            ? <del key={k} className="bg-red-50 text-red-700 decoration-red-400 rounded-sm">{p.text}</del>
            : <ins key={k} className="bg-emerald-50 text-emerald-800 no-underline rounded-sm">{p.text}</ins>
      ))}
    </p>
  )
}

const dateText = (iso) => (iso ? fmt(new Date(iso), 'MMM d, yyyy · h:mm a') : 'None')
const statusText = (s) => (s.state === 'scheduled'
  ? `Scheduled for ${dateText(s.published_at)}`
  : (STATES[s.state] || STATES.published).label)
const vistaText = (s) => (s.in_vista === false ? 'Not shown' : AUDIENCE_LABEL[s.target_audience] || s.target_audience)

// Every field an edit can touch other than title and message, as text.
// Title and message get the word diff instead.
function fieldRows(edit) {
  const { before: b, after: a } = edit
  const rows = [
    ['Category', b.category, a.category],
    ['In VISTA', vistaText(b), vistaText(a)],
    ['Public website', b.is_public ? 'Yes' : 'No', a.is_public ? 'Yes' : 'No'],
    ['Pinned', b.is_pinned ? 'Yes' : 'No', a.is_pinned ? 'Yes' : 'No'],
    ['Status', statusText(b), statusText(a)],
    ['Takes down', dateText(b.expires_at), dateText(a.expires_at)],
  ].filter(([, x, y]) => x !== y)
  if (edit.photo_replaced) rows.push(['Photo', 'Previous photo', 'Replaced'])
  else if (b.has_photo !== a.has_photo) rows.push(['Photo', b.has_photo ? 'Photo' : 'None', a.has_photo ? 'Added' : 'Removed'])
  return rows
}

function EditEntry({ edit, isEditor }) {
  const { before: b, after: a } = edit
  const titleChanged = b.title !== a.title
  const messageChanged = b.content !== a.content
  const rows = fieldRows(edit)

  return (
    <article className="rounded-xl border border-slate-200 overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-900">
          {isEditor ? 'You' : edit.edited_by_name || 'Another admin'} edited this
        </span>
        <span className="text-xs text-slate-500">{dateText(edit.edited_at)}</span>
      </header>
      <div className="px-4 py-3.5 space-y-4">
        {titleChanged && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Title</p>
            <Diff before={b.title} after={a.title} className="text-[15px] font-semibold text-slate-900" />
          </div>
        )}
        {messageChanged && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Message</p>
            <Diff before={b.content} after={a.content} className="text-sm text-slate-700" />
          </div>
        )}
        {rows.length > 0 && (
          <dl className="divide-y divide-slate-100 text-sm">
            {rows.map(([label, from, to]) => (
              <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] sm:grid-cols-[130px_minmax(0,1fr)] gap-3 py-2 first:pt-0 last:pb-0">
                <dt className="font-medium text-slate-600">{label}</dt>
                <dd className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-slate-500 line-through decoration-slate-300">{from}</span>
                  <ArrowRight size={13} className="text-slate-400" aria-label="changed to" />
                  <span className="font-semibold text-slate-900">{to}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  )
}

/** The changes view; shown in place of the post inside PostView's modal. */
export default function AnnouncementChanges({ post, userId, onBack }) {
  const [edits, setEdits] = useState(null)

  useEffect(() => {
    let live = true
    announcementApi.edits(post.id)
      .then(res => { if (live) setEdits(res.data.edits || []) })
      .catch(() => { if (live) setEdits([]) })
    return () => { live = false }
  }, [post.id])

  return (
    <div className="space-y-4">
      {/* Straight into the edits: the post they belong to is one Back away. */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to the announcement"
          className="w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100">
          <ArrowLeft size={16} />
        </button>
        <span className="flex-1" />
        <span className="flex items-center gap-2 text-xs">
          <del className="px-1 bg-red-50 text-red-700 decoration-red-400 rounded-sm">removed</del>
          <ins className="px-1 bg-emerald-50 text-emerald-800 no-underline rounded-sm">added</ins>
        </span>
      </div>

      {edits === null ? <LoadingSpinner size="sm" />
        : edits.length === 0 ? <p className="text-sm text-slate-500">There are no changes for you to see on this post.</p>
        : edits.map(e => <EditEntry key={e.id} edit={e} isEditor={e.edited_by === userId} />)}
    </div>
  )
}

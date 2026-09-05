import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, UserX, AlertTriangle, ClipboardCheck, CheckCircle2,
  ChevronRight, BookOpen, Clock, ArrowRight, GraduationCap,
} from 'lucide-react'
import clsx from 'clsx'
import { aiApi } from '../../api/client'
import { StatCard, LoadingSpinner } from '../../components/UI'
import { useAuth } from '../../context/AuthContext'
import EceCompetencyCard from './EceCompetencyCard'

const ECE_GRADES = ['Kinder']

const SENTIMENT_DOT = {
  Positive: 'bg-emerald-500',
  Neutral:  'bg-slate-400',
  Negative: 'bg-red-500',
}

const TOP_CONCERN_LABEL = {
  academic:   'Academic',
  attendance: 'Attendance',
  behavior:   'Behavior',
}

const BAND_PILL = {
  urgent:       'bg-red-50 text-red-700',
  watch:        'bg-amber-50 text-amber-700',
  ok:           'bg-emerald-50 text-emerald-700',
  insufficient: 'bg-slate-50 text-slate-500',
}

const BAND_LABEL = {
  urgent:       'Urgent',
  watch:        'Watch',
  ok:           'On track',
  insufficient: 'No data',
}

export default function TeacherDashboard() {
  const { user, activeAssignments, advisory } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [classHealth, setClassHealth] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.allSettled([
        aiApi.teacherDashboard(),
        aiApi.classHealthAll(),
      ]).then(([dashRes, chRes]) => {
        if (cancelled) return
        if (dashRes.status === 'fulfilled') setData(dashRes.value.data)
        if (chRes.status   === 'fulfilled') setClassHealth(chRes.value.data)
      }).finally(() => { if (!cancelled) setLoading(false) })
    }
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const greeting = new Date().getHours() < 12 ? 'morning'
                  : new Date().getHours() < 18 ? 'afternoon' : 'evening'
  const firstName = user?.full_name?.split(' ')[0] || 'Teacher'

  const isECE = useMemo(
    () => activeAssignments.some(a => ECE_GRADES.includes(a.grade_level)),
    [activeAssignments]
  )

  const goToAttendance = (gradeLevel, section, subjectId) => {
    // Pass the deep-link via React Router location state + a fresh key so
    // the Attendance page re-applies it even when navigating to the same
    // route repeatedly (the component may stay mounted across navigations).
    navigate('/attendance', {
      state: {
        deepLink: {
          selectedSection: `${gradeLevel}|||${section}`,
          selectedSubject: subjectId || '',
          ts: Date.now(),
        },
      },
    })
  }

  const goToScoreEntry = (gradeLevel, section, subjectId, latestQuarter) => {
    // ScoreEntry.jsx persists filters in a single JSON blob under this key.
    const STORAGE_KEY = 'vista_score_entry_filters'
    let cur = {}
    try { cur = JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {} } catch { cur = {} }
    cur.selectedClass = `${gradeLevel}|||${section}`
    if (subjectId) cur.subjectId = subjectId
    cur.quarter = String(latestQuarter || 1)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cur))
    navigate('/score-entry')
  }

  const att = data?.todays_attendance_rollup || {}
  const my  = data?.my_students || { total: 0, sections: 0, subjects: 0 }
  const chSummary = classHealth?.summary || { total: 0, ok: 0, watch: 0, urgent: 0, insufficient: 0 }
  const atRiskCount = (chSummary.urgent || 0) + (chSummary.watch || 0)
  const attRate = att.total_logged
    ? Math.round(((att.present + att.late) / att.total_logged) * 100)
    : 0

  // My Classes grid — group class-health students by (grade, section) and
  // merge with the scope.sections subject list.
  const mySectionsHealth = useMemo(() => {
    if (!classHealth) return []
    const groups = new Map()
    for (const s of classHealth.students || []) {
      const key = `${s.grade_level}|||${s.section}`
      if (!groups.has(key)) {
        groups.set(key, {
          grade_level: s.grade_level,
          section:     s.section,
          enrollment:  0,
          ok: 0, watch: 0, urgent: 0, insufficient: 0,
          subjects:    [],
        })
      }
      const g = groups.get(key)
      g.enrollment += 1
      g[s.overall_band] += 1
    }
    for (const scopeSec of classHealth.scope?.sections || []) {
      const key = `${scopeSec.grade_level}|||${scopeSec.section}`
      if (!groups.has(key)) {
        groups.set(key, {
          grade_level: scopeSec.grade_level,
          section:     scopeSec.section,
          enrollment:  0,
          ok: 0, watch: 0, urgent: 0, insufficient: 0,
          subjects:    scopeSec.subjects || [],
        })
      } else {
        groups.get(key).subjects = scopeSec.subjects || []
      }
    }
    return Array.from(groups.values())
  }, [classHealth])

  // Students to Watch — urgent first, then watch; cap at 5 for the sidebar card.
  const studentsToWatch = useMemo(() => {
    if (!classHealth) return []
    return (classHealth.students || [])
      .filter(s => s.overall_band === 'urgent' || s.overall_band === 'watch')
      .slice(0, 5)
  }, [classHealth])

  const todayStatus = data?.today_attendance_status || []
  const pendingCount = todayStatus.filter(t => t.pending).length
  const sortedStatus = [...todayStatus].sort((a, b) => Number(b.pending) - Number(a.pending))

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Greeting */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">
            Good {greeting}, <span className="text-brand-600">{firstName}</span> 👋
          </h1>
          <p className="page-subtitle">
            You teach <span className="font-semibold text-slate-700">{activeAssignments.length}</span>{' '}
            class{activeAssignments.length !== 1 ? 'es' : ''}
            {data?.school_year && <> this {data.school_year}</>}.
            {pendingCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">
                · {pendingCount} attendance pending
              </span>
            )}
          </p>
        </div>
        {/* Advisory class — the section this teacher is responsible for as a
            whole, which is a different fact from the subjects they teach and
            may name a class they teach nothing in. */}
        {advisory?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {advisory.map(v => (
              <span key={v.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-50 border border-brand-200 text-xs"
                title="You are the class adviser.">
                <GraduationCap size={13} className="text-brand-600"/>
                <span className="text-slate-500">Adviser of</span>
                <span className="font-semibold text-brand-700">{v.grade_level} · {v.section}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
            <StatCard
              title="My Students"
              value={my.total.toLocaleString()}
              subtitle={`Across ${my.sections} section${my.sections !== 1 ? 's' : ''}`}
              icon={Users}
              color="brand"
              onClick={() => navigate('/students')}
            />
            <StatCard
              title="Present Today"
              value={(att.present || 0) + (att.late || 0)}
              subtitle={`${attRate}% attendance rate`}
              icon={UserCheck}
              color="emerald"
            />
            <StatCard
              title="Absent Today"
              value={att.absent || 0}
              subtitle="In my classes"
              icon={UserX}
              color="amber"
            />
            <StatCard
              title="Needs Attention"
              value={atRiskCount}
              subtitle={`${chSummary.urgent || 0} urgent · ${chSummary.watch || 0} watch`}
              icon={AlertTriangle}
              color="red"
              onClick={() => navigate('/risk')}
            />
          </div>

          {/* Today's Action Items */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Today's Action Items</h3>
                <p className="text-xs text-slate-400">Mark attendance for each class you teach</p>
              </div>
              <ClipboardCheck size={16} className="text-slate-300" />
            </div>

            {sortedStatus.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BookOpen size={32} className="text-slate-200 mb-2" />
                <p className="text-sm font-medium text-slate-600">No active teaching assignments</p>
                <p className="text-xs text-slate-400 mt-0.5">Contact your administrator to be assigned to a class.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {sortedStatus.map((t, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      {t.pending ? (
                        <Clock size={16} className="text-amber-500 shrink-0" />
                      ) : (
                        <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {t.grade_level} — {t.section}
                          <span className="text-slate-400 font-normal"> · {t.subject}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          {t.logged}/{t.expected} student{t.expected !== 1 ? 's' : ''} marked
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => goToAttendance(t.grade_level, t.section, t.subject_id)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shrink-0 ${
                        t.pending
                          ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {t.pending ? 'Take attendance' : 'Review'} <ArrowRight size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* My Classes Risk grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">My Classes</h3>
                  <p className="text-xs text-slate-400">Class-health bands per section</p>
                </div>
              </div>
              {mySectionsHealth.length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-400">No sections assigned.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {mySectionsHealth.map((sec, i) => {
                    const total = sec.enrollment || 1
                    return (
                      <div key={i} className="border border-slate-200 rounded-xl p-3 hover:border-brand-300 transition-colors">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">
                              {sec.grade_level} — {sec.section}
                            </p>
                            <p className="text-xs text-slate-400">
                              {sec.enrollment} student{sec.enrollment !== 1 ? 's' : ''} · {sec.subjects.length} subject{sec.subjects.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-2">
                          {sec.urgent       > 0 && <div className="bg-red-500"     style={{ width: `${(sec.urgent      /total)*100}%` }} />}
                          {sec.watch        > 0 && <div className="bg-amber-500"   style={{ width: `${(sec.watch       /total)*100}%` }} />}
                          {sec.ok           > 0 && <div className="bg-emerald-500" style={{ width: `${(sec.ok          /total)*100}%` }} />}
                          {sec.insufficient > 0 && <div className="bg-slate-300"   style={{ width: `${(sec.insufficient/total)*100}%` }} />}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500     mr-1" />{sec.urgent} urgent</span>
                          <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500   mr-1" />{sec.watch} watch</span>
                          <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />{sec.ok} ok</span>
                          {sec.insufficient > 0 && (
                            <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 mr-1" />{sec.insufficient} no data</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Students to Watch */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Students to Watch</h3>
                  <p className="text-xs text-slate-400">From your classes</p>
                </div>
                <Link to="/risk" className="text-xs text-brand-600 font-medium hover:text-brand-700 flex items-center gap-1">
                  All <ChevronRight size={13} />
                </Link>
              </div>
              {studentsToWatch.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  All your students are on track.
                </div>
              ) : (
                <ul className="space-y-2">
                  {studentsToWatch.map(s => (
                    <li key={s.student_id} className="flex items-center justify-between gap-2">
                      <Link to={`/students/${s.student_id}`} className="min-w-0 hover:text-brand-700">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.full_name}</p>
                        <p className="text-[11px] text-slate-400">
                          {s.grade_level} · {s.section}
                          {s.top_concern && <> · {TOP_CONCERN_LABEL[s.top_concern]}</>}
                        </p>
                      </Link>
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0',
                        BAND_PILL[s.overall_band]
                      )}>
                        {BAND_LABEL[s.overall_band]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Score Entry Progress */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Score Entry Progress</h3>
                <p className="text-xs text-slate-400">Components with score items per subject</p>
              </div>
              <Link to="/score-entry" className="text-xs text-brand-600 font-medium hover:text-brand-700 flex items-center gap-1">
                Open <ChevronRight size={13} />
              </Link>
            </div>
            {(data?.score_entry_progress || []).length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">No subjects assigned yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Section</th>
                      <th>Components filled</th>
                      <th>Score items</th>
                      <th>Latest quarter</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.score_entry_progress.map(sp => {
                      const ratio = sp.components_total > 0
                        ? sp.components_with_items / sp.components_total
                        : 0
                      const incomplete = sp.components_total > 0 && sp.components_with_items < sp.components_total
                      return (
                        <tr key={`${sp.subject_id}-${sp.section}`}>
                          <td>
                            <div className="font-medium text-slate-800">{sp.subject}</div>
                            <div className="text-[11px] text-slate-400">{sp.grade_level}</div>
                          </td>
                          <td className="text-slate-600">{sp.section}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-24">
                                <div
                                  className={`h-full rounded-full ${incomplete ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${ratio * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-600 font-mono">
                                {sp.components_with_items}/{sp.components_total}
                              </span>
                            </div>
                          </td>
                          <td className="text-slate-500">{sp.total_items}</td>
                          <td className="text-slate-500">{sp.latest_quarter ? `Q${sp.latest_quarter}` : '—'}</td>
                          <td>
                            <button
                              onClick={() => goToScoreEntry(sp.grade_level, sp.section, sp.subject_id, sp.latest_quarter)}
                              className="text-xs text-brand-600 font-medium hover:text-brand-700 flex items-center gap-1"
                            >
                              Resume <ArrowRight size={12} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Behavior + ECE row */}
          <div className={`grid grid-cols-1 ${isECE ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-5`}>
            {/* Recent Behavior Logs */}
            <div className={`card p-5 ${isECE ? '' : 'lg:col-span-1'}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Recent Behavior Logs</h3>
                  <p className="text-xs text-slate-400">Your last 5 entries</p>
                </div>
                <Link to="/behavior" className="text-xs text-brand-600 font-medium hover:text-brand-700 flex items-center gap-1">
                  Add <ChevronRight size={13} />
                </Link>
              </div>
              {(data?.behavior_recent || []).length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No behavior logs yet. <Link to="/behavior" className="text-brand-600">Add the first one</Link>.
                </div>
              ) : (
                <ul className="space-y-3">
                  {data.behavior_recent.map(b => (
                    <li key={b.id} className="flex items-start gap-2">
                      <span className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${SENTIMENT_DOT[b.sentiment] || 'bg-slate-300'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{b.student_name}</p>
                        <p className="text-xs text-slate-500 line-clamp-2">{b.excerpt}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sentiment Mini */}
            <div className="card p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Behavior Sentiment</h3>
                <p className="text-xs text-slate-400">Your logs · last 7 days</p>
              </div>
              {(() => {
                const s = data?.behavior_sentiment_7d || {}
                const total = (s.positive || 0) + (s.neutral || 0) + (s.negative || 0)
                const items = [
                  { label: 'Positive', val: s.positive || 0, color: 'bg-emerald-500' },
                  { label: 'Neutral',  val: s.neutral  || 0, color: 'bg-slate-400'   },
                  { label: 'Negative', val: s.negative || 0, color: 'bg-red-500'     },
                ]
                if (total === 0) {
                  return <div className="text-center py-6 text-xs text-slate-400">No logs in the last 7 days.</div>
                }
                return (
                  <div className="space-y-2.5">
                    {items.map(it => (
                      <div key={it.label}>
                        <div className="flex justify-between text-xs text-slate-600 mb-1">
                          <span>{it.label}</span>
                          <span className="font-semibold text-slate-800">{it.val}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${it.color}`} style={{ width: `${(it.val/total)*100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* ECE Competency — only for ECE-assigned teachers */}
            {isECE && <EceCompetencyCard />}
          </div>
        </>
      )}
    </div>
  )
}

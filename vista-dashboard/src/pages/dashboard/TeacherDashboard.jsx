import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, UserX, AlertTriangle, ClipboardCheck, CheckCircle2,
  ChevronRight, MessageSquare, BookOpen, Sparkles, Clock, ArrowRight,
} from 'lucide-react'
import { aiApi } from '../../api/client'
import { StatCard, RiskBadge, LoadingSpinner } from '../../components/UI'
import { useAuth } from '../../context/AuthContext'

const ECE_GRADES = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']

const SENTIMENT_DOT = {
  Positive: 'bg-emerald-500',
  Neutral:  'bg-slate-400',
  Negative: 'bg-red-500',
}

const FACTOR_LABEL = {
  attendance: 'Attendance',
  academic:   'Academic',
  behavioral: 'Behavior',
}

export default function TeacherDashboard() {
  const { user, activeAssignments } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      aiApi.teacherDashboard()
        .then(res => { if (!cancelled) setData(res.data) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false) })
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
  const risk = data?.risk_in_my_sections || { stable: 0, moderate_risk: 0, high_risk: 0 }
  const atRiskCount = (risk.moderate_risk || 0) + (risk.high_risk || 0)
  const attRate = att.total_logged
    ? Math.round(((att.present + att.late) / att.total_logged) * 100)
    : 0

  const todayStatus = data?.today_attendance_status || []
  const pendingCount = todayStatus.filter(t => t.pending).length
  const sortedStatus = [...todayStatus].sort((a, b) => Number(b.pending) - Number(a.pending))

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Greeting */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">
            Good {greeting}, <span className="text-teal-600">{firstName}</span> 👋
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
              color="teal"
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
              title="At-Risk Students"
              value={atRiskCount}
              subtitle={`${risk.high_risk || 0} high · ${risk.moderate_risk || 0} moderate`}
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
                          ? 'bg-teal-50 text-teal-700 hover:bg-teal-100'
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
                  <p className="text-xs text-slate-400">Risk distribution per section</p>
                </div>
              </div>
              {(data?.my_sections || []).length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-400">No sections assigned.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.my_sections.map((sec, i) => {
                    const total = sec.enrollment || 1
                    const stable = sec.risk.stable || 0
                    const moderate = sec.risk.moderate_risk || 0
                    const high = sec.risk.high_risk || 0
                    const unassessed = sec.risk.unassessed || 0
                    return (
                      <div key={i} className="border border-slate-200 rounded-xl p-3 hover:border-teal-300 transition-colors">
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
                          {stable > 0    && <div className="bg-emerald-500" style={{ width: `${(stable/total)*100}%` }} />}
                          {moderate > 0  && <div className="bg-amber-500"   style={{ width: `${(moderate/total)*100}%` }} />}
                          {high > 0      && <div className="bg-red-500"     style={{ width: `${(high/total)*100}%` }} />}
                          {unassessed > 0 && <div className="bg-slate-300"  style={{ width: `${(unassessed/total)*100}%` }} />}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />{stable}</span>
                          <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500   mr-1" />{moderate}</span>
                          <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500     mr-1" />{high}</span>
                          {unassessed > 0 && <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 mr-1" />{unassessed} unassessed</span>}
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
                <Link to="/risk" className="text-xs text-teal-600 font-medium hover:text-teal-700 flex items-center gap-1">
                  All <ChevronRight size={13} />
                </Link>
              </div>
              {(data?.students_to_watch || []).length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No at-risk students in your classes.
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.students_to_watch.map(s => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.full_name}</p>
                        <p className="text-[11px] text-slate-400">
                          {s.grade_level} · {s.section}
                          {s.top_factor && <> · {FACTOR_LABEL[s.top_factor]}</>}
                        </p>
                      </div>
                      <RiskBadge level={s.risk_level} />
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
              <Link to="/score-entry" className="text-xs text-teal-600 font-medium hover:text-teal-700 flex items-center gap-1">
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
                              className="text-xs text-teal-600 font-medium hover:text-teal-700 flex items-center gap-1"
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
                <Link to="/behavior" className="text-xs text-teal-600 font-medium hover:text-teal-700 flex items-center gap-1">
                  Add <ChevronRight size={13} />
                </Link>
              </div>
              {(data?.behavior_recent || []).length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No behavior logs yet. <Link to="/behavior" className="text-teal-600">Add the first one</Link>.
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

            {/* ECE Competency placeholder — only for ECE-assigned teachers */}
            {isECE && (
              <div className="card p-5 border-2 border-dashed border-purple-200 bg-purple-50/30">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={16} className="text-purple-500" />
                  <h3 className="text-sm font-semibold text-slate-800">ECE Competency Checklist</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Coming soon — log developmental milestones for your{' '}
                  <span className="font-semibold text-purple-700">{data?.ece_student_count || 0}</span>{' '}
                  ECE student{(data?.ece_student_count || 0) !== 1 ? 's' : ''} on the
                  E / G / F / NA scale.
                </p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {['Reading & Language', 'Phonemic Awareness', 'Cognitive', 'Motor Skills'].map(d => (
                    <div key={d} className="px-2 py-1 bg-white rounded-md border border-purple-100 text-purple-700">
                      {d}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

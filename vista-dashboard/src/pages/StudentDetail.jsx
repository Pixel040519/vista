import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, ClipboardCheck, Heart, QrCode, Brain, TrendingUp, TrendingDown, MapPin } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { studentApi, gradesApi, attendanceApi, behaviorApi, aiApi } from '../api/client'
import { RiskBadge, SentimentBadge, LoadingSpinner, GradeChip } from '../components/UI'
import { format } from 'date-fns'
import { formatName, nameInitial } from '../utils/nameHelper'
import toast from 'react-hot-toast'

const calcAge = (dob) => {
  if (!dob) return null
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

const TABS = ['Overview', 'Grades', 'Attendance', 'Behavior', 'AI Insights']

export default function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [student, setStudent]   = useState(null)
  const [grades, setGrades]     = useState([])
  const [attendance, setAttendance] = useState([])
  const [behavior, setBehavior] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [risk, setRisk]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('Overview')
  const [qr, setQr]             = useState(null)
  const [generatingQr, setGeneratingQr] = useState(false)

  useEffect(() => {
    Promise.all([
      studentApi.get(id),
      gradesApi.get({ student_id: id }),
      attendanceApi.get({ student_id: id }),
      behaviorApi.get({ student_id: id }),
    ]).then(([s, g, a, b]) => {
      setStudent(s.data.student)
      setGrades(g.data.grades || [])
      setAttendance(a.data.attendance || [])
      setBehavior(b.data.logs || [])
    }).catch(() => {})
    .finally(() => setLoading(false))
  }, [id])

  const fetchAI = async () => {
    if (prediction) return // Already loaded
    try {
      const [pred, riskRes] = await Promise.all([
        aiApi.predict({ student_id: id }),
        aiApi.risk({ student_id: id }),
      ])
      setPrediction(pred.data)
      setRisk(riskRes.data)
    } catch {
      toast.error('AI service unavailable.')
    }
  }

  const handleTabChange = t => {
    setTab(t)
    if (t === 'AI Insights') fetchAI()
  }

  const handleGenerateQR = async () => {
    setGeneratingQr(true)
    try {
      const res = await studentApi.generateQR(id, 30)
      setQr(res.data)
      toast.success('QR code generated! Valid for 30 minutes.')
    } catch {}
    setGeneratingQr(false)
  }

  const attSummary = attendance.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1
    return a
  }, {})

  if (loading) return <LoadingSpinner />
  if (!student) return <div className="text-slate-500 text-sm">Student not found.</div>

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Back + header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors mt-0.5">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-teal-100 flex items-center justify-center flex-shrink-0">
              <span className="text-teal-700 font-bold text-lg sm:text-xl">{nameInitial(student)}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{formatName(student)}</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">LRN: {student.lrn}</span>
                <span className="text-xs text-slate-500">{student.grade_level} {student.section && `· ${student.section}`}</span>
                {risk && <RiskBadge level={risk.risk_level} />}
              </div>
            </div>
          </div>
          <button
            onClick={handleGenerateQR}
            disabled={generatingQr}
            className="btn-secondary"
          >
            <QrCode size={16} />
            {generatingQr ? 'Generating...' : 'Generate QR'}
          </button>
        </div>
      </div>

      {/* QR code display */}
      {qr && (
        <div className="card p-5 flex flex-col sm:flex-row items-center gap-5">
          <img src={qr.qrImage} alt="SecurePass QR" className="w-28 h-28 rounded-xl flex-shrink-0" />
          <div>
            <p className="font-semibold text-slate-800">SecurePass QR Generated</p>
            <p className="text-sm text-slate-500 mt-1">Show this to the guardian during dismissal.</p>
            <p className="text-xs text-amber-600 font-medium mt-1.5">
              ⏰ Expires: {format(new Date(qr.expiresAt), 'h:mm a, MMM d')}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Overview' && (
        <div className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Info card */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">Student Information</h3>
            {[
              ['LRN', student.lrn],
              ['Surname', student.surname],
              ['First Name', student.first_name],
              ['Middle Name', student.middle_name || '—'],
              ['Date of Birth', student.date_of_birth ? format(new Date(student.date_of_birth), 'MMM d, yyyy') : '—'],
              ['Age', calcAge(student.date_of_birth) !== null ? `${calcAge(student.date_of_birth)} years old` : '—'],
              ['Gender', student.gender],
              ['Grade Level', student.grade_level],
              ['Section', student.section || '—'],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-800">{val}</span>
              </div>
            ))}
          </div>

          {/* Attendance summary */}
          <div className="card relative overflow-hidden">
            <div className="absolute inset-0 p-5 flex flex-col overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 flex-shrink-0">
              <ClipboardCheck size={15} className="text-teal-500" /> Attendance Summary
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Present', count: attSummary.Present || 0, color: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50' },
                { label: 'Absent',  count: attSummary.Absent  || 0, color: 'bg-red-500',     textColor: 'text-red-700',     bg: 'bg-red-50'     },
                { label: 'Late',    count: attSummary.Late    || 0, color: 'bg-amber-500',   textColor: 'text-amber-700',   bg: 'bg-amber-50'   },
                { label: 'Excused', count: attSummary.Excused || 0, color: 'bg-blue-500',    textColor: 'text-blue-700',    bg: 'bg-blue-50'    },
              ].map(r => (
                <div key={r.label} className={`flex items-center justify-between px-3 py-2 rounded-xl ${r.bg}`}>
                  <span className={`text-sm font-medium ${r.textColor}`}>{r.label}</span>
                  <span className={`font-bold text-lg ${r.textColor}`}>{r.count}</span>
                </div>
              ))}
            </div>
            </div>
          </div>

          {/* Guardians */}
          <div className="card relative overflow-hidden">
            <div className="absolute inset-0 p-5 flex flex-col overflow-hidden">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 flex-shrink-0">
              <span>Linked Parents / Guardians</span>
              <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                {(student.guardians || []).length}
              </span>
            </h3>
            {(student.guardians || []).length === 0 ? (
              <p className="text-sm text-slate-400">No guardians linked yet.</p>
            ) : (
              <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                {student.guardians.map(g => (
                  <div key={g.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 flex-shrink-0">
                        {nameInitial(g)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-800">{formatName(g)}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 font-medium">{g.relationship}</span>
                          {g.is_emergency_contact && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-semibold">🚨 Emergency</span>
                          )}
                          {g.is_authorized_pickup && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-medium">✓ Pickup</span>
                          )}
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {g.email && <p className="text-xs text-slate-400 truncate">✉ {g.email}</p>}
                          {g.phone && <p className="text-xs text-slate-400">📞 {g.phone}</p>}
                          {g.home_address && <p className="text-xs text-slate-400">📍 {g.home_address}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Home Address card — full width */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <MapPin size={15} className="text-teal-500" /> Home Address
          </h3>
          {student.home_address ? (
            <p className="text-sm text-slate-700 leading-relaxed">{student.home_address}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">No home address recorded.</p>
          )}
        </div>
      </div>
      )}

      {tab === 'Grades' && (
        <div className="card overflow-hidden">
          {grades.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No grade records found.</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>
                  <th>School Year</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  grades.reduce((acc, g) => {
                    const key = `${g.subject_name}|||${g.school_year}`
                    if (!acc[key]) acc[key] = { subject: g.subject_name, year: g.school_year, quarters: {} }
                    acc[key].quarters[g.quarter] = g.grade
                    return acc
                  }, {})
                ).map(([key, row]) => (
                  <tr key={key}>
                    <td className="font-medium">{row.subject}</td>
                    <td><GradeChip grade={row.quarters[1]} /></td>
                    <td><GradeChip grade={row.quarters[2]} /></td>
                    <td><GradeChip grade={row.quarters[3]} /></td>
                    <td><GradeChip grade={row.quarters[4]} /></td>
                    <td className="text-slate-400 text-xs">{row.year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Attendance' && (
        <div className="card overflow-hidden">
          {attendance.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No attendance records found.</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Status</th><th>Remarks</th><th>Recorded By</th></tr></thead>
              <tbody>
                {attendance.slice(0, 50).map(a => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{format(new Date(a.date), 'MMM d, yyyy')}</td>
                    <td>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        a.status === 'Present' ? 'bg-emerald-50 text-emerald-700' :
                        a.status === 'Absent'  ? 'bg-red-50 text-red-700' :
                        a.status === 'Late'    ? 'bg-amber-50 text-amber-700' :
                                                 'bg-blue-50 text-blue-700'
                      }`}>{a.status}</span>
                    </td>
                    <td className="text-slate-500 text-xs">{a.remarks || '—'}</td>
                    <td className="text-slate-400 text-xs">{a.recorded_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Behavior' && (
        <div className="space-y-3">
          {behavior.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-400">No behavior logs yet.</div>
          ) : behavior.map(b => (
            <div key={b.id} className="card p-4 flex gap-4">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-slate-500">
                {b.teacher_name?.[0] || 'T'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-800">{b.teacher_name}</p>
                  <div className="flex items-center gap-2">
                    <SentimentBadge sentiment={b.sentiment} />
                    {b.category && <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">{b.category}</span>}
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-1.5">{b.observation}</p>
                <p className="text-xs text-slate-400 mt-1.5">{format(new Date(b.observed_at), 'MMM d, yyyy · h:mm a')}</p>
                {b.sentiment_score !== null && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-24">
                      <div
                        className={`h-full rounded-full ${b.sentiment === 'Positive' ? 'bg-teal-500' : b.sentiment === 'Negative' ? 'bg-red-500' : 'bg-slate-400'}`}
                        style={{ width: `${Math.abs(b.sentiment_score) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400">score: {b.sentiment_score?.toFixed(3)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'AI Insights' && (
        <div className="space-y-5">
          {/* Risk Assessment */}
          {risk ? (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Brain size={15} className="text-teal-500" /> Risk Assessment
              </h3>
              <div className="flex items-center gap-4 mb-4 flex-wrap">
                <RiskBadge level={risk.risk_level} />
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-slate-100 rounded-full">
                    <div
                      className={`h-full rounded-full ${risk.risk_level === 'High Risk' ? 'bg-red-500' : risk.risk_level === 'Moderate Risk' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${risk.risk_score * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono font-semibold">{(risk.risk_score * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 mb-4">{risk.recommendation}</div>
              {risk.factors?.length > 0 && (
                <div className="space-y-2 overflow-y-auto flex-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contributing Factors</p>
                  {risk.factors.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold mt-0.5 ${f.severity === 'High' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {f.severity}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{f.factor}</p>
                        <p className="text-xs text-slate-500">{f.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card p-8 text-center">
              <LoadingSpinner size="sm" />
              <p className="text-sm text-slate-400 mt-2">Analyzing student data...</p>
            </div>
          )}

          {/* Academic Predictions */}
          {prediction?.subjects?.map(subject => (
            <div key={subject.subject_id} className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">{subject.subject_name}</h3>
                <div className="flex items-center gap-2">
                  {subject.overall_trend === 'Improving' ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><TrendingUp size={14} /> Improving</span>
                  ) : subject.overall_trend === 'Declining' ? (
                    <span className="flex items-center gap-1 text-xs text-red-500 font-medium"><TrendingDown size={14} /> Declining</span>
                  ) : (
                    <span className="text-xs text-slate-400 font-medium">Stable</span>
                  )}
                </div>
              </div>

              {/* Grade chart */}
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={[
                  ...subject.historical_grades.map(h => ({ label: `Q${h.quarter}`, grade: h.grade, type: 'actual' })),
                  ...subject.predictions.map(p => ({ label: `Q${p.quarter} (pred)`, grade: p.predicted_grade, type: 'predicted' }))
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }} />
                  <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Passing', fontSize: 10, fill: '#f59e0b' }} />
                  <Line type="monotone" dataKey="grade" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4, fill: '#14b8a6' }} />
                </LineChart>
              </ResponsiveContainer>

              {subject.recommendation && (
                <div className="mt-3 text-sm text-slate-600 bg-teal-50 rounded-xl p-3 border border-teal-100">
                  {subject.recommendation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
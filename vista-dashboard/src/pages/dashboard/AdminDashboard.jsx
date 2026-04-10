import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, UserCheck, UserX, AlertTriangle, TrendingUp, Activity, ChevronRight } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { aiApi } from '../../api/client'
import { StatCard, RiskBadge, LoadingSpinner } from '../../components/UI'
import { useAuth } from '../../context/AuthContext'
import AttendanceDetailModal from '../../components/AttendanceDetailModal'

const SENTIMENT_COLORS = { Positive: '#14b8a6', Neutral: '#94a3b8', Negative: '#f43f5e' }
const RISK_COLORS = { stable: '#22c55e', moderate_risk: '#f59e0b', high_risk: '#ef4444' }

// Mock data for charts when AI service is loading
const MOCK_ATTENDANCE_TREND = [
  { day: 'Mon', rate: 94 }, { day: 'Tue', rate: 91 }, { day: 'Wed', rate: 96 },
  { day: 'Thu', rate: 89 }, { day: 'Fri', rate: 93 },
]

export default function AdminDashboard() {
  const { user } = useAuth()
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [attModal, setAttModal] = useState({ open: false, filter: 'present' })

  useEffect(() => {
    aiApi.dashboard()
      .then(res => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const att  = data?.todays_attendance || {}
  const risk = data?.risk_distribution  || {}
  const sent = data?.behavioral_sentiment_7d || {}
  const total = data?.overview?.total_students || 0

  const riskPieData = [
    { name: 'Stable',        value: risk.stable        || 0 },
    { name: 'Moderate Risk', value: risk.moderate_risk || 0 },
    { name: 'High Risk',     value: risk.high_risk     || 0 },
  ].filter(d => d.value > 0)

  const sentimentBarData = [
    { label: 'Positive', value: sent.positive || 0 },
    { label: 'Neutral',  value: sent.neutral  || 0 },
    { label: 'Negative', value: sent.negative || 0 },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'},{' '}
            <span className="text-teal-600">{user?.full_name?.split(' ')[0]}</span> 👋
          </h1>
          <p className="page-subtitle">Here's what's happening at school today.</p>
        </div>
        <Link to="/students" className="btn-secondary text-sm hidden sm:flex">
          View all students <ChevronRight size={15} />
        </Link>
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
            <StatCard
              title="Total Students"
              value={total.toLocaleString()}
              subtitle="Active enrollees"
              icon={Users}
              color="teal"
            />
            <StatCard
              title="Present Today"
              value={(att.present || 0) + (att.late || 0)}
              subtitle={`${att.total_logged ? Math.round(((att.present + att.late)/att.total_logged)*100) : 0}% attendance rate`}
              icon={UserCheck}
              color="emerald"
              onClick={() => setAttModal({ open: true, filter: 'present' })}
            />
            <StatCard
              title="Absent Today"
              value={att.absent || 0}
              subtitle="Need follow-up"
              icon={UserX}
              color="amber"
              onClick={() => setAttModal({ open: true, filter: 'absent' })}
            />
            <StatCard
              title="High Risk Alerts"
              value={risk.high_risk || 0}
              subtitle="Require immediate attention"
              icon={AlertTriangle}
              color="red"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Attendance Trend */}
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Attendance Trend</h3>
                  <p className="text-xs text-slate-400">This week</p>
                </div>
                <Activity size={16} className="text-slate-300" />
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={MOCK_ATTENDANCE_TREND}>
                  <defs>
                    <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[80, 100]} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.1)', fontSize: '12px' }}
                    formatter={v => [`${v}%`, 'Attendance Rate']}
                  />
                  <Area type="monotone" dataKey="rate" stroke="#14b8a6" strokeWidth={2.5} fill="url(#attGrad)" dot={{ r: 4, fill: '#14b8a6' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Risk Distribution Pie */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Risk Distribution</h3>
                  <p className="text-xs text-slate-400">All students</p>
                </div>
                <AlertTriangle size={16} className="text-slate-300" />
              </div>
              {riskPieData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={riskPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                        {riskPieData.map((entry, i) => (
                          <Cell key={i} fill={Object.values(RISK_COLORS)[i]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 mt-2">
                    {[
                      { label: 'Stable',        val: risk.stable,        color: 'bg-emerald-500' },
                      { label: 'Moderate Risk',  val: risk.moderate_risk, color: 'bg-amber-500'   },
                      { label: 'High Risk',      val: risk.high_risk,     color: 'bg-red-500'     },
                    ].map(r => (
                      <div key={r.label} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${r.color}`} />
                          <span className="text-slate-600">{r.label}</span>
                        </div>
                        <span className="font-semibold text-slate-800">{r.val || 0}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                  Run risk assessments to see data
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Behavioral Sentiment */}
            <div className="card p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Behavioral Sentiment</h3>
                <p className="text-xs text-slate-400">Last 7 days</p>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={sentimentBarData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {sentimentBarData.map((entry, i) => (
                      <Cell key={i} fill={Object.values(SENTIMENT_COLORS)[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* High Risk Alerts Table */}
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">High Risk Alerts</h3>
                  <p className="text-xs text-slate-400">Students needing immediate attention</p>
                </div>
                <Link to="/risk" className="text-xs text-teal-600 font-medium hover:text-teal-700 flex items-center gap-1">
                  View all <ChevronRight size={13} />
                </Link>
              </div>
              {(data?.high_risk_alerts || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <TrendingUp size={32} className="text-emerald-300 mb-2" />
                  <p className="text-sm font-medium text-slate-600">All students are stable</p>
                  <p className="text-xs text-slate-400 mt-0.5">No high-risk alerts at this time</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Grade</th>
                      <th>Risk Level</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.high_risk_alerts.slice(0, 5).map((a, i) => (
                      <tr key={i}>
                        <td className="font-medium">{a.student_name}</td>
                        <td className="text-slate-500">{a.grade_level}</td>
                        <td><RiskBadge level={a.risk_level} /></td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-16">
                              <div className="h-full bg-red-500 rounded-full" style={{ width: `${a.risk_score * 100}%` }} />
                            </div>
                            <span className="text-xs font-mono text-slate-500">{(a.risk_score * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </div>

          {/* Enrollment by Grade */}
          {data?.overview?.enrollment_by_grade?.length > 0 && (
            <div className="card p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Enrollment by Grade Level</h3>
                <p className="text-xs text-slate-400">Active students per level</p>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.overview.enrollment_by_grade} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="grade" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }} />
                  <Bar dataKey="count" name="Students" fill="#14b8a6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <AttendanceDetailModal
        open={attModal.open}
        onClose={() => setAttModal(prev => ({ ...prev, open: false }))}
        filter={attModal.filter}
        date={new Date().toISOString().split('T')[0]}
      />
    </div>
  )
}

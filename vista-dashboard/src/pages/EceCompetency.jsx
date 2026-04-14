import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { eceApi } from '../api/client'
import { LoadingSpinner } from '../components/UI'
import { Baby, Save, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const ECE_GRADES = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']
const QUARTERS = [1, 2, 3, 4]
const RATINGS = [
  { value: 'E',  label: 'Excellent',       color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { value: 'G',  label: 'Good',            color: 'bg-teal-100 text-teal-700 border-teal-300' },
  { value: 'F',  label: 'Fair',            color: 'bg-amber-100 text-amber-700 border-amber-300' },
  { value: 'NA', label: 'Needs Assistance', color: 'bg-red-100 text-red-700 border-red-300' },
]

export default function EceCompetency() {
  const { activeAssignments } = useAuth()
  const eceClasses = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const a of activeAssignments || []) {
      if (!ECE_GRADES.includes(a.grade_level)) continue
      const key = `${a.grade_level}||${a.section}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ grade_level: a.grade_level, section: a.section, key })
    }
    return out
  }, [activeAssignments])

  const [selectedClass, setSelectedClass] = useState('')
  const [quarter, setQuarter] = useState(1)
  const [domains, setDomains] = useState([])
  const [skills, setSkills] = useState([])
  const [students, setStudents] = useState([])
  const [grid, setGrid] = useState({}) // grid[studentId][skillId] = rating
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load catalog once
  useEffect(() => {
    Promise.all([eceApi.getDomains(), eceApi.getSkills()])
      .then(([dRes, sRes]) => {
        setDomains(dRes.data.domains || [])
        setSkills(sRes.data.skills || [])
      })
      .catch(() => toast.error('Failed to load competency catalog'))
  }, [])

  // Auto-select first class
  useEffect(() => {
    if (!selectedClass && eceClasses.length > 0) {
      setSelectedClass(eceClasses[0].key)
    }
  }, [eceClasses, selectedClass])

  // Load records whenever class/quarter changes
  useEffect(() => {
    if (!selectedClass) return
    const [grade_level, section] = selectedClass.split('||')
    setLoading(true)
    eceApi.getRecords({ grade_level, section, quarter })
      .then(res => {
        setStudents(res.data.students || [])
        const g = {}
        for (const r of res.data.records || []) {
          if (!g[r.student_id]) g[r.student_id] = {}
          g[r.student_id][r.skill_id] = r.rating
        }
        setGrid(g)
        setDirty(false)
      })
      .catch(err => toast.error(err.response?.data?.error || 'Failed to load records'))
      .finally(() => setLoading(false))
  }, [selectedClass, quarter])

  const setRating = (studentId, skillId, rating) => {
    setGrid(prev => {
      const next = { ...prev }
      if (!next[studentId]) next[studentId] = {}
      if (next[studentId][skillId] === rating) {
        // click same = clear
        const copy = { ...next[studentId] }
        delete copy[skillId]
        next[studentId] = copy
      } else {
        next[studentId] = { ...next[studentId], [skillId]: rating }
      }
      return next
    })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!selectedClass) return
    const [grade_level, section] = selectedClass.split('||')
    const entries = []
    for (const student of students) {
      const sg = grid[student.id] || {}
      for (const [skillId, rating] of Object.entries(sg)) {
        entries.push({ student_id: student.id, skill_id: skillId, rating })
      }
    }
    if (entries.length === 0) {
      toast.error('No ratings to save')
      return
    }
    setSaving(true)
    try {
      await eceApi.saveRecords({ grade_level, section, quarter, entries })
      toast.success(`Saved ${entries.length} rating(s)`)
      setDirty(false)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save')
    }
    setSaving(false)
  }

  if (eceClasses.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Baby size={40} className="mx-auto text-slate-300 mb-3" />
        <h2 className="text-lg font-semibold text-slate-800">No ECE classes assigned</h2>
        <p className="text-sm text-slate-500 mt-1">
          Competency tracking is available for Pre-Nursery, Nursery, Pre-Kinder, and Kinder teachers.
        </p>
      </div>
    )
  }

  const skillsByDomain = domains.map(d => ({
    ...d,
    skills: skills.filter(s => s.domain_id === d.id),
  }))

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">ECE Competency Tracker</h1>
          <p className="page-subtitle">Record developmental milestones for early learners</p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="btn-primary"
        >
          <Save size={16} /> {saving ? 'Saving…' : 'Save Ratings'}
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select className="input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
            {eceClasses.map(c => (
              <option key={c.key} value={c.key}>{c.grade_level} — {c.section}</option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium text-slate-600 mb-1">Quarter</label>
          <select className="input" value={quarter} onChange={e => setQuarter(Number(e.target.value))}>
            {QUARTERS.map(q => <option key={q} value={q}>Q{q}</option>)}
          </select>
        </div>
      </div>

      {/* Legend */}
      <div className="card p-4 flex flex-wrap items-center gap-3 text-xs">
        <Info size={14} className="text-slate-400" />
        <span className="text-slate-500 font-medium">Scale:</span>
        {RATINGS.map(r => (
          <span key={r.value} className={`px-2 py-1 rounded-full border ${r.color} font-semibold`}>
            {r.value} = {r.label}
          </span>
        ))}
        <span className="text-slate-400 ml-auto">Click a rating again to clear it</span>
      </div>

      {loading ? <LoadingSpinner /> : (
        students.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-500">
            No active students in this class.
          </div>
        ) : (
          <div className="space-y-5">
            {skillsByDomain.map(domain => domain.skills.length > 0 && (
              <div key={domain.id} className="card overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">{domain.name}</h3>
                  {domain.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{domain.description}</p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="whitespace-nowrap">Student</th>
                        {domain.skills.map(s => (
                          <th key={s.id} className="whitespace-nowrap text-xs" title={s.description || ''}>
                            {s.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {students.map(st => (
                        <tr key={st.id}>
                          <td className="font-medium text-sm whitespace-nowrap">{st.full_name}</td>
                          {domain.skills.map(sk => {
                            const current = grid[st.id]?.[sk.id]
                            return (
                              <td key={sk.id}>
                                <div className="flex gap-1">
                                  {RATINGS.map(r => (
                                    <button
                                      key={r.value}
                                      type="button"
                                      onClick={() => setRating(st.id, sk.id, r.value)}
                                      className={`w-8 h-7 rounded-md text-xs font-bold border transition ${
                                        current === r.value
                                          ? r.color
                                          : 'border-slate-200 text-slate-400 hover:border-slate-300'
                                      }`}
                                      title={r.label}
                                    >
                                      {r.value}
                                    </button>
                                  ))}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

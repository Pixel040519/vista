import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { Modal, LoadingSpinner } from './UI'
import { attendanceApi } from '../api/client'

const PRIORITY = { Present: 1, Late: 2, Excused: 3, Absent: 4 }
const STATUS_STYLE = {
  Present: 'bg-emerald-50 text-emerald-700',
  Late:    'bg-amber-50 text-amber-700',
  Excused: 'bg-blue-50 text-blue-700',
  Absent:  'bg-red-50 text-red-700',
}
const STATUS_LABEL = { Present: 'P', Late: 'L', Excused: 'E', Absent: 'A' }

export default function AttendanceDetailModal({ open, onClose, filter = 'present', date }) {
  const [tab, setTab] = useState(filter)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)

  // Sync tab when filter prop changes (clicked different card)
  useEffect(() => { setTab(filter) }, [filter])

  // Collect all possible section keys from records (tab-independent)
  const allSectionKeys = useMemo(() => {
    const keys = new Set()
    for (const r of records) keys.add(`${r.grade_level}::${r.section}`)
    return keys
  }, [records])

  // Reset sections to collapsed when tab changes
  useEffect(() => { setCollapsedSections(new Set(allSectionKeys)) }, [tab, allSectionKeys])

  useEffect(() => {
    if (!open || !date) return
    setLoading(true)
    attendanceApi.dailyDetail(date)
      .then(res => setRecords(res.data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [open, date])

  // Build per-student map with subjects and derived fields
  const { grouped, presentCount, absentCount, lateCount } = useMemo(() => {
    const studentMap = new Map()

    for (const r of records) {
      if (!studentMap.has(r.student_id)) {
        studentMap.set(r.student_id, {
          student_id: r.student_id,
          full_name: r.full_name,
          grade_level: r.grade_level,
          section: r.section,
          subjects: [],
        })
      }
      studentMap.get(r.student_id).subjects.push({
        subject_name: r.subject_name,
        status: r.status,
      })
    }

    // Compute best status and class-cut flag per student
    const students = []
    for (const s of studentMap.values()) {
      const best = Math.min(...s.subjects.map(sub => PRIORITY[sub.status] ?? 4))
      const hasPresent = s.subjects.some(sub => sub.status === 'Present' || sub.status === 'Late')
      const hasAbsent = s.subjects.some(sub => sub.status === 'Absent')
      students.push({ ...s, bestStatus: best, isClassCut: hasPresent && hasAbsent })
    }

    // Count by best status (matches dashboard.py logic)
    let presentCount = 0, absentCount = 0, lateCount = 0
    for (const s of students) {
      if (s.bestStatus === 1) presentCount++
      else if (s.bestStatus === 4) absentCount++
      else if (s.bestStatus === 2) lateCount++
    }

    // Filter by tab (Late students grouped under Present since they attended)
    const filtered = students.filter(s => {
      if (tab === 'present') return s.bestStatus === 1 || s.bestStatus === 2
      if (tab === 'absent') return s.bestStatus === 4
      return true
    })

    // Group by grade_level → section
    const gradeMap = new Map()
    for (const s of filtered) {
      const key = s.grade_level
      if (!gradeMap.has(key)) gradeMap.set(key, new Map())
      const sectionMap = gradeMap.get(key)
      if (!sectionMap.has(s.section)) sectionMap.set(s.section, { students: [], subjects: new Set() })
      const sec = sectionMap.get(s.section)
      sec.students.push(s)
      s.subjects.forEach(sub => sec.subjects.add(sub.subject_name))
    }

    // Sort and convert to array structure
    const gradeOrder = ['Kinder',
      'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']
    const grouped = [...gradeMap.entries()]
      .sort((a, b) => gradeOrder.indexOf(a[0]) - gradeOrder.indexOf(b[0]))
      .map(([grade, sectionMap]) => ({
        grade,
        sections: [...sectionMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([section, data]) => ({
            section,
            subjects: [...data.subjects].sort(),
            students: data.students.sort((a, b) => a.full_name.localeCompare(b.full_name)),
          })),
      }))

    return { grouped, presentCount, absentCount, lateCount }
  }, [records, tab])

  const [collapsedGrades, setCollapsedGrades] = useState(new Set())
  const toggleGrade = (grade) => setCollapsedGrades(prev => {
    const next = new Set(prev)
    next.has(grade) ? next.delete(grade) : next.add(grade)
    return next
  })
  const [collapsedSections, setCollapsedSections] = useState(() => {
    const keys = new Set()
    for (const g of grouped) for (const s of g.sections) keys.add(`${g.grade}::${s.section}`)
    return keys
  })
  const toggleSection = (key) => setCollapsedSections(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const formatted = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }) : ''

  const TAB_COLORS = {
    present: { active: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-600' },
    absent:  { active: 'text-red-600',     badge: 'bg-red-50 text-red-600' },
  }
  const tabs = [
    { key: 'present', label: 'Present', count: presentCount + lateCount },
    { key: 'absent',  label: 'Absent',  count: absentCount },
  ]

  return (
    <Modal open={open} onClose={onClose} title={`Attendance Detail \u2014 ${formatted}`} size="xl" selfScroll>
      {loading ? <LoadingSpinner /> : (
        <div className="flex flex-col h-full">
          {/* Tab bar */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4 shrink-0">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  tab === t.key
                    ? clsx('bg-white shadow-sm', TAB_COLORS[t.key].active)
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t.label} <span className={clsx(
                  'ml-1 text-xs px-1.5 py-0.5 rounded-full',
                  tab === t.key ? TAB_COLORS[t.key].badge : 'bg-slate-200 text-slate-500'
                )}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 space-y-3">
            {grouped.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-slate-500">
                  {records.length === 0
                    ? 'No attendance has been recorded for today.'
                    : `No students in this category.`}
                </p>
              </div>
            ) : (
              grouped.map(({ grade, sections }) => (
                <div key={grade} className="border border-slate-200 rounded-xl overflow-hidden">
                  {/* Grade header */}
                  <button
                    onClick={() => toggleGrade(grade)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                  >
                    {collapsedGrades.has(grade) ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-800">{grade}</span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {sections.reduce((sum, s) => sum + s.students.length, 0)} student{sections.reduce((sum, s) => sum + s.students.length, 0) !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {!collapsedGrades.has(grade) && sections.map(({ section, subjects, students }) => {
                    const sectionKey = `${grade}::${section}`
                    return (
                    <div key={section} className="border-t border-slate-100">
                      {/* Section sub-header */}
                      <button
                        onClick={() => toggleSection(sectionKey)}
                        className="w-full flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
                      >
                        {collapsedSections.has(sectionKey) ? <ChevronRight size={14} className="text-brand-400" /> : <ChevronDown size={14} className="text-brand-400" />}
                        <span className="text-xs font-semibold text-brand-600 uppercase tracking-wider">{section}</span>
                        <span className="text-xs text-slate-400">{students.length} student{students.length !== 1 ? 's' : ''}</span>
                      </button>

                      {/* Table */}
                      {!collapsedSections.has(sectionKey) && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50/50">
                              <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 whitespace-nowrap sticky left-0 bg-slate-50/50">Student</th>
                              {subjects.map(sub => (
                                <th key={sub} className="text-center px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">{sub}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {students.map(student => (
                              <tr key={student.student_id} className={clsx('border-t border-slate-50', student.isClassCut && 'bg-amber-50/30')}>
                                <td className="px-4 py-2 whitespace-nowrap sticky left-0 bg-white">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-800 text-xs">{student.full_name}</span>
                                    {student.isClassCut && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-medium whitespace-nowrap">
                                        <AlertTriangle size={10} /> Possible skipping class
                                      </span>
                                    )}
                                  </div>
                                </td>
                                {subjects.map(sub => {
                                  const match = student.subjects.find(s => s.subject_name === sub)
                                  return (
                                    <td key={sub} className="text-center px-3 py-2">
                                      {match ? (
                                        <span className={clsx('inline-block w-6 h-6 leading-6 rounded-md text-xs font-semibold', STATUS_STYLE[match.status])}>
                                          {STATUS_LABEL[match.status]}
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">&mdash;</span>
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      )}
                    </div>
                  )})}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

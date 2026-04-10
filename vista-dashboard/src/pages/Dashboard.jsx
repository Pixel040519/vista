import { useAuth } from '../context/AuthContext'
import AdminDashboard from './dashboard/AdminDashboard'
import TeacherDashboard from './dashboard/TeacherDashboard'

export default function Dashboard() {
  const { user } = useAuth()
  if (user?.role === 'teacher') return <TeacherDashboard />
  return <AdminDashboard />
}

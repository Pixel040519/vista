import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentDetail from './pages/StudentDetail'
import Attendance from './pages/Attendance'
import Grades from './pages/Grades'
import Behavior from './pages/Behavior'
import SecurePass from './pages/SecurePass'
import SecurePassScan from './pages/SecurePassScan'
import Announcements from './pages/Announcements'
import RiskOverview from './pages/RiskOverview'
import AccountManagement from './pages/AccountManagement'
import CurriculumManagement from './pages/CurriculumManagement'
import ScoreEntry from './pages/ScoreEntry'
import EceCompetency from './pages/EceCompetency'
import Profile from './pages/Profile'
import { ROLES, ANY_ADMIN } from './utils/roles'


function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Loading VISTA...</p>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Toaster
          position="top-right"
          toastOptions={{
            style: { fontFamily: 'DM Sans, sans-serif', fontSize: '14px', borderRadius: '12px' },
            success: { iconTheme: { primary: '#14b8a6', secondary: '#fff' } }
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <PrivateRoute><Layout /></PrivateRoute>
          }>
            <Route index element={<Dashboard />} />

            <Route path="students" element={<Students />} />

            <Route path="students/:id" element={<StudentDetail />} />

            <Route path="attendance" element={<Attendance />} />

            <Route path="grades" element={
              <PrivateRoute roles={[ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM, ROLES.TEACHER]}><Grades /></PrivateRoute>
            } />

            <Route path="score-entry" element={
              <PrivateRoute roles={['teacher']}><ScoreEntry /></PrivateRoute>
            } />

            <Route path="ece-competency" element={
              <PrivateRoute roles={[ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.TEACHER]}><EceCompetency /></PrivateRoute>
            } />

            <Route path="behavior" element={<Behavior />} />

            <Route path="securepass" element={
              <PrivateRoute roles={[...ANY_ADMIN, ROLES.TEACHER]}><SecurePass /></PrivateRoute>
            } />

            <Route path="securepass/scan" element={
              <PrivateRoute roles={[...ANY_ADMIN, ROLES.TEACHER]}><SecurePassScan /></PrivateRoute>
            } />

            <Route path="risk" element={
              <PrivateRoute roles={[...ANY_ADMIN, ROLES.TEACHER]}><RiskOverview /></PrivateRoute>
            } />

            <Route path="announcements" element={<Announcements />} />

            <Route path="profile" element={<Profile />} />

            <Route path="accounts" element={
              <PrivateRoute roles={ANY_ADMIN}><AccountManagement /></PrivateRoute>
            } />

            <Route path="curriculum" element={
              <PrivateRoute roles={ANY_ADMIN}><CurriculumManagement /></PrivateRoute>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
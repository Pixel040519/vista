// PREVIEW MODE — swap this with main.jsx to bypass auth
// Usage: rename this to main.jsx temporarily
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthContext } from './context/AuthContext'
import './index.css'

// All page imports
import Layout from './components/Layout/Layout'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentDetail from './pages/StudentDetail'
import Attendance from './pages/Attendance'
import Grades from './pages/Grades'
import Behavior from './pages/Behavior'
import SecurePass from './pages/SecurePass'
import RiskOverview from './pages/RiskOverview'
import Announcements from './pages/Announcements'
import Login from './pages/Login'

// Mock user — change role to 'teacher' or 'parent' to test role-based UI
const MOCK_USER = {
  id: 'preview-user',
  full_name: 'Preview admin',
  email: 'admin@vista.edu.ph',
  role: 'admin',
}

const MOCK_AUTH = {
  user: MOCK_USER,
  login: async () => MOCK_USER,
  logout: () => {},
  loading: false,
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthContext.Provider value={MOCK_AUTH}>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{
          style: { fontFamily: 'DM Sans, sans-serif', fontSize: '14px', borderRadius: '12px' }
        }} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentDetail />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="grades" element={<Grades />} />
            <Route path="behavior" element={<Behavior />} />
            <Route path="securepass" element={<SecurePass />} />
            <Route path="risk" element={<RiskOverview />} />
            <Route path="announcements" element={<Announcements />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  </React.StrictMode>
)
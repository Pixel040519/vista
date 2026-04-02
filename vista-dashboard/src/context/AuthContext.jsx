import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { authApi } from '../api/client'

//this auth context is for preview mode only, to bypass to every page of the system.
export const AuthContext = createContext(null)

//original code for real authentication.
//const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      authApi.me()
        .then(res => setUser(res.data.user))
        .catch(() => localStorage.clear())
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email, password) => {
    const res = await authApi.login({ email, password })
    const { user, accessToken, refreshToken } = res.data
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    setUser(user)
    return user
  }

  const logout = () => {
    localStorage.clear()
    setUser(null)
  }

  const activeAssignments = useMemo(() => {
    if (!user?.assignments) return []
    if (!user.active_school_year) return user.assignments
    return user.assignments.filter(a => a.school_year === user.active_school_year)
  }, [user])

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, activeAssignments }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
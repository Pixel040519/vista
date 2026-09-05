import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { authApi } from '../api/client'
import { gradeScopeForRole, isAnyAdmin, isSuperAdmin, isScopedAdmin, ROLES } from '../utils/roles'

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

  // Read by syncActiveSchoolYear, which must compare against the user as it is
  // now — a closure would compare against the one captured when its caller was
  // created, and go on refreshing (or not) on the strength of a year that has
  // already changed once.
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])

  const refreshUser = useCallback(async () => {
    try {
      const res = await authApi.me()
      setUser(res.data.user)
      return res.data.user
    } catch { return null }
  }, [])

  // The auth payload snapshots the active school year — its label, period model
  // and grading policy — and nothing in the session invalidates that. Activating
  // a different year, or renaming the active one, moves it out from under every
  // page that reads it, and until now only a browser reload caught up. So
  // whoever fetches a fresh list of years hands the active label here; only a
  // real difference costs a /me round trip.
  const syncActiveSchoolYear = useCallback((label = null) => {
    const current = userRef.current
    if (!current || label === current.active_school_year) return
    return refreshUser()
  }, [refreshUser])

  const activeAssignments = useMemo(() => {
    if (!user?.assignments) return []
    if (!user.active_school_year) return user.assignments
    return user.assignments.filter(a => a.school_year === user.active_school_year)
  }, [user])

  // The sections this teacher advises. Unlike `assignments` above there is no
  // filtering to do — /login and /me already scope it to the active school year,
  // because an advisory is a now-fact and no surface asks for last year's.
  const advisory = useMemo(() => user?.advisory || [], [user])

  const updateUser = (patch) => {
    setUser(prev => prev ? { ...prev, ...patch } : prev)
  }

  const gradeScope = useMemo(
    () => user?.grade_scope || (user?.role ? gradeScopeForRole(user.role) : []),
    [user]
  )

  const roleFlags = useMemo(() => ({
    isSuperAdmin:  isSuperAdmin(user?.role),
    isAnyAdmin:    isAnyAdmin(user?.role),
    isScopedAdmin: isScopedAdmin(user?.role),
    isTeacher:     user?.role === ROLES.TEACHER,
    isParent:      user?.role === ROLES.PARENT,
  }), [user])

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading, activeAssignments, advisory, updateUser,
      refreshUser, syncActiveSchoolYear,
      gradeScope, ...roleFlags,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
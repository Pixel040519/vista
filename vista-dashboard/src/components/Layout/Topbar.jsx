import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, Menu } from 'lucide-react'
import { notificationApi } from '../../api/client'
import { format } from 'date-fns'

const routeLabels = {
  '/': 'Dashboard',
  '/students': 'Students',
  '/attendance': 'Attendance',
  '/grades': 'Grades',
  '/behavior': 'Behavior Monitoring',
  '/securepass': 'SecurePass QR',
  '/risk': 'Risk Overview',
  '/announcements': 'Announcements',
  '/accounts': 'Account Management',
  '/curriculum': 'Curriculum Management',
}

export default function Topbar({ onMenuToggle }) {
  const location = useLocation()
  const [notifications, setNotifications] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const unread = notifications.filter(n => !n.is_read).length

  const label = routeLabels[location.pathname] ||
    (location.pathname.startsWith('/students/') ? 'Student Detail' : 'VISTA')

  useEffect(() => {
    notificationApi.list()
      .then(res => setNotifications(res.data.notifications || []))
      .catch(() => {})
  }, [])

  return (
    <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-20">
      {/* Left side: hamburger + page title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div>
          <h2 className="text-slate-900 font-semibold text-base">{label}</h2>
          <p className="text-slate-400 text-xs hidden sm:block">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-sm card shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
                {unread > 0 && (
                  <span className="text-xs bg-red-100 text-red-600 font-medium px-2 py-0.5 rounded-full">
                    {unread} unread
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
                ) : notifications.slice(0, 10).map(n => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${!n.is_read ? 'bg-teal-50/50' : ''}`}
                    onClick={() => {
                      notificationApi.read(n.id).catch(() => {})
                      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
                    }}
                  >
                    <p className="text-sm font-medium text-slate-800">{n.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {format(new Date(n.sent_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

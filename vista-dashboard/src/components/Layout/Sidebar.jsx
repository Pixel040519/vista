import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  LayoutDashboard, Users, ClipboardCheck, BookOpen,
  Heart, QrCode, AlertTriangle, Megaphone, UserCog,
  LogOut, GraduationCap, ChevronRight
} from 'lucide-react'
import clsx from 'clsx'

const navGroups = [
  {
    label: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    ]
  },
  {
    label: 'Student Management',
    items: [
      { to: '/students',    icon: Users,          label: 'Students'   },
      { to: '/attendance',  icon: ClipboardCheck, label: 'Attendance' },
      { to: '/grades',      icon: BookOpen,       label: 'Grades'     },
      { to: '/behavior',    icon: Heart,          label: 'Behavior'   },
    ]
  },
  {
    label: 'Tools',
    items: [
      { to: '/securepass',    icon: QrCode,         label: 'SecurePass QR', roles: ['admin','teacher'] },
      { to: '/risk',          icon: AlertTriangle,  label: 'Risk Overview', roles: ['admin'] },
      { to: '/announcements', icon: Megaphone,      label: 'Announcements'  },
      { to: '/accounts',     icon: UserCog,        label: 'Accounts',      roles: ['admin'] },
      { to: '/curriculum',   icon: GraduationCap,  label: 'Curriculum',    roles: ['admin'] },
    ]
  }
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-navy-900 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/30">
            <GraduationCap size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none tracking-wide font-sans">VISTA</h1>
            <p className="text-slate-400 text-xs mt-0.5">Student Monitor</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map(group => {
          const visibleItems = group.items.filter(
            item => !item.roles || item.roles.includes(user?.role)
          )
          if (visibleItems.length === 0) return null

          return (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-widest">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    className={({ isActive }) =>
                      clsx('nav-item', isActive && 'active')
                    }
                  >
                    <item.icon size={17} />
                    <span>{item.label}</span>
                    <ChevronRight size={14} className="ml-auto opacity-30" />
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
          <div className="w-8 h-8 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-teal-400 text-sm font-bold">
              {user?.full_name?.[0]?.toUpperCase() || 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.full_name}</p>
            <p className="text-slate-500 text-xs capitalize">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Logout"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
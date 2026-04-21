import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  LayoutDashboard, Users, ClipboardCheck, BookOpen,
  Heart, QrCode, AlertTriangle, Megaphone, UserCog,
  LogOut, GraduationCap, ChevronRight, X, PenLine, Baby
} from 'lucide-react'
import clsx from 'clsx'
import { formatName, nameInitial } from '../../utils/nameHelper'
import { Modal } from '../UI'
import nrysLogo from '../../assets/NRYS_logo.png'
import { ROLES, ANY_ADMIN, ROLE_LABELS } from '../../utils/roles'

const adminNavGroups = [
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
      { to: '/grades',       icon: BookOpen,       label: 'Grades',
        roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM] },
      // ECE Competency visible to super_admin + admin_ece only (admin_elem has no ECE scope)
      { to: '/ece-competency', icon: Baby,         label: 'ECE Competency',
        roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE] },
      { to: '/behavior',    icon: Heart,          label: 'Behavior'   },
    ]
  },
  {
    label: 'Tools',
    items: [
      { to: '/securepass',    icon: QrCode,         label: 'SecurePass QR', roles: [...ANY_ADMIN, ROLES.TEACHER] },
      { to: '/risk',          icon: AlertTriangle,  label: 'Risk Overview', roles: ANY_ADMIN },
      { to: '/announcements', icon: Megaphone,      label: 'Announcements'  },
    ]
  },
  {
    label: 'Administration',
    items: [
      { to: '/accounts',     icon: UserCog,        label: 'Accounts',      roles: ANY_ADMIN },
      { to: '/curriculum',   icon: GraduationCap,  label: 'Curriculum',    roles: ANY_ADMIN },
    ]
  }
]

const teacherNavGroups = [
  {
    label: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    ]
  },
  {
    label: "Today's Work",
    items: [
      { to: '/attendance',    icon: ClipboardCheck, label: 'Attendance'  },
      { to: '/score-entry',   icon: PenLine,        label: 'Score Entry' },
      { to: '/ece-competency', icon: Baby,           label: 'ECE Competency' },
    ]
  },
  {
    label: 'My Students',
    items: [
      { to: '/students', icon: Users,         label: 'Students'      },
      { to: '/behavior', icon: Heart,         label: 'Behavior'      },
      { to: '/risk',     icon: AlertTriangle, label: 'Risk Overview' },
    ]
  },
  {
    label: 'Communication',
    items: [
      { to: '/announcements', icon: Megaphone, label: 'Announcements' },
    ]
  }
]

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [confirmLogout, setConfirmLogout] = useState(false)

  const handleLogout = () => {
    setConfirmLogout(false)
    logout()
    navigate('/login')
  }

  // Close sidebar on mobile when navigating
  const handleNavClick = () => {
    onClose()
  }

  return (
    <aside className={clsx(
      'fixed inset-y-0 left-0 w-64 bg-navy-900 flex flex-col z-40 transition-transform duration-200 ease-in-out',
      'lg:translate-x-0',
      open ? 'translate-x-0' : '-translate-x-full'
    )}>
      {/* Logo + mobile close */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={nrysLogo} alt="NRYS Logo" width={40} height={40} className="w-10 h-10 rounded-full flex-shrink-0" style={{ objectFit: 'cover', display: 'block' }} />
            <div>
              <h1 className="text-white font-bold text-lg leading-none tracking-wide font-sans">VISTA</h1>
              <p className="text-slate-400 text-[10px] mt-0.5">Northern Rizal Yorklin School</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {(user?.role === ROLES.TEACHER ? teacherNavGroups : adminNavGroups).map(group => {
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
                    onClick={handleNavClick}
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
        <div className="flex items-center gap-1 px-1 py-1 rounded-xl">
          <NavLink
            to="/profile"
            onClick={handleNavClick}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 flex-1 min-w-0 px-2 py-1.5 rounded-lg transition-colors',
              isActive ? 'bg-white/10' : 'hover:bg-white/5'
            )}
            title="View profile"
          >
            <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
              <span className="text-brand-400 text-sm font-bold">
                {user ? nameInitial(user) : 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-white text-sm font-medium truncate">{user ? formatName(user) : ''}</p>
              <p className="text-slate-500 text-xs">{ROLE_LABELS[user?.role] || user?.role}</p>
            </div>
          </NavLink>
          <button
            onClick={() => setConfirmLogout(true)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out?"
        size="sm"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
              <LogOut size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-700">
                You'll be returned to the login screen. Any unsaved changes on the current page will be lost.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setConfirmLogout(false)}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </div>
      </Modal>
    </aside>
  )
}

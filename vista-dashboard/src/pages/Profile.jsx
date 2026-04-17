import { useState } from 'react'
import { UserCog, Mail, Phone, ShieldCheck, Calendar, Eye, EyeOff, KeyRound, GraduationCap, Save } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { profileApi } from '../api/client'
import { PhoneInput } from '../components/UI'
import { formatName, nameInitial, titleCase } from '../utils/nameHelper'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const roleLabels = {
  admin: 'Administrator',
  teacher: 'Teacher',
  parent: 'Parent / Guardian',
}

const roleStyles = {
  admin:   'bg-purple-50 text-purple-700 border-purple-200',
  teacher: 'bg-teal-50 text-teal-700 border-teal-200',
  parent:  'bg-amber-50 text-amber-700 border-amber-200',
}

function formatMemberSince(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return '—'
  }
}

// ── Personal Info Card ───────────────────────────────────────
function PersonalInfoForm({ user, onSaved }) {
  const [form, setForm] = useState({
    surname:     user?.surname || '',
    first_name:  user?.first_name || '',
    middle_name: user?.middle_name || '',
    phone:       user?.phone || '',
  })
  const [saving, setSaving] = useState(false)

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const dirty =
    form.surname     !== (user?.surname || '') ||
    form.first_name  !== (user?.first_name || '') ||
    form.middle_name !== (user?.middle_name || '') ||
    form.phone       !== (user?.phone || '')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.surname.trim() || !form.first_name.trim()) {
      toast.error('Surname and first name are required.')
      return
    }
    if (!form.phone || form.phone.replace(/\D/g, '').length < 11) {
      toast.error('Please enter a complete phone number.')
      return
    }
    setSaving(true)
    try {
      const res = await profileApi.updateMe({
        surname:     form.surname.trim(),
        first_name:  form.first_name.trim(),
        middle_name: form.middle_name?.trim() || '',
        phone:       form.phone,
      })
      onSaved(res.data.user)
      toast.success('Profile updated.')
    } catch {
      // toast handled by axios interceptor
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
          <UserCog size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Personal Information</h2>
          <p className="text-xs text-slate-500">Update your name and contact number.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Surname *</label>
            <input
              className="input"
              placeholder="Dela Cruz"
              value={form.surname}
              onChange={e => setField('surname', e.target.value)}
              onBlur={e => setField('surname', titleCase(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">First Name *</label>
            <input
              className="input"
              placeholder="Juan"
              value={form.first_name}
              onChange={e => setField('first_name', e.target.value)}
              onBlur={e => setField('first_name', titleCase(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Middle Name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              className="input"
              placeholder="Santos"
              value={form.middle_name}
              onChange={e => setField('middle_name', e.target.value)}
              onBlur={e => setField('middle_name', titleCase(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
            <input
              className="input"
              type="email"
              value={user?.email || ''}
              disabled
            />
            <p className="text-xs text-slate-400 mt-1">
              Contact an administrator to change your email.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone *</label>
            <PhoneInput
              className="input pr-14"
              value={form.phone}
              onChange={v => setField('phone', v)}
              required
            />
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="btn-primary justify-center"
          >
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Password input row (module-scope so it doesn't remount per keystroke) ──
function PasswordField({ label, value, onChange, placeholder, visible, onToggle, autoComplete }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div className="relative">
        <input
          className="input pr-10"
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          tabIndex={-1}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  )
}

// ── Change Password Card ─────────────────────────────────────
function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [show, setShow] = useState({ current: false, next: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState('')

  const setField = (k, v) => {
    setForm(p => ({ ...p, [k]: v }))
    if (fieldError) setFieldError('')
  }

  const toggle = (k) => setShow(p => ({ ...p, [k]: !p[k] }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFieldError('')

    if (!form.currentPassword) {
      setFieldError('Please enter your current password.')
      return
    }
    if (form.newPassword.length < 8) {
      setFieldError('New password must be at least 8 characters.')
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setFieldError('New password and confirmation do not match.')
      return
    }
    if (form.newPassword === form.currentPassword) {
      setFieldError('New password must be different from your current one.')
      return
    }

    setSaving(true)
    try {
      await profileApi.changePassword({
        currentPassword: form.currentPassword,
        newPassword:     form.newPassword,
      })
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      toast.success('Password updated.')
    } catch (err) {
      if (err.response?.status === 401) {
        setFieldError('Current password is incorrect.')
      }
      // other errors toasted by interceptor
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <KeyRound size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Change Password</h2>
          <p className="text-xs text-slate-500">You'll need your current password to set a new one.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordField
          label="Current Password"
          value={form.currentPassword}
          onChange={v => setField('currentPassword', v)}
          placeholder="••••••••"
          visible={show.current}
          onToggle={() => toggle('current')}
          autoComplete="current-password"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PasswordField
            label="New Password"
            value={form.newPassword}
            onChange={v => setField('newPassword', v)}
            placeholder="Min. 8 characters"
            visible={show.next}
            onToggle={() => toggle('next')}
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm New Password"
            value={form.confirmPassword}
            onChange={v => setField('confirmPassword', v)}
            placeholder="Repeat new password"
            visible={show.confirm}
            onToggle={() => toggle('confirm')}
            autoComplete="new-password"
          />
        </div>

        {fieldError && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {fieldError}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={saving || !form.currentPassword || !form.newPassword || !form.confirmPassword}
            className="btn-primary justify-center"
          >
            <KeyRound size={15} />
            {saving ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Teacher Assignments (read-only) ──────────────────────────
function TeacherAssignmentsCard() {
  const { user, activeAssignments } = useAuth()
  const sy = user?.active_school_year
  const rows = activeAssignments || []

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <GraduationCap size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">My Teaching Assignments</h2>
          <p className="text-xs text-slate-500">
            {sy ? `School Year ${sy}` : 'Active school year'}
            {' · '}
            Managed by administrator
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          You have no assignments for the active school year yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rows.map(a => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700"
            >
              <span className="font-semibold">{a.grade_level}</span>
              <span className="text-slate-400">·</span>
              <span>{a.section}</span>
              <span className="text-slate-400">·</span>
              <span className="text-teal-700">{a.subject}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────
export default function Profile() {
  const { user, updateUser } = useAuth()

  if (!user) return null

  const handleSaved = (updated) => {
    // Backend returns the fresh user row (including full_name); merge it in.
    updateUser({
      surname:     updated.surname,
      first_name:  updated.first_name,
      middle_name: updated.middle_name,
      phone:       updated.phone,
      full_name:   updated.full_name,
    })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">My Profile</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            View and update your account details.
          </p>
        </div>
      </div>

      {/* Account summary */}
      <div className="card p-5 sm:p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-teal-600 text-2xl font-bold">{nameInitial(user)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 truncate">{formatName(user)}</h2>
            <div className="flex items-center flex-wrap gap-2 mt-1.5">
              <span className={clsx(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium border',
                roleStyles[user.role] || 'bg-slate-50 text-slate-700 border-slate-200'
              )}>
                <ShieldCheck size={12} />
                {roleLabels[user.role] || user.role}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Mail size={12} />
                {user.email}
              </span>
              {user.phone && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Phone size={12} />
                  {user.phone}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <Calendar size={12} />
                Member since {formatMemberSince(user.created_at)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Editable sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <PersonalInfoForm user={user} onSaved={handleSaved} />
        <ChangePasswordForm />
      </div>

      {/* Role-specific read-only */}
      {user.role === 'teacher' && <TeacherAssignmentsCard />}
    </div>
  )
}

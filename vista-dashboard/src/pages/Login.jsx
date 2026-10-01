import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, LogIn, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import nrysLogo from '../assets/NRYS_logo.png'

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()
  // A finished password reset lands here with the email filled in and a note
  // saying it worked — see pages/AccountAccess.jsx.
  const { state: arrival } = useLocation()
  const [form, setForm]         = useState({ email: arrival?.email || '', password: '' })
  const [show, setShow]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const updateField = (key, value) => {
    setForm(p => ({ ...p, [key]: value }))
    if (errorMsg) setErrorMsg('')
  }

  const handle = async e => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      toast.success(`Welcome back, ${user.full_name.split(' ')[0]}!`)
      navigate('/')
    } catch {
      setErrorMsg('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background layers */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-brand-400/5 via-transparent to-blue-500/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-400/15 rounded-full blur-[120px]" />

      {/* Centered card */}
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/30 border border-slate-100 px-8 py-10 sm:px-10 sm:py-12">
          {/* Branding */}
          <div className="flex flex-col items-center">
            <img
              src={nrysLogo}
              alt="NRYS Logo"
              className="object-contain"
              style={{ width: '120px', height: '120px' }}
            />
            <h1 className="text-slate-900 font-bold text-xl mt-4 text-center">
              Northern Rizal Yorklin School
            </h1>
            <div className="flex items-center gap-3 mt-2">
              <div className="h-px w-8 bg-gradient-to-r from-transparent to-brand-500/50" />
              <span className="text-brand-600 text-sm font-semibold uppercase tracking-[0.3em]">VISTA</span>
              <div className="h-px w-8 bg-gradient-to-l from-transparent to-brand-500/50" />
            </div>
          </div>

          <div className="w-12 h-px mx-auto my-7" />

          {/* Form header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
            <p className="text-slate-500 text-sm mt-1">Sign in to your account to continue</p>
          </div>

          {arrival?.notice && (
            <p className="mb-5 px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-800" role="status">
              {arrival.notice}
            </p>
          )}

          <form onSubmit={handle} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
              <input
                type="email"
                autoComplete="email"
                className="input"
                placeholder="you@school.edu.ph"
                value={form.email}
                onChange={e => updateField('email', e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <Link to="/forgot-password" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="input pr-11"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => updateField('password', e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <p className="text-sm text-red-600 -mt-1" role="alert">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center py-3 text-base mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn size={17} />
                  Sign In
                </span>
              )}
            </button>
          </form>

          {/* Staff accounts are invitations: an admin authorizes the email and
              the staff member chooses their own password here. */}
          <div className="mt-7 flex items-center gap-3 text-xs text-slate-500">
            <span className="flex-1 h-px bg-slate-200" />
            First time here?
            <span className="flex-1 h-px bg-slate-200" />
          </div>
          <Link to="/activate"
            className="mt-4 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border border-brand-200 bg-brand-50 text-brand-700 text-sm font-semibold hover:bg-brand-100 transition-colors">
            <KeyRound size={16} /> Activate your account
          </Link>
        </div>

        <p className="text-slate-500 text-xs text-center mt-6">
          &copy; 2026 VISTA &middot; Northern Rizal Yorklin School
        </p>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, LogIn, BookOpen, Shield, QrCode, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import nrysLogo from '../assets/NRYS_logo.png'

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()
  const [form, setForm]       = useState({ email: '', password: '' })
  const [show, setShow]       = useState(false)
  const [loading, setLoading] = useState(false)

  const handle = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      toast.success(`Welcome back, ${user.full_name.split(' ')[0]}!`)
      navigate('/')
    } catch {
      toast.error('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    { icon: BookOpen, label: 'AI Predictions', desc: 'Smart grade forecasting' },
    { icon: Shield, label: 'Risk Detection', desc: 'Early warning system' },
    { icon: QrCode, label: 'SecurePass QR', desc: 'Safe dismissal tracking' },
    { icon: Users, label: 'Parent Connect', desc: 'Guardian portal access' },
  ]

  return (
    <div className="min-h-screen bg-navy-950 flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col w-[46%] relative overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }}
        />
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-teal-500/5 via-transparent to-blue-500/5" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-teal-500/8 rounded-full blur-[100px]" />

        {/* Content */}
        <div className="relative flex flex-col items-center justify-center flex-1 px-12 py-16">
          {/* School seal */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-teal-400/20 blur-2xl scale-110" />
            <div className="relative p-2 rounded-full bg-gradient-to-b from-white/15 to-white/5 border border-white/10">
              <img src={nrysLogo} alt="NRYS Logo" className="w-32 h-32 rounded-full object-cover" />
            </div>
          </div>

          {/* School identity */}
          <div className="text-center mt-7 space-y-2">
            <h1 className="text-white font-bold text-2xl tracking-wide">Northern Rizal Yorklin School</h1>
            <div className="flex items-center justify-center gap-3">
              <div className="h-px w-10 bg-gradient-to-r from-transparent to-teal-400/60" />
              <span className="text-teal-400 text-xs font-semibold uppercase tracking-[0.25em]">VISTA Student Monitor</span>
              <div className="h-px w-10 bg-gradient-to-l from-transparent to-teal-400/60" />
            </div>
          </div>

          {/* Motto */}
          <p className="text-slate-400 text-sm text-center mt-6 max-w-xs leading-relaxed">
            Knowledge &middot; Benevolence &middot; Courage
          </p>

          {/* Divider */}
          <div className="w-16 h-px bg-white/10 mt-8 mb-8" />

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
            {features.map(f => (
              <div key={f.label} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <f.icon size={15} className="text-teal-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium leading-tight">{f.label}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative px-12 py-5 border-t border-white/[0.06]">
          <p className="text-slate-600 text-xs text-center">
            &copy; 2026 VISTA &middot; Northern Rizal Yorklin School
          </p>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-slate-50">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-10">
            <div className="p-1.5 rounded-full bg-white border border-slate-200 shadow-md shadow-slate-200/50">
              <img src={nrysLogo} alt="NRYS Logo" className="rounded-full object-cover" style={{ width: '80px', height: '80px' }} />
            </div>
            <h2 className="text-slate-900 font-bold text-lg mt-3">Northern Rizal Yorklin School</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="h-px w-5 bg-teal-500/40" />
              <span className="text-teal-600 text-[11px] font-semibold uppercase tracking-[0.15em]">VISTA Student Monitor</span>
              <div className="h-px w-5 bg-teal-500/40" />
            </div>
          </div>

          {/* Form header */}
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
            <p className="text-slate-500 text-sm mt-1">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handle} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="you@school.edu.ph"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

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

          <p className="mt-8 text-center text-xs text-slate-400">
            Contact your school administrator to reset your password.
          </p>
        </div>
      </div>
    </div>
  )
}

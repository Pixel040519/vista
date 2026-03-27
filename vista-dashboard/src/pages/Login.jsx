import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { GraduationCap, Eye, EyeOff, LogIn } from 'lucide-react'
import toast from 'react-hot-toast'

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

  return (
    <div className="min-h-screen bg-navy-950 flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-[44%] p-12 relative overflow-hidden">
        {/* Background grid pattern */}
        <div className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)',
            backgroundSize: '32px 32px'
          }}
        />
        {/* Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/40">
            <GraduationCap size={22} className="text-white" />
          </div>
          <div>
            <span className="text-white font-bold text-xl tracking-wide">VISTA</span>
          </div>
        </div>

        <div className="relative space-y-6">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold text-white leading-tight" style={{ fontFamily: 'DM Serif Display, serif' }}>
              Empowering<br />
              <span className="text-teal-400">Educators.</span><br />
              Protecting<br />
              <span className="text-teal-400">Students.</span>
            </h1>
            <p className="text-slate-400 text-base leading-relaxed max-w-sm">
              AI-driven student monitoring and decision support for Northern Rizal Yorklin School.
            </p>
          </div>

          {/* Feature chips */}
          <div className="flex flex-wrap gap-2">
            {['AI Predictions', 'Risk Detection', 'SecurePass QR', 'Parent Connect'].map(f => (
              <span key={f} className="px-3 py-1.5 rounded-full bg-white/8 border border-white/10 text-white/70 text-xs font-medium">
                {f}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-slate-600 text-xs">
          © 2025 VISTA · Northern Rizal Yorklin School
        </p>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-slate-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center">
              <GraduationCap size={22} className="text-white" />
            </div>
            <span className="text-slate-900 font-bold text-xl">VISTA</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Sign in to your account</h2>
            <p className="text-slate-500 text-sm mt-1">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handle} className="space-y-4">
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
              className="w-full btn-primary justify-center py-3 text-base mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
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

          <p className="mt-6 text-center text-xs text-slate-400">
            Contact your school administrator to reset your password.
          </p>
        </div>
      </div>
    </div>
  )
}
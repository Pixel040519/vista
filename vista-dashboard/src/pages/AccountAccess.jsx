import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, Lock, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { authApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import PasswordChecklist from '../components/PasswordChecklist'
import { isStrongPassword } from '../utils/passwordPolicy'

// The two "prove you hold this email" flows on the dashboard's sign-in page:
//
//   /activate         — a teacher or admin someone invited, choosing their
//                       first password. Ends signed in.
//   /forgot-password  — anyone with an active account choosing a new one.
//                       Ends back at the sign-in page, deliberately: signing
//                       in with the new password is the last proof the reset
//                       landed where it was meant to.
//
// Both are the same three beats — email, 6-digit code, password — over the
// same unauthenticated endpoints the VISTA Parent app uses. Those endpoints
// answer every email identically so they cannot be used to learn who has an
// account, which is why the code step says "if this email has been invited"
// rather than "we sent a code": this page does not know either.

const CODE_LENGTH = 6
const errorOf = (err) => err?.response?.data?.error || 'Something went wrong. Please try again.'

const COPY = {
  activate: {
    icon: KeyRound,
    title: 'Activate your account',
    intro: "Enter the email address your school registered for you. We'll send a 6-digit code to it.",
    sent: (email) => <>If <b className="text-slate-800">{email}</b> has been invited, a 6-digit code is on its way. Check your spam folder too.</>,
    help: "The code works for 10 minutes. Not invited yet? Ask your school's administrator.",
    passwordTitle: 'Create your password',
    passwordIntro: (email) => <>You'll use this password with <b className="text-slate-800">{email}</b> to sign in to VISTA.</>,
    submit: 'Activate and sign in',
  },
  reset: {
    icon: Lock,
    title: 'Reset your password',
    intro: "Enter the email you sign in with. We'll send a 6-digit code to it.",
    sent: (email) => <>If <b className="text-slate-800">{email}</b> has a VISTA account, a 6-digit code is on its way. Check your spam folder too.</>,
    help: 'The code works for 10 minutes.',
    passwordTitle: 'Choose a new password',
    passwordIntro: (email) => <>This replaces the password for <b className="text-slate-800">{email}</b>.</>,
    submit: 'Save new password',
  },
}

export default function AccountAccess({ mode }) {
  const copy = COPY[mode]
  const navigate = useNavigate()
  const { startSession } = useAuth()

  const [step, setStep]       = useState('email')   // 'email' | 'code' | 'password' | 'parent-done'
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [token, setToken]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [notice, setNotice]   = useState('')

  const request = mode === 'activate' ? authApi.requestActivation : authApi.requestReset
  const verify  = mode === 'activate' ? authApi.verifyActivation  : authApi.verifyReset

  const run = async (fn) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn() } catch (err) { setError(errorOf(err)) } finally { setBusy(false) }
  }

  const sendCode = (e) => {
    e?.preventDefault()
    return run(async () => {
      await request(email.trim())
      setCode('')
      setStep('code')
    })
  }

  const resend = () => run(async () => {
    await request(email.trim())
    setCode('')
    setNotice('A new code is on its way. Any earlier code no longer works.')
  })

  const checkCode = (e) => {
    e.preventDefault()
    return run(async () => {
      const res = await verify(email.trim(), code)
      setToken(res.data.activation_token || res.data.reset_token)
      setStep('password')
    })
  }

  const savePassword = (password) => run(async () => {
    if (mode === 'reset') {
      await authApi.completeReset(token, password)
      navigate('/login', {
        replace: true,
        state: { email: email.trim(), notice: 'Your password has been changed. Sign in with your new password.' },
      })
      return
    }
    const res = await authApi.completeActivation(token, password)
    // A parent who wandered onto the dashboard has a working account now, but
    // the dashboard is not theirs — send them to the app instead of signing
    // them into a staff tool with nothing in it for them.
    if (res.data.user?.role === 'parent') { setStep('parent-done'); return }
    const user = startSession(res.data)
    toast.success(`Welcome to VISTA, ${user.first_name}!`)
    navigate('/', { replace: true })
  })

  const Icon = copy.icon

  return (
    <Shell>
      {step === 'email' && (
        <form onSubmit={sendCode} className="space-y-5">
          <BackLink to="/login">Back to sign in</BackLink>
          <Heading icon={Icon} title={copy.title}>{copy.intro}</Heading>
          <div>
            <label htmlFor="acc-email" className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
            <input id="acc-email" type="email" autoComplete="email" className="input" autoFocus required
              placeholder="you@school.edu.ph" value={email}
              onChange={e => { setEmail(e.target.value); setError('') }} />
          </div>
          <ErrorLine text={error} />
          <SubmitButton busy={busy} label="Send code" busyLabel="Sending…" />
          <p className="text-xs text-slate-500 text-center leading-relaxed">{copy.help}</p>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={checkCode} className="space-y-5">
          <BackButton onClick={() => { setStep('email'); setError(''); setNotice('') }}>Use a different email</BackButton>
          <Heading icon={Mail} title="Check your email">{copy.sent(email.trim())}</Heading>
          <fieldset>
            <legend className="block text-sm font-medium text-slate-700 mb-2">6-digit code</legend>
            <CodeInput value={code} onChange={(v) => { setCode(v); setError('') }} />
          </fieldset>
          <ErrorLine text={error} />
          {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}
          <SubmitButton busy={busy} disabled={code.length !== CODE_LENGTH} label="Verify code" busyLabel="Checking…" />
          <p className="text-sm text-slate-500 text-center">
            Didn't get it?{' '}
            <button type="button" onClick={resend} disabled={busy}
              className="font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50">
              Send a new code
            </button>
          </p>
        </form>
      )}

      {step === 'password' && (
        <PasswordStep copy={copy} email={email.trim()} busy={busy} error={error}
          onClearError={() => setError('')} onSubmit={savePassword} />
      )}

      {step === 'parent-done' && (
        <div className="space-y-5 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 text-emerald-600 grid place-items-center">
            <CheckCircle2 size={28} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your account is active</h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Sign in to the <b className="text-slate-800">VISTA Parent app</b> with {email.trim()} and the
              password you just chose. This website is for school staff.
            </p>
          </div>
          <Link to="/login" className="btn-secondary w-full justify-center">Back to sign in</Link>
        </div>
      )}
    </Shell>
  )
}

/* ── Password ─────────────────────────────────────────────────────────── */
function PasswordStep({ copy, email, busy, error, onClearError, onSubmit }) {
  const [pw, setPw]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow]   = useState(false)

  const ready = isStrongPassword(pw) && pw === confirm

  const submit = (e) => { e.preventDefault(); if (ready) onSubmit(pw) }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Heading icon={Lock} tone="emerald" title={copy.passwordTitle}>{copy.passwordIntro(email)}</Heading>
      <div>
        <label htmlFor="acc-pw" className="block text-sm font-medium text-slate-700 mb-1.5">New password</label>
        <div className="relative">
          <input id="acc-pw" type={show ? 'text' : 'password'} autoComplete="new-password" className="input pr-11"
            autoFocus value={pw} onChange={e => { setPw(e.target.value); onClearError() }} />
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div>
        <label htmlFor="acc-pw2" className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
        <input id="acc-pw2" type={show ? 'text' : 'password'} autoComplete="new-password" className="input"
          value={confirm} onChange={e => { setConfirm(e.target.value); onClearError() }} />
      </div>
      <PasswordChecklist password={pw} confirm={confirm} />
      <ErrorLine text={error} />
      <SubmitButton busy={busy} disabled={!ready} label={copy.submit} busyLabel="Saving…" />
    </form>
  )
}

/* ── Six boxes, one value ─────────────────────────────────────────────────
 * Typing advances, Backspace on an empty box steps back, and pasting a whole
 * code fills every box — the way most people move a code out of an email.
 */
function CodeInput({ value, onChange }) {
  const refs = useRef([])
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] || '')

  useEffect(() => { refs.current[0]?.focus() }, [])

  const setAt = (i, d) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').slice(0, CODE_LENGTH))
  }

  const onInput = (i, raw) => {
    const only = raw.replace(/\D/g, '')
    if (!only) { setAt(i, ''); return }
    if (only.length > 1) {                       // typed over, or autofilled
      const next = (digits.slice(0, i).join('') + only).slice(0, CODE_LENGTH)
      onChange(next)
      refs.current[Math.min(next.length, CODE_LENGTH - 1)]?.focus()
      return
    }
    setAt(i, only)
    if (i < CODE_LENGTH - 1) refs.current[i + 1]?.focus()
  }

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault()
      setAt(i - 1, '')
      refs.current[i - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus()
  }

  const onPaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (!pasted) return
    e.preventDefault()
    onChange(pasted)
    refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus()
  }

  return (
    <div className="grid grid-cols-6 gap-2" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input key={i} ref={el => { refs.current[i] = el }}
          inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`} maxLength={CODE_LENGTH}
          value={d} onChange={e => onInput(i, e.target.value)} onKeyDown={e => onKeyDown(i, e)}
          onFocus={e => e.target.select()}
          className="w-full h-12 sm:h-14 text-center text-xl font-bold text-slate-900 bg-white border border-slate-200 rounded-xl
                     focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all" />
      ))}
    </div>
  )
}

/* ── Pieces shared by every step ─────────────────────────────────────── */
function Shell({ children }) {
  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)', backgroundSize: '40px 40px' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-400/15 rounded-full blur-[120px]" />
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/30 border border-slate-100 px-8 py-9 sm:px-10 sm:py-10">
          {children}
        </div>
        <p className="text-slate-500 text-xs text-center mt-6">
          &copy; 2026 VISTA &middot; Northern Rizal Yorklin School
        </p>
      </div>
    </div>
  )
}

function Heading({ icon: Icon, title, tone = 'brand', children }) {
  return (
    <div>
      <div className={clsx('w-12 h-12 rounded-2xl grid place-items-center mb-4',
        tone === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600')}>
        <Icon size={22} />
      </div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{children}</p>
    </div>
  )
}

function BackLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700">
      <ArrowLeft size={15} /> {children}
    </Link>
  )
}

function BackButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700">
      <ArrowLeft size={15} /> {children}
    </button>
  )
}

function ErrorLine({ text }) {
  if (!text) return null
  return <p className="text-sm text-red-600" role="alert">{text}</p>
}

function SubmitButton({ busy, disabled, label, busyLabel }) {
  return (
    <button type="submit" disabled={busy || disabled}
      className="w-full btn-primary justify-center py-3 text-base disabled:opacity-60 disabled:cursor-not-allowed">
      {busy ? (
        <span className="flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          {busyLabel}
        </span>
      ) : label}
    </button>
  )
}

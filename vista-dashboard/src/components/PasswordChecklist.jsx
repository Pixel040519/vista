import { Check } from 'lucide-react'
import clsx from 'clsx'
import { passwordChecks, isPasswordTooLong, MAX_PASSWORD_BYTES } from '../utils/passwordPolicy'

// The strength rules ticked off live as a password is typed, shared by every
// form that sets one (activation, reset, Profile) so they cannot drift. Pass
// `confirm` to add the "both match" line; leave it out where there is no
// confirmation field. `twoColumn` splits the list on wider forms (Profile);
// the sign-in card is too narrow for it.
export default function PasswordChecklist({ password, confirm, twoColumn = false, className }) {
  const rows = passwordChecks(password)
  if (confirm !== undefined) {
    rows.push({ id: 'match', label: 'Both passwords match', ok: password.length > 0 && password === confirm })
  }

  return (
    <div className={className}>
      <ul className={clsx('grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm', twoColumn && 'sm:grid-cols-2')}
        aria-label="Password requirements">
        {rows.map(r => (
          <li key={r.id} className={clsx('flex items-center gap-2', r.ok ? 'text-emerald-700' : 'text-slate-500')}>
            <span className={clsx('w-4 h-4 shrink-0 rounded-full grid place-items-center', r.ok ? 'bg-emerald-100' : 'bg-slate-100')}>
              {r.ok && <Check size={11} strokeWidth={3} />}
            </span>
            {r.label}
            <span className="sr-only">{r.ok ? '(met)' : '(not met)'}</span>
          </li>
        ))}
      </ul>
      {isPasswordTooLong(password) && (
        <p className="text-sm text-red-600 mt-2" role="alert">
          That password is too long. Keep it to {MAX_PASSWORD_BYTES} characters or fewer.
        </p>
      )}
    </div>
  )
}

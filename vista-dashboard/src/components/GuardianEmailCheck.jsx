import { useCallback, useRef, useState } from 'react'
import { studentApi } from '../api/client'

// The early check on a guardian's email, shared by Manage Guardians and the Add
// Student wizard. When the email already belongs to a parent account the field
// turns red, the save is held, and the only ways on are to clear the email or to
// link that account. The message names no one.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase()
// The answer depends on the email alone, so only a change to the email makes it stale.
const keyOf = ({ email }) => norm(email)

export function useGuardianEmailCheck(studentId) {
  const [result, setResult] = useState(null) // { key, status, account? }
  const seq = useRef(0)

  // Call on blur of the email, surname or first name, with the values as they stand.
  const check = useCallback(async (fields) => {
    const email = String(fields.email || '').trim()
    const n = ++seq.current
    if (!EMAIL_RE.test(email)) { setResult(null); return }
    try {
      const res = await studentApi.checkGuardianEmail({
        email, surname: fields.surname || '', first_name: fields.first_name || '',
        ...(studentId ? { student_id: studentId } : {}),
      })
      if (n === seq.current) setResult({ key: keyOf(fields), ...res.data })
    } catch {
      if (n === seq.current) setResult(null)
    }
  }, [studentId])

  // Only an answer for the email still on screen counts.
  const current = (fields) =>
    result && result.status !== 'available' && result.key === keyOf(fields) ? result : null

  const reset = useCallback(() => { seq.current++; setResult(null) }, [])

  return { check, current, reset }
}

/**
 * What to show on the email field for a check result, or null for nothing.
 *
 * Every flagged situation is a refusal: the field turns red and the save is
 * held. Only one of them can be resolved without retyping the address — an
 * email that has a parent account, where `account` is offered as a button. The
 * rest (that account already looks after this learner, another guardian of this
 * learner holds the address, or a guardian elsewhere holds it under another
 * name) leave clearing the email as the only way on. No message names anyone.
 */
export const PARENT_ACCOUNT_EMAIL_MESSAGE = 'This email already has a parent account.'
export const DUPLICATE_ON_LEARNER_MESSAGE = 'Another guardian of this learner already uses this email.'

export function describeEmailCheck(result) {
  if (!result) return null
  if (result.status === 'parent_account') {
    return { invalid: true, message: PARENT_ACCOUNT_EMAIL_MESSAGE, account: result.account }
  }
  if (result.status === 'already_guardian') {
    return { invalid: true, message: PARENT_ACCOUNT_EMAIL_MESSAGE }
  }
  if (result.status === 'duplicate_on_learner') {
    return { invalid: true, message: DUPLICATE_ON_LEARNER_MESSAGE }
  }
  if (result.status === 'name_conflict') {
    return { invalid: true, message: 'This email is already used by a guardian with a different name. Check the email.' }
  }
  return null
}

// Mirror of vista-backend/node-api/src/utils/passwordPolicy.js (the
// utils/roles.js convention). The API is what refuses a weak password; this
// copy only drives the checklist, so a rule changed on one side must be changed
// on the other, or the form will offer a password the API then rejects.
// The Flutter app carries a third copy in packages/vista_api.

export const MIN_PASSWORD_LENGTH = 8

// bcrypt reads only the first 72 bytes, so a longer password would be accepted
// and then only partly checked at sign-in. Bytes, not characters: "ñ" is two.
export const MAX_PASSWORD_BYTES = 72

export const PASSWORD_RULES = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, need: `at least ${MIN_PASSWORD_LENGTH} characters`, test: (pw) => [...pw].length >= MIN_PASSWORD_LENGTH },
  { id: 'upper',  label: 'An uppercase letter',                          need: 'an uppercase letter',                       test: (pw) => /\p{Lu}/u.test(pw) },
  { id: 'lower',  label: 'A lowercase letter',                           need: 'a lowercase letter',                        test: (pw) => /\p{Ll}/u.test(pw) },
  { id: 'number', label: 'A number',                                     need: 'a number',                                  test: (pw) => /[0-9]/.test(pw) },
  { id: 'symbol', label: 'A symbol, such as ! @ # $ %',                  need: 'a symbol such as ! @ # $ %',                test: (pw) => /[^\p{L}\p{N}\s]/u.test(pw) },
]

const utf8Length = (s) => new TextEncoder().encode(s).length

export const passwordChecks = (password = '') =>
  PASSWORD_RULES.map(({ id, label, test }) => ({ id, label, ok: test(password) }))

export const isPasswordTooLong = (password = '') => utf8Length(password) > MAX_PASSWORD_BYTES

const joinNeeds = (needs) =>
  needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`

export const passwordError = (password = '') => {
  if (isPasswordTooLong(password)) {
    return `That password is too long. Keep it to ${MAX_PASSWORD_BYTES} characters or fewer.`
  }
  const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.need)
  return missing.length ? `Your password needs ${joinNeeds(missing)}.` : null
}

export const isStrongPassword = (password) => passwordError(password) === null

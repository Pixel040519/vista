/**
 * The strength rule for every password a person chooses: activation, password
 * reset, a change from Profile, and the bootstrap /auth/register.
 *
 * Canonical here, mirrored in `vista-dashboard/src/utils/passwordPolicy.js` and
 * `vista-mobile/packages/vista_api/lib/src/password_policy.dart` (the
 * `utils/roles.js` convention). The clients only render the checklist; this
 * module is what actually refuses a weak password, so a change to a rule here
 * has to be made in both mirrors or a form will offer a password the API
 * then rejects.
 *
 * It governs *choosing* a password, never signing in: an account whose
 * password predates the rule still signs in with it, and meets the rule the
 * next time it is changed.
 *
 * Letters are matched as Unicode letters, so "Ñ" and "ñ" count as upper- and
 * lowercase; a symbol is anything that is not a letter, a digit or whitespace.
 */

const MIN_PASSWORD_LENGTH = 8

// bcrypt reads only the first 72 bytes and silently ignores the rest, so a
// longer password would be accepted and then only partly checked at sign-in.
// Bytes, not characters: "ñ" is two.
const MAX_PASSWORD_BYTES = 72

// `need` completes "Your password needs …", so the server can name exactly
// what is missing rather than reciting the whole rule.
const PASSWORD_RULES = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, need: `at least ${MIN_PASSWORD_LENGTH} characters`, test: (pw) => [...pw].length >= MIN_PASSWORD_LENGTH },
  { id: 'upper',  label: 'An uppercase letter',                          need: 'an uppercase letter',                       test: (pw) => /\p{Lu}/u.test(pw) },
  { id: 'lower',  label: 'A lowercase letter',                           need: 'a lowercase letter',                        test: (pw) => /\p{Ll}/u.test(pw) },
  { id: 'number', label: 'A number',                                     need: 'a number',                                  test: (pw) => /[0-9]/.test(pw) },
  { id: 'symbol', label: 'A symbol, such as ! @ # $ %',                  need: 'a symbol such as ! @ # $ %',                test: (pw) => /[^\p{L}\p{N}\s]/u.test(pw) },
]

const utf8Length = (s) => new TextEncoder().encode(s).length

/** Every rule with whether `password` meets it — what the checklists render. */
const passwordChecks = (password = '') =>
  PASSWORD_RULES.map(({ id, label, test }) => ({ id, label, ok: test(password) }))

const joinNeeds = (needs) =>
  needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`

/** null when `password` is acceptable, otherwise one sentence saying why not. */
const passwordError = (password = '') => {
  if (utf8Length(password) > MAX_PASSWORD_BYTES) {
    return `That password is too long. Keep it to ${MAX_PASSWORD_BYTES} characters or fewer.`
  }
  const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.need)
  return missing.length ? `Your password needs ${joinNeeds(missing)}.` : null
}

const isStrongPassword = (password) => passwordError(password) === null

/**
 * The Joi schema for a newly chosen password. Every route that sets one uses
 * this, so the rule cannot be weaker on one of them.
 */
const strongPassword = (Joi) =>
  Joi.string().required()
    .custom((value, helpers) => {
      const problem = passwordError(value)
      return problem ? helpers.message(problem) : value
    })
    .messages({
      'any.required': 'Choose a password.',
      'string.empty': 'Choose a password.',
    })

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  PASSWORD_RULES,
  passwordChecks,
  passwordError,
  isStrongPassword,
  strongPassword,
}

import 'dart:convert';

/// Mirror of `vista-backend/node-api/src/utils/passwordPolicy.js` (the
/// `utils/roles.js` convention). The API is what refuses a weak password; this
/// copy only drives the checklist, so a rule changed on one side must be changed
/// on the other, or the app will offer a password the API then rejects.
class PasswordPolicy {
  PasswordPolicy._();

  static const minLength = 8;

  /// bcrypt reads only the first 72 bytes, so a longer password would be
  /// accepted and then only partly checked at sign-in. Bytes, not characters:
  /// "ñ" is two.
  static const maxBytes = 72;

  static final List<PasswordRule> rules = [
    PasswordRule('length', 'At least $minLength characters', 'at least $minLength characters',
        (pw) => pw.runes.length >= minLength),
    PasswordRule('upper', 'An uppercase letter', 'an uppercase letter',
        (pw) => RegExp(r'\p{Lu}', unicode: true).hasMatch(pw)),
    PasswordRule('lower', 'A lowercase letter', 'a lowercase letter',
        (pw) => RegExp(r'\p{Ll}', unicode: true).hasMatch(pw)),
    PasswordRule('number', 'A number', 'a number', (pw) => RegExp(r'[0-9]').hasMatch(pw)),
    PasswordRule('symbol', 'A symbol, such as ! @ # \$ %', 'a symbol such as ! @ # \$ %',
        (pw) => RegExp(r'[^\p{L}\p{N}\s]', unicode: true).hasMatch(pw)),
  ];

  static bool isTooLong(String password) => utf8.encode(password).length > maxBytes;

  /// null when [password] is acceptable, otherwise one sentence saying why not.
  static String? error(String password) {
    if (isTooLong(password)) {
      return 'That password is too long. Keep it to $maxBytes characters or fewer.';
    }
    final missing = rules.where((r) => !r.test(password)).map((r) => r.need).toList();
    if (missing.isEmpty) return null;
    final joined = missing.length == 1
        ? missing.first
        : '${missing.sublist(0, missing.length - 1).join(', ')} and ${missing.last}';
    return 'Your password needs $joined.';
  }

  static bool isStrong(String password) => error(password) == null;
}

class PasswordRule {
  const PasswordRule(this.id, this.label, this.need, this.test);

  final String id;

  /// Checklist wording.
  final String label;

  /// Completes "Your password needs …".
  final String need;

  final bool Function(String password) test;
}

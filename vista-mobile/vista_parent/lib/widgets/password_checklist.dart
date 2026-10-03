import 'package:flutter/material.dart';
import 'package:vista_api/vista_api.dart';

import '../theme.dart';

/// The strength rules ticked off live as a password is typed, shared by the
/// activation/reset screen and Edit Profile so the two cannot drift. Pass
/// [confirm] to add the "both match" line. The parent must rebuild this as the
/// fields change (a `setState` in `onChanged`).
class PasswordChecklist extends StatelessWidget {
  const PasswordChecklist({super.key, required this.password, this.confirm});

  final String password;
  final String? confirm;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, bool)>[
      for (final r in PasswordPolicy.rules) (r.label, r.test(password)),
      if (confirm != null) ('Both passwords match', password.isNotEmpty && password == confirm),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (label, ok) in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                Icon(
                  ok ? Icons.check_circle : Icons.radio_button_unchecked,
                  size: 16,
                  color: ok ? VistaColors.success : Colors.black26,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(fontSize: 12.5, color: ok ? VistaColors.success : Colors.black54),
                  ),
                ),
              ],
            ),
          ),
        if (PasswordPolicy.isTooLong(password))
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'That password is too long. Keep it to ${PasswordPolicy.maxBytes} characters or fewer.',
              style: TextStyle(fontSize: 12.5, color: VistaColors.danger),
            ),
          ),
      ],
    );
  }
}

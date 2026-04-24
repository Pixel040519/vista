import 'package:flutter/material.dart';

import '../theme.dart';

/// Shown in place of Academics content when the school has suspended the
/// child's academic view (HTTP 423). Only the Academics tab is gated — the
/// rest of the app stays fully accessible.
class LockedScreen extends StatelessWidget {
  const LockedScreen({super.key, this.reason});
  final String? reason;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 64, color: VistaColors.warn),
            const SizedBox(height: 12),
            const Text(
              'Academic access suspended',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              reason?.isNotEmpty == true
                  ? reason!
                  : 'Please contact the school office for details.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }
}

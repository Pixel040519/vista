import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../settings.dart';
import '../theme.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
            'You will need to sign in again to scan QR codes.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: VistaColors.danger),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    await ref.read(authRepositoryProvider).logout();
    ref.read(lockedProvider.notifier).state = false;
    ref.read(gateConfirmedProvider.notifier).state = false;
    ref.invalidate(sessionProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gate = ref.watch(gateSettingProvider);
    final session = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
            child: Text('Gate',
                style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: VistaColors.navy950)),
          ),
          for (final option in gateOptions)
            RadioListTile<String>(
              title: Text(option,
                  style: const TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w600)),
              value: option,
              groupValue: gate,
              onChanged: (v) {
                if (v != null) ref.read(gateSettingProvider.notifier).set(v);
              },
            ),
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 8, 20, 20),
            child: Text(
              'Shown on the Scan result screen so the audit log reflects which entrance handled the pickup.',
              style: TextStyle(color: Colors.black54, fontSize: 13),
            ),
          ),
          const Divider(height: 1),
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
            child: Text('Account',
                style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: VistaColors.navy950)),
          ),
          ListTile(
            leading: const Icon(Icons.account_circle_outlined),
            title: Text(
              session.valueOrNull?.email ?? 'Signed in',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: const Text('Security guard'),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            child: OutlinedButton.icon(
              icon: const Icon(Icons.logout, color: VistaColors.danger),
              label: const Text('Sign out',
                  style: TextStyle(
                      color: VistaColors.danger, fontWeight: FontWeight.w700)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: VistaColors.danger),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: () => _confirmSignOut(context, ref),
            ),
          ),
        ],
      ),
    );
  }
}

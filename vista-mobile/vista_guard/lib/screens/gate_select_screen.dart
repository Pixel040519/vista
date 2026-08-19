import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../settings.dart';
import '../theme.dart';

/// Forces the guard to actively pick their gate before the camera opens.
/// Shown after every sign-in (and cold launch with stored session) so a new
/// shift cannot inherit yesterday's gate label without realising it.
class GateSelectScreen extends ConsumerStatefulWidget {
  const GateSelectScreen({super.key});

  @override
  ConsumerState<GateSelectScreen> createState() => _GateSelectScreenState();
}

class _GateSelectScreenState extends ConsumerState<GateSelectScreen> {
  String? _selected;

  @override
  Widget build(BuildContext context) {
    final persisted = ref.watch(gateSettingProvider);
    final selected = _selected ?? persisted;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.door_front_door_outlined,
                  size: 56, color: VistaColors.brand),
              const SizedBox(height: 16),
              const Text(
                'Select your gate',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: VistaColors.navy950,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Tag every dismissal scan with the entrance you are stationed at. You can change this later in Settings.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.black54, fontSize: 14),
              ),
              const SizedBox(height: 32),
              for (final option in gateOptions) ...[
                _GateTile(
                  label: option,
                  selected: selected == option,
                  onTap: () => setState(() => _selected = option),
                ),
                const SizedBox(height: 12),
              ],
              const Spacer(),
              FilledButton(
                onPressed: () async {
                  await ref.read(gateSettingProvider.notifier).set(selected);
                  ref.read(gateConfirmedProvider.notifier).state = true;
                },
                child: const Text('Continue'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GateTile extends StatelessWidget {
  const _GateTile({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
        decoration: BoxDecoration(
          color: selected
              ? VistaColors.brand.withOpacity(0.08)
              : Colors.white,
          border: Border.all(
            color: selected ? VistaColors.brand : const Color(0xFFDDE2EC),
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              color: selected ? VistaColors.brand : Colors.black38,
            ),
            const SizedBox(width: 14),
            Text(
              label,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: selected ? VistaColors.brand : VistaColors.navy950,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

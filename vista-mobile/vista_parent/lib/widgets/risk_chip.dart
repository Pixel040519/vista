import 'package:flutter/material.dart';

import '../theme.dart';

/// Colored chip for Stable/Moderate/High risk tiers. Mirrors the web
/// dashboard's Risk Overview card so parents see the same language admins do.
class RiskChip extends StatelessWidget {
  const RiskChip(this.tier, {super.key});
  final String? tier;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _tierColors(tier);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        tier ?? 'Unknown',
        style: TextStyle(
            color: fg, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }

  static (Color, Color) _tierColors(String? tier) {
    switch (tier) {
      case 'Stable':
        return (const Color(0xFFE6F4EA), VistaColors.success);
      case 'Moderate':
        return (const Color(0xFFFFF4E5), VistaColors.warn);
      case 'High':
        return (const Color(0xFFFDECEA), VistaColors.danger);
      default:
        return (const Color(0xFFEEF1F7), Colors.black54);
    }
  }
}

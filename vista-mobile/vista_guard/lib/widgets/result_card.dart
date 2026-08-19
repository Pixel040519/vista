import 'package:flutter/material.dart';
import 'package:vista_api/vista_api.dart';

import '../theme.dart';

enum ResultTone { success, failure, queued }

class ResultCard extends StatelessWidget {
  const ResultCard._({
    required this.tone,
    required this.title,
    required this.subtitle,
  });

  factory ResultCard.success(DismissalVerifyResult r) => ResultCard._(
        tone: ResultTone.success,
        title: r.student,
        subtitle: 'Released to ${r.authorizedGuardian}',
      );

  factory ResultCard.failure(String message) => ResultCard._(
        tone: ResultTone.failure,
        title: 'Not authorized',
        subtitle: message,
      );

  factory ResultCard.queued() => const ResultCard._(
        tone: ResultTone.queued,
        title: 'Queued offline',
        subtitle:
            'Will sync when the network returns. Do NOT release the student.',
      );

  final ResultTone tone;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final (icon, iconColor) = switch (tone) {
      ResultTone.success => (Icons.check_circle_outline, VistaColors.success),
      ResultTone.failure => (Icons.cancel_outlined, VistaColors.danger),
      ResultTone.queued => (Icons.cloud_off_outlined, VistaColors.warn),
    };
    return Container(
      margin: const EdgeInsets.all(32),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
              color: iconColor.withOpacity(0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 52, color: iconColor),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: VistaColors.navy950,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.black54, fontSize: 14),
          ),
        ],
      ),
    );
  }
}

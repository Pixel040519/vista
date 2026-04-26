import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:vista_api/vista_api.dart';

import '../offline_queue.dart';
import '../providers.dart';
import '../settings.dart';
import '../theme.dart';
import '../widgets/result_card.dart';

/// Confirmation step shown after the guard picks a guardian (or the picker is
/// auto-skipped when the QR generator is the only authorized parent). Verify
/// is NOT called until the guard taps Release — Deny pops back to the
/// scanner. Pops with a [ResultCard] for the scanner to flash, or `null` when
/// denied / backed out.
class ScanResultScreen extends ConsumerStatefulWidget {
  const ScanResultScreen({
    super.key,
    required this.qrPayload,
    required this.scan,
    required this.guardian,
  });

  final String qrPayload;
  final DismissalScanResult scan;
  final AuthorizedGuardian guardian;

  @override
  ConsumerState<ScanResultScreen> createState() => _ScanResultScreenState();
}

class _ScanResultScreenState extends ConsumerState<ScanResultScreen> {
  bool _submitting = false;
  String? _error;
  late final DateTime _scannedAt;

  @override
  void initState() {
    super.initState();
    _scannedAt = DateTime.now();
  }

  Future<void> _release() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    final gate = ref.read(gateSettingProvider);
    try {
      final r = await ref.read(guardApiProvider).verify(
            qrPayload: widget.qrPayload,
            authorizedById: widget.guardian.id,
            fetcherType: widget.guardian.kind,
            gateLabel: gate,
          );
      if (!mounted) return;
      Navigator.of(context).pop(ResultCard.success(r));
    } on VistaApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.message;
      });
    } catch (_) {
      await OfflineQueue.instance.enqueue(
        qrPayload: widget.qrPayload,
        authorizedBy: widget.guardian.id,
        fetcherType: widget.guardian.kind,
        gateLabel: gate,
      );
      if (!mounted) return;
      Navigator.of(context).pop(ResultCard.queued());
    }
  }

  void _deny() => Navigator.of(context).pop();

  @override
  Widget build(BuildContext context) {
    final gate = ref.watch(gateSettingProvider);
    final time = DateFormat('h:mm a').format(_scannedAt);
    final scan = widget.scan;
    final relSuffix = (widget.guardian.relationship?.isNotEmpty ?? false)
        ? ' (${widget.guardian.relationship})'
        : '';
    final gradeLine = [
      if ((scan.gradeLevel ?? '').isNotEmpty) scan.gradeLevel!,
      if ((scan.section ?? '').isNotEmpty) scan.section!,
    ].join(' · ');

    return Scaffold(
      appBar: AppBar(title: const Text('Scan result')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  children: [
                    _FetcherAvatar(guardian: widget.guardian),
                    const SizedBox(height: 14),
                    const Text(
                      'Release student',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        color: VistaColors.navy950,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      gradeLine.isEmpty
                          ? scan.studentName
                          : '${scan.studentName} · $gradeLine',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 16,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Guardian: ${widget.guardian.fullName}$relSuffix',
                      textAlign: TextAlign.center,
                      style:
                          const TextStyle(fontSize: 14, color: Colors.black54),
                    ),
                    const SizedBox(height: 18),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF5F7FB),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child:
                          _DetailRow(label: 'Scanned', value: '$time · $gate'),
                    ),
                  ],
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: VistaColors.danger.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                    border:
                        Border.all(color: VistaColors.danger.withOpacity(0.3)),
                  ),
                  child: Text(_error!,
                      style: const TextStyle(color: VistaColors.danger)),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _submitting ? null : _release,
                icon: _submitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check),
                label: const Text('Release'),
                style: FilledButton.styleFrom(
                    backgroundColor: VistaColors.success),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _submitting ? null : _deny,
                icon: const Icon(Icons.block),
                label: const Text('Deny'),
                style:
                    FilledButton.styleFrom(backgroundColor: VistaColors.danger),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Visual confirmation of who is at the gate. Renders the fetcher's uploaded
/// photo as a large circle with a small green check badge so the guard reads
/// "scan passed" at a glance even when the photo dominates the card. Falls
/// back to initials when the parent or authorized person hasn't uploaded a
/// photo yet (legacy admin-generated QRs in particular).
class _FetcherAvatar extends StatelessWidget {
  const _FetcherAvatar({required this.guardian});

  final AuthorizedGuardian guardian;

  @override
  Widget build(BuildContext context) {
    final url = guardian.photoUrl;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        CircleAvatar(
          radius: 56,
          backgroundColor: VistaColors.success.withOpacity(0.12),
          backgroundImage: url != null ? NetworkImage(url) : null,
          child: url == null
              ? Text(
                  _initials(guardian.fullName),
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    color: VistaColors.success,
                  ),
                )
              : null,
        ),
        Positioned(
          bottom: -2,
          right: -2,
          child: Container(
            decoration: BoxDecoration(
              color: VistaColors.success,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 3),
            ),
            padding: const EdgeInsets.all(4),
            child: const Icon(Icons.check, size: 18, color: Colors.white),
          ),
        ),
      ],
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(fontSize: 13, color: Colors.black54),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: Color(0xFF0F172A),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

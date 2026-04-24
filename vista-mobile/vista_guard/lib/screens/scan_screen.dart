import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:vista_api/vista_api.dart';

import '../offline_queue.dart';
import '../providers.dart';
import '../theme.dart';
import 'pin_lock.dart';

class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen>
    with WidgetsBindingObserver {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode],
  );
  bool _processing = false;
  _ResultCard? _result;
  Timer? _resultTimer;
  Timer? _idleTimer;
  int _pendingOffline = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _resetIdleTimer();
    _refreshPending();
  }

  void _resetIdleTimer() {
    _idleTimer?.cancel();
    _idleTimer = Timer(const Duration(minutes: 2), () {
      if (mounted) ref.read(lockedProvider.notifier).state = true;
    });
  }

  Future<void> _refreshPending() async {
    final n = await OfflineQueue.instance.pendingCount();
    if (mounted) setState(() => _pendingOffline = n);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      ref.read(lockedProvider.notifier).state = true;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    _resultTimer?.cancel();
    _idleTimer?.cancel();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture cap) async {
    if (_processing) return;
    final raw = cap.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;

    _resetIdleTimer();
    setState(() => _processing = true);

    // Prompt for the authorized guardian's name (visually confirmed at the gate).
    final authorizedBy = await _askGuardianName();
    if (authorizedBy == null) {
      setState(() => _processing = false);
      return;
    }

    try {
      final result = await ref
          .read(guardApiProvider)
          .verify(qrPayload: raw, authorizedBy: authorizedBy);
      _showResult(_ResultCard.success(result));
    } on VistaApiException catch (e) {
      _showResult(_ResultCard.failure(e.message));
    } catch (_) {
      // Network failure — persist and flash "queued".
      await OfflineQueue.instance.enqueue(
        qrPayload: raw,
        authorizedBy: authorizedBy,
      );
      await _refreshPending();
      _showResult(_ResultCard.queued());
    }
  }

  Future<String?> _askGuardianName() async {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Releasing to'),
        content: TextField(
          controller: c,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Guardian full name'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(c.text.trim()),
              child: const Text('Confirm')),
        ],
      ),
    );
  }

  void _showResult(_ResultCard card) {
    setState(() => _result = card);
    _resultTimer?.cancel();
    _resultTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) {
        setState(() {
          _result = null;
          _processing = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final locked = ref.watch(lockedProvider);
    if (locked) {
      return PinLock(onUnlock: () {
        ref.read(lockedProvider.notifier).state = false;
        _resetIdleTimer();
      });
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan pickup QR'),
        actions: [
          IconButton(
            tooltip: 'Today’s log',
            icon: const Icon(Icons.list_alt),
            onPressed: () => context.push('/log'),
          ),
          IconButton(
            tooltip: 'Lock',
            icon: const Icon(Icons.lock_outline),
            onPressed: () =>
                ref.read(lockedProvider.notifier).state = true,
          ),
        ],
      ),
      body: GestureDetector(
        onTap: _resetIdleTimer,
        behavior: HitTestBehavior.translucent,
        child: Stack(
          fit: StackFit.expand,
          children: [
            MobileScanner(controller: _controller, onDetect: _onDetect),
            if (_result != null)
              Container(
                color: Colors.black54,
                alignment: Alignment.center,
                child: _result!,
              ),
            if (_pendingOffline > 0)
              Positioned(
                top: 16,
                left: 16,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: VistaColors.warn,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$_pendingOffline queued',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard._({
    required this.tone,
    required this.title,
    required this.subtitle,
  });

  factory _ResultCard.success(DismissalVerifyResult r) => _ResultCard._(
        tone: _Tone.success,
        title: r.student,
        subtitle: 'Released to ${r.authorizedGuardian}',
      );

  factory _ResultCard.failure(String message) => _ResultCard._(
        tone: _Tone.failure,
        title: 'Not authorized',
        subtitle: message,
      );

  factory _ResultCard.queued() => const _ResultCard._(
        tone: _Tone.queued,
        title: 'Queued offline',
        subtitle: 'Will sync when the network returns. Do NOT release the student.',
      );

  final _Tone tone;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final (bg, icon, iconColor) = switch (tone) {
      _Tone.success => (Colors.white, Icons.check_circle, VistaColors.success),
      _Tone.failure => (Colors.white, Icons.cancel, VistaColors.danger),
      _Tone.queued => (Colors.white, Icons.cloud_off, VistaColors.warn),
    };
    return Container(
      margin: const EdgeInsets.all(32),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 72, color: iconColor),
          const SizedBox(height: 12),
          Text(title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: VistaColors.navy950)),
          const SizedBox(height: 8),
          Text(subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.black54, fontSize: 16)),
        ],
      ),
    );
  }
}

enum _Tone { success, failure, queued }

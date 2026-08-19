import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:vista_api/vista_api.dart';

import '../offline_queue.dart';
import '../providers.dart';
import '../theme.dart';
import '../widgets/result_card.dart';
import 'pin_lock.dart';
import 'scan_result_screen.dart';

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
  ResultCard? _result;
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

    final DismissalScanResult scan;
    try {
      scan = await ref.read(guardApiProvider).scan(qrPayload: raw);
    } on VistaApiException catch (e) {
      _showResult(ResultCard.failure(e.message));
      return;
    } catch (_) {
      _showResult(ResultCard.failure(
          'Network required to verify guardian. Check connection and retry.'));
      return;
    }

    final guardian = scan.authorizedGuardians.length == 1
        ? scan.authorizedGuardians.first
        : await _pickGuardian(scan);
    if (guardian == null) {
      setState(() => _processing = false);
      return;
    }

    if (!mounted) return;
    final card = await Navigator.of(context).push<ResultCard?>(
      MaterialPageRoute(
        builder: (_) => ScanResultScreen(
          qrPayload: raw,
          scan: scan,
          guardian: guardian,
        ),
      ),
    );
    await _refreshPending();
    if (!mounted) return;
    if (card == null) {
      setState(() => _processing = false);
    } else {
      _showResult(card);
    }
  }

  Future<AuthorizedGuardian?> _pickGuardian(DismissalScanResult scan) async {
    return showDialog<AuthorizedGuardian>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Releasing ${scan.studentName}'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView.separated(
            shrinkWrap: true,
            itemCount: scan.authorizedGuardians.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final g = scan.authorizedGuardians[i];
              return ListTile(
                title: Text(g.fullName,
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: g.relationship != null ? Text(g.relationship!) : null,
                onTap: () => Navigator.of(ctx).pop(g),
              );
            },
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel')),
        ],
      ),
    );
  }

  void _showResult(ResultCard card) {
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
      backgroundColor: VistaColors.scanBg,
      appBar: AppBar(
        title: const Text('Scan pickup QR'),
        actions: [
          IconButton(
            tooltip: 'Today’s log',
            icon: const Icon(Icons.list_alt),
            onPressed: () => context.push('/log'),
          ),
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/settings'),
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
            const _ScanReticle(),
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
            const Positioned(
              left: 0,
              right: 0,
              bottom: 32,
              child: Center(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 32),
                  child: Text(
                    'Point at the code on the parent’s phone',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
            if (_result != null)
              Container(
                color: Colors.black54,
                alignment: Alignment.center,
                child: _result!,
              ),
          ],
        ),
      ),
    );
  }
}

/// 260×260 framing reticle with four 36-px white corner brackets.
class _ScanReticle extends StatelessWidget {
  const _ScanReticle();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: SizedBox(
        width: 260,
        height: 260,
        child: Stack(
          children: [
            Positioned(
              top: 0,
              left: 0,
              child: _Corner(top: true, left: true),
            ),
            Positioned(
              top: 0,
              right: 0,
              child: _Corner(top: true, left: false),
            ),
            Positioned(
              bottom: 0,
              left: 0,
              child: _Corner(top: false, left: true),
            ),
            Positioned(
              bottom: 0,
              right: 0,
              child: _Corner(top: false, left: false),
            ),
          ],
        ),
      ),
    );
  }
}

class _Corner extends StatelessWidget {
  const _Corner({required this.top, required this.left});
  final bool top;
  final bool left;

  @override
  Widget build(BuildContext context) {
    const side = BorderSide(color: Colors.white, width: 4);
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        border: Border(
          top: top ? side : BorderSide.none,
          bottom: top ? BorderSide.none : side,
          left: left ? side : BorderSide.none,
          right: left ? BorderSide.none : side,
        ),
        borderRadius: BorderRadius.only(
          topLeft: top && left ? const Radius.circular(16) : Radius.zero,
          topRight: top && !left ? const Radius.circular(16) : Radius.zero,
          bottomLeft: !top && left ? const Radius.circular(16) : Radius.zero,
          bottomRight: !top && !left ? const Radius.circular(16) : Radius.zero,
        ),
      ),
    );
  }
}
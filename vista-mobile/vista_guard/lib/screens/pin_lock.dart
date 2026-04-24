import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../theme.dart';

const _kPinKey = 'vista.guard.pin';

/// Short-idle relock screen. Not a replacement for the server login — this
/// just prevents a stolen unlocked device from being used as a free gate.
/// The PIN is picked the first time the guard uses this screen, stored in
/// secure storage, and cleared on logout.
class PinLock extends StatefulWidget {
  const PinLock({super.key, required this.onUnlock});
  final VoidCallback onUnlock;

  @override
  State<PinLock> createState() => _PinLockState();
}

class _PinLockState extends State<PinLock> {
  final _storage = const FlutterSecureStorage();
  final _controller = TextEditingController();
  bool _settingUp = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _checkInitial();
  }

  Future<void> _checkInitial() async {
    final stored = await _storage.read(key: _kPinKey);
    setState(() => _settingUp = stored == null);
  }

  Future<void> _submit() async {
    final pin = _controller.text.trim();
    if (pin.length != 4) {
      setState(() => _error = 'Enter a 4-digit PIN.');
      return;
    }
    if (_settingUp) {
      await _storage.write(key: _kPinKey, value: pin);
      widget.onUnlock();
      return;
    }
    final stored = await _storage.read(key: _kPinKey);
    if (stored == pin) {
      _controller.clear();
      widget.onUnlock();
    } else {
      setState(() => _error = 'Incorrect PIN.');
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.lock, size: 64, color: VistaColors.brand),
                const SizedBox(height: 16),
                Text(
                  _settingUp ? 'Set a 4-digit guard PIN' : 'Enter your PIN',
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _controller,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  maxLength: 4,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 28, letterSpacing: 12),
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(counterText: ''),
                  onSubmitted: (_) => _submit(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!,
                      style: const TextStyle(color: VistaColors.danger)),
                ],
                const SizedBox(height: 16),
                FilledButton(
                    onPressed: _submit,
                    child: Text(_settingUp ? 'Save PIN' : 'Unlock')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

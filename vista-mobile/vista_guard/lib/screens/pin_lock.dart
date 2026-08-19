import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';

const _kPinKey = 'vista.guard.pin';

/// Short-idle relock screen. Not a replacement for the server login — this
/// just prevents a stolen unlocked device from being used as a free gate.
/// The PIN is picked the first time the guard uses this screen, stored in
/// secure storage, and cleared on logout. A "Forgot PIN?" link gates a
/// reset behind the guard's account password (verified via /api/auth/login)
/// so a thief with an unlocked phone can't bypass the relock.
class PinLock extends ConsumerStatefulWidget {
  const PinLock({super.key, required this.onUnlock});
  final VoidCallback onUnlock;

  @override
  ConsumerState<PinLock> createState() => _PinLockState();
}

class _PinLockState extends ConsumerState<PinLock> {
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
    if (!mounted) return;
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

  Future<void> _forgotPin() async {
    final email = ref.read(sessionProvider).valueOrNull?.email;
    if (email == null) {
      setState(() => _error = 'Sign in again to reset your PIN.');
      return;
    }
    final password = await _promptPassword(email);
    if (password == null || password.isEmpty) return;

    try {
      await ref.read(authRepositoryProvider).login(email, password);
    } on RoleMismatchException {
      if (!mounted) return;
      setState(() => _error = 'Account is no longer a security guard.');
      return;
    } on VistaApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      return;
    } catch (_) {
      if (!mounted) return;
      setState(() =>
          _error = 'Could not verify password. Check your connection.');
      return;
    }

    await _storage.delete(key: _kPinKey);
    _controller.clear();
    if (!mounted) return;
    setState(() {
      _settingUp = true;
      _error = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Password verified. Set a new PIN.')),
    );
  }

  Future<String?> _promptPassword(String email) async {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset PIN'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Confirm the password for $email to set a new PIN.'),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(hintText: 'Password'),
              onSubmitted: (_) => Navigator.of(ctx).pop(ctrl.text),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(ctrl.text),
              child: const Text('Verify')),
        ],
      ),
    );
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
                if (!_settingUp) ...[
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _forgotPin,
                    child: const Text('Forgot PIN?'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

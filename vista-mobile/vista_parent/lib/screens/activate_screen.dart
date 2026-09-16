import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';

/// Activation and password reset are the same three beats — email, one-time
/// code, new password — so they are one screen with two endings rather than two
/// near-identical files.
enum CodeFlow { activate, reset }

/// Enter a registered email, verify the code VISTA mails, choose a password.
///
/// VISTA has no self-registration: an account exists only where the school has
/// authorized the address through the admin portal. This screen is how the
/// holder of that address proves it.
///
/// **Step 2 says the same thing whether or not the email was ever invited.**
/// That is not a placeholder to be improved later — the server answers
/// identically on purpose, so that nobody can use this screen to find out which
/// addresses have VISTA accounts. Do not add a "no invitation found" state, and
/// do not branch the UI on anything read back from the request call: there is
/// nothing in it to branch on.
class ActivateScreen extends ConsumerStatefulWidget {
  const ActivateScreen({super.key, this.flow = CodeFlow.activate});

  final CodeFlow flow;

  @override
  ConsumerState<ActivateScreen> createState() => _ActivateScreenState();
}

class _ActivateScreenState extends ConsumerState<ActivateScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  int _step = 0; // 0 email · 1 code · 2 password
  bool _loading = false;
  bool _obscure = true;
  String? _error;
  String? _token;

  bool get _isActivation => widget.flow == CodeFlow.activate;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() body) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await body();
    } on VistaApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Something went wrong. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _requestCode() async {
    final email = _email.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'Enter the email address the school has on file.');
      return;
    }
    await _run(() async {
      final auth = ref.read(authRepositoryProvider);
      if (_isActivation) {
        await auth.requestActivationCode(email);
      } else {
        await auth.requestPasswordReset(email);
      }
      // Always advance. Stopping here for an unknown address would leak
      // exactly what the generic response exists to hide.
      if (mounted) setState(() => _step = 1);
    });
  }

  Future<void> _verifyCode() async {
    final code = _code.text.trim();
    if (code.length < 4) {
      setState(() => _error = 'Enter the code from your email.');
      return;
    }
    await _run(() async {
      final auth = ref.read(authRepositoryProvider);
      final token = _isActivation
          ? await auth.verifyActivationCode(_email.text.trim(), code)
          : await auth.verifyPasswordResetCode(_email.text.trim(), code);
      if (mounted) {
        setState(() {
          _token = token;
          _step = 2;
        });
      }
    });
  }

  Future<void> _setPassword() async {
    if (_password.text.length < 8) {
      setState(() => _error = 'Choose a password of at least 8 characters.');
      return;
    }
    if (_password.text != _confirm.text) {
      setState(() => _error = 'The two passwords do not match.');
      return;
    }
    await _run(() async {
      final auth = ref.read(authRepositoryProvider);
      if (_isActivation) {
        final user = await auth.completeActivation(_token!, _password.text);
        if (user.role != 'parent') {
          await ref.read(apiClientProvider).clearTokens();
          if (mounted) setState(() => _error = 'This app is for parent accounts only.');
          return;
        }
        ref.invalidate(sessionProvider);
        if (mounted) context.go('/children');
      } else {
        // Deliberately not signed in — signing in with the new password is the
        // last step that proves the reset landed where it was meant to.
        await auth.completePasswordReset(_token!, _password.text);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password changed. Sign in with your new password.')),
        );
        context.go('/login');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEEF1F7),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: VistaColors.navy950,
        title: Text(
          _isActivation ? 'Activate your account' : 'Reset your password',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_step > 0) {
              setState(() {
                _step -= 1;
                _error = null;
              });
            } else {
              context.go('/login');
            }
          },
        ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Header(step: _step, isActivation: _isActivation),
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFE3E7EF)),
                      boxShadow: [
                        BoxShadow(
                          color: VistaColors.brand.withOpacity(0.10),
                          blurRadius: 24,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_step == 0) ..._emailStep(),
                        if (_step == 1) ..._codeStep(),
                        if (_step == 2) ..._passwordStep(),
                        if (_error != null) ...[
                          const SizedBox(height: 16),
                          _ErrorBanner(_error!),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  _footer(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _emailStep() => [
        const _FieldLabel('Registered Email Address'),
        const SizedBox(height: 7),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(
            hintText: 'name@email.com',
            prefixIcon: Icon(Icons.mail_outline),
          ),
          onSubmitted: (_) => _requestCode(),
        ),
        const SizedBox(height: 8),
        Text(
          _isActivation
              ? 'Use the email address you gave your child’s school.'
              : 'Use the email address you sign in with.',
          style: const TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: _loading ? null : _requestCode,
          child: _loading ? const _Spinner() : const Text('Send verification code'),
        ),
      ];

  List<Widget> _codeStep() => [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: VistaColors.brand.withOpacity(0.07),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.mark_email_unread_outlined, size: 20, color: VistaColors.brand),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _isActivation
                      ? 'If an eligible VISTA invitation exists for this email, a verification code will be sent. Please check your email.'
                      : 'If an account exists for this email, password-reset instructions will be sent. Please check your email.',
                  style: const TextStyle(fontSize: 13, height: 1.45, color: Color(0xFF1C3C7D)),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const _FieldLabel('Verification code'),
        const SizedBox(height: 7),
        TextField(
          controller: _code,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w600),
          decoration: const InputDecoration(hintText: '------'),
          onSubmitted: (_) => _verifyCode(),
        ),
        const SizedBox(height: 8),
        const Text(
          'The code expires 10 minutes after it is sent and can be used once.',
          style: TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: _loading ? null : _verifyCode,
          child: _loading ? const _Spinner() : const Text('Verify'),
        ),
        const SizedBox(height: 6),
        TextButton(
          onPressed: _loading ? null : _requestCode,
          child: const Text('Send another code'),
        ),
      ];

  List<Widget> _passwordStep() => [
        Row(
          children: [
            const Icon(Icons.check_circle, size: 20, color: VistaColors.success),
            const SizedBox(width: 8),
            Text(
              _isActivation ? 'Email verified' : 'Code verified',
              style: const TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w600, color: VistaColors.success),
            ),
          ],
        ),
        const SizedBox(height: 16),
        const _FieldLabel('New password'),
        const SizedBox(height: 7),
        TextField(
          controller: _password,
          obscureText: _obscure,
          decoration: InputDecoration(
            hintText: 'At least 8 characters',
            prefixIcon: const Icon(Icons.lock_outline),
            suffixIcon: IconButton(
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  color: Colors.black45),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
        ),
        const SizedBox(height: 14),
        const _FieldLabel('Confirm password'),
        const SizedBox(height: 7),
        TextField(
          controller: _confirm,
          obscureText: _obscure,
          decoration: const InputDecoration(
            hintText: 'Type it again',
            prefixIcon: Icon(Icons.lock_outline),
          ),
          onSubmitted: (_) => _setPassword(),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: _loading ? null : _setPassword,
          child: _loading
              ? const _Spinner()
              : Text(_isActivation ? 'Activate account' : 'Change password'),
        ),
        const SizedBox(height: 10),
        const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.shield_outlined, size: 16, color: Colors.black38),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Only you will know this password. School staff cannot see it and can never set it for you.',
                style: TextStyle(fontSize: 12, height: 1.4, color: Colors.black54),
              ),
            ),
          ],
        ),
      ];

  Widget _footer() {
    if (_step == 0 && _isActivation) {
      return TextButton(
        onPressed: () => context.go('/login'),
        child: const Text('Already activated? Sign in'),
      );
    }
    if (_step == 1) {
      return const Padding(
        padding: EdgeInsets.symmetric(horizontal: 4),
        child: Text(
          'Nothing arrived? Ask the school office to confirm the address they registered, then try again.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, height: 1.4, color: Colors.black54),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.step, required this.isActivation});

  final int step;
  final bool isActivation;

  static const _activateTitles = ['Activate your account', 'Check your email', 'Create your password'];
  static const _resetTitles = ['Reset your password', 'Check your email', 'Create a new password'];

  @override
  Widget build(BuildContext context) {
    final titles = isActivation ? _activateTitles : _resetTitles;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: List.generate(3, (i) {
            return Expanded(
              child: Container(
                height: 3,
                margin: EdgeInsets.only(right: i == 2 ? 0 : 6),
                decoration: BoxDecoration(
                  color: i <= step ? VistaColors.brand : const Color(0xFFD9DFEA),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 16),
        Text(
          titles[step],
          style: const TextStyle(
              fontSize: 20, fontWeight: FontWeight.w700, color: VistaColors.navy950),
        ),
      ],
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 20,
        width: 20,
        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
      );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.black54),
      );
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: VistaColors.danger.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: VistaColors.danger.withOpacity(0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, size: 20, color: VistaColors.danger),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                  color: VistaColors.danger, fontWeight: FontWeight.w600, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

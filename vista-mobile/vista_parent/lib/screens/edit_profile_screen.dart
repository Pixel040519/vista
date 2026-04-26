import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';
import '../widgets/photo_picker.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Edit Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _AvatarCard(user: user),
          const SizedBox(height: 16),
          _PersonalInfoCard(user: user),
          const SizedBox(height: 16),
          const _ChangePasswordCard(),
        ],
      ),
    );
  }
}

class _AvatarCard extends ConsumerStatefulWidget {
  const _AvatarCard({required this.user});
  final VistaUser? user;

  @override
  ConsumerState<_AvatarCard> createState() => _AvatarCardState();
}

class _AvatarCardState extends ConsumerState<_AvatarCard> {
  bool _uploading = false;
  String? _error;
  File? _localPreview;

  Future<void> _change() async {
    final file = await pickPhoto(context);
    if (file == null) return;
    setState(() {
      _localPreview = file;
      _uploading = true;
      _error = null;
    });
    try {
      await ref.read(parentApiProvider).uploadProfilePhoto(file);
      ref.invalidate(sessionProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile photo updated.')),
      );
    } on VistaApiException catch (e) {
      setState(() {
        _error = e.message;
        _localPreview = null;
      });
    } catch (_) {
      setState(() {
        _error = 'Could not upload photo. Check your connection.';
        _localPreview = null;
      });
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.user?.photoUrl;
    final ImageProvider? bg = _localPreview != null
        ? FileImage(_localPreview!)
        : (url != null ? NetworkImage(url) : null) as ImageProvider?;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Stack(
              children: [
                CircleAvatar(
                  radius: 36,
                  backgroundColor: const Color(0xFFEEF1F7),
                  backgroundImage: bg,
                  child: bg == null
                      ? const Icon(Icons.person,
                          size: 36, color: Colors.black45)
                      : null,
                ),
                if (_uploading)
                  Positioned.fill(
                    child: Container(
                      decoration: const BoxDecoration(
                          shape: BoxShape.circle, color: Colors.black38),
                      child: const Center(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  bottom: -2,
                  right: -2,
                  child: Material(
                    color: VistaColors.brand,
                    shape: const CircleBorder(),
                    elevation: 2,
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: _uploading ? null : _change,
                      child: const Padding(
                        padding: EdgeInsets.all(6),
                        child: Icon(Icons.photo_camera,
                            size: 14, color: Colors.white),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Profile photo',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: VistaColors.navy950,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _error ??
                        'Shown to the school guard at pickup so they can verify it’s you.',
                    style: TextStyle(
                      fontSize: 12,
                      color: _error != null
                          ? VistaColors.danger
                          : Colors.black54,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PersonalInfoCard extends ConsumerStatefulWidget {
  const _PersonalInfoCard({required this.user});
  final VistaUser? user;

  @override
  ConsumerState<_PersonalInfoCard> createState() => _PersonalInfoCardState();
}

class _PersonalInfoCardState extends ConsumerState<_PersonalInfoCard> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _surname;
  late final TextEditingController _firstName;
  late final TextEditingController _middleName;
  late final TextEditingController _phone;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final u = widget.user;
    final fallback = _splitFullName(u?.fullName ?? '');
    _surname = TextEditingController(text: u?.surname ?? fallback.surname);
    _firstName =
        TextEditingController(text: u?.firstName ?? fallback.firstName);
    _middleName =
        TextEditingController(text: u?.middleName ?? fallback.middleName);
    _phone = TextEditingController(text: u?.phone ?? '');
  }

  @override
  void dispose() {
    _surname.dispose();
    _firstName.dispose();
    _middleName.dispose();
    _phone.dispose();
    super.dispose();
  }

  static ({String surname, String firstName, String middleName})
      _splitFullName(String full) {
    final parts = full.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) {
      return (surname: '', firstName: '', middleName: '');
    }
    if (parts.length == 1) {
      return (surname: '', firstName: parts.first, middleName: '');
    }
    if (parts.length == 2) {
      return (surname: parts.last, firstName: parts.first, middleName: '');
    }
    return (
      surname: parts.last,
      firstName: parts.first,
      middleName: parts.sublist(1, parts.length - 1).join(' '),
    );
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(parentApiProvider).updateProfile(
            surname: _surname.text.trim(),
            firstName: _firstName.text.trim(),
            middleName: _middleName.text.trim().isEmpty
                ? null
                : _middleName.text.trim(),
            phone: _phone.text.trim(),
          );
      ref.invalidate(sessionProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated.')),
        );
      }
    } on VistaApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not save changes. Check your connection.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Personal info',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: VistaColors.navy950,
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _surname,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Surname'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Enter your surname' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _firstName,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'First name'),
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Enter your first name'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _middleName,
                textInputAction: TextInputAction.next,
                decoration:
                    const InputDecoration(labelText: 'Middle name (optional)'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _phone,
                textInputAction: TextInputAction.done,
                keyboardType: TextInputType.phone,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9+ \-]')),
                ],
                decoration: const InputDecoration(
                  labelText: 'Phone',
                  helperText: 'Use a Philippine 11-digit number',
                ),
                validator: (v) {
                  final digits =
                      (v ?? '').replaceAll(RegExp(r'[^0-9]'), '');
                  if (digits.length < 7) return 'Enter a valid phone number';
                  return null;
                },
              ),
              const SizedBox(height: 12),
              _ReadOnlyEmail(email: widget.user?.email ?? ''),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: VistaColors.danger)),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Save changes'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReadOnlyEmail extends StatelessWidget {
  const _ReadOnlyEmail({required this.email});
  final String email;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F3F8),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFDDE2EC)),
      ),
      child: Row(
        children: [
          const Icon(Icons.email_outlined, size: 20, color: Colors.black54),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Email',
                    style:
                        TextStyle(fontSize: 12, color: Colors.black54)),
                Text(email.isEmpty ? '—' : email,
                    style: const TextStyle(
                        fontSize: 15, color: VistaColors.navy950)),
              ],
            ),
          ),
          const Text('Read only',
              style: TextStyle(fontSize: 12, color: Colors.black45)),
        ],
      ),
    );
  }
}

class _ChangePasswordCard extends ConsumerStatefulWidget {
  const _ChangePasswordCard();

  @override
  ConsumerState<_ChangePasswordCard> createState() =>
      _ChangePasswordCardState();
}

class _ChangePasswordCardState extends ConsumerState<_ChangePasswordCard> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _showCurrent = false;
  bool _showNext = false;
  bool _showConfirm = false;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(parentApiProvider).changePassword(
            currentPassword: _current.text,
            newPassword: _next.text,
          );
      _current.clear();
      _next.clear();
      _confirm.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password updated.')),
        );
      }
    } on VistaApiException catch (e) {
      setState(() => _error = e.statusCode == 401
          ? 'Current password is incorrect.'
          : e.message);
    } catch (_) {
      setState(() =>
          _error = 'Could not change password. Check your connection.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Change password',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: VistaColors.navy950,
                ),
              ),
              const SizedBox(height: 12),
              _PasswordField(
                controller: _current,
                label: 'Current password',
                visible: _showCurrent,
                onToggle: () =>
                    setState(() => _showCurrent = !_showCurrent),
                validator: (v) => (v == null || v.isEmpty)
                    ? 'Enter your current password'
                    : null,
              ),
              const SizedBox(height: 12),
              _PasswordField(
                controller: _next,
                label: 'New password',
                visible: _showNext,
                onToggle: () => setState(() => _showNext = !_showNext),
                validator: (v) {
                  if (v == null || v.length < 8) {
                    return 'Use at least 8 characters';
                  }
                  if (v == _current.text) {
                    return 'New password must differ from current';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              _PasswordField(
                controller: _confirm,
                label: 'Confirm new password',
                visible: _showConfirm,
                onToggle: () =>
                    setState(() => _showConfirm = !_showConfirm),
                validator: (v) =>
                    (v != _next.text) ? 'Passwords do not match' : null,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style: const TextStyle(color: VistaColors.danger)),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Update password'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PasswordField extends StatelessWidget {
  const _PasswordField({
    required this.controller,
    required this.label,
    required this.visible,
    required this.onToggle,
    required this.validator,
  });

  final TextEditingController controller;
  final String label;
  final bool visible;
  final VoidCallback onToggle;
  final String? Function(String?) validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      obscureText: !visible,
      textInputAction: TextInputAction.next,
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: IconButton(
          onPressed: onToggle,
          icon: Icon(visible ? Icons.visibility_off : Icons.visibility),
        ),
      ),
      validator: validator,
    );
  }
}

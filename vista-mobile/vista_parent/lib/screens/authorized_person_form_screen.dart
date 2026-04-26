import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';
import '../widgets/photo_picker.dart';

/// Add/edit form for a non-account fetcher. Pops with `true` to signal the
/// list to refresh, `null`/`false` on cancel.
class AuthorizedPersonFormScreen extends ConsumerStatefulWidget {
  const AuthorizedPersonFormScreen({
    super.key,
    required this.studentId,
    this.existing,
  });

  final String studentId;
  final AuthorizedPickupPerson? existing;

  @override
  ConsumerState<AuthorizedPersonFormScreen> createState() =>
      _AuthorizedPersonFormScreenState();
}

class _AuthorizedPersonFormScreenState
    extends ConsumerState<AuthorizedPersonFormScreen> {
  static const _relationships = [
    'Yaya',
    'Lola',
    'Lolo',
    'Tito',
    'Tita',
    'Driver',
    'Sibling',
    'Relative',
    'Other',
  ];

  final _form = GlobalKey<FormState>();
  late final TextEditingController _surname;
  late final TextEditingController _firstName;
  late final TextEditingController _middleName;
  late String _relationship;
  File? _newPhoto;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _surname = TextEditingController(text: e?.surname ?? '');
    _firstName = TextEditingController(text: e?.firstName ?? '');
    _middleName = TextEditingController(text: e?.middleName ?? '');
    _relationship = _relationships.contains(e?.relationship)
        ? e!.relationship
        : _relationships.first;
  }

  @override
  void dispose() {
    _surname.dispose();
    _firstName.dispose();
    _middleName.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    final file = await pickPhoto(context);
    if (file != null) setState(() => _newPhoto = file);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final isCreate = widget.existing == null;
    if (isCreate && _newPhoto == null) {
      setState(() => _error = 'A photo is required.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final api = ref.read(parentApiProvider);
    try {
      if (isCreate) {
        await api.addAuthorizedPerson(
          studentId: widget.studentId,
          surname: _surname.text.trim(),
          firstName: _firstName.text.trim(),
          middleName: _middleName.text.trim().isEmpty
              ? null
              : _middleName.text.trim(),
          relationship: _relationship,
          photo: _newPhoto!,
        );
      } else {
        await api.updateAuthorizedPerson(
          id: widget.existing!.id,
          surname: _surname.text.trim(),
          firstName: _firstName.text.trim(),
          middleName: _middleName.text.trim().isEmpty
              ? null
              : _middleName.text.trim(),
          relationship: _relationship,
          photo: _newPhoto,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on VistaApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() =>
          _error = 'Could not save. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isCreate = widget.existing == null;
    final existingPhoto = widget.existing?.photoUrl;

    return Scaffold(
      appBar: AppBar(
        title: Text(isCreate ? 'Add fetcher' : 'Edit fetcher'),
      ),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: Stack(
                  children: [
                    CircleAvatar(
                      radius: 56,
                      backgroundColor: const Color(0xFFEEF1F7),
                      backgroundImage: _newPhoto != null
                          ? FileImage(_newPhoto!)
                          : (existingPhoto != null
                              ? NetworkImage(existingPhoto)
                              : null) as ImageProvider?,
                      child: (_newPhoto == null && existingPhoto == null)
                          ? const Icon(Icons.person,
                              size: 48, color: Colors.black45)
                          : null,
                    ),
                    Positioned(
                      bottom: 0,
                      right: 0,
                      child: Material(
                        color: VistaColors.brand,
                        shape: const CircleBorder(),
                        elevation: 2,
                        child: InkWell(
                          customBorder: const CircleBorder(),
                          onTap: _saving ? null : _pickPhoto,
                          child: const Padding(
                            padding: EdgeInsets.all(8),
                            child: Icon(Icons.photo_camera,
                                size: 18, color: Colors.white),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              const Center(
                child: Text(
                  'Tap the camera to take or choose a photo',
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _surname,
                decoration: const InputDecoration(labelText: 'Surname'),
                textInputAction: TextInputAction.next,
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Enter their surname'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _firstName,
                decoration: const InputDecoration(labelText: 'First name'),
                textInputAction: TextInputAction.next,
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Enter their first name'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _middleName,
                decoration:
                    const InputDecoration(labelText: 'Middle name (optional)'),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _relationship,
                decoration: const InputDecoration(labelText: 'Relationship'),
                items: _relationships
                    .map((r) =>
                        DropdownMenuItem(value: r, child: Text(r)))
                    .toList(),
                onChanged: (v) =>
                    setState(() => _relationship = v ?? _relationship),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style: const TextStyle(color: VistaColors.danger)),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : Text(isCreate ? 'Add fetcher' : 'Save changes'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

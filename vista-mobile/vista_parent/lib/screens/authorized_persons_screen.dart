import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';
import 'authorized_person_form_screen.dart';

/// Lists every non-account fetcher the parent has authorized for a given
/// child. Reached from the Pickup QR tab. The list is shown in a refreshable
/// scroll view; FAB pushes the form in "create" mode; tapping a row pushes
/// it in "edit" mode; trailing delete icon removes after confirmation.
class AuthorizedPersonsScreen extends ConsumerStatefulWidget {
  const AuthorizedPersonsScreen({super.key, required this.studentId});

  final String studentId;

  @override
  ConsumerState<AuthorizedPersonsScreen> createState() =>
      _AuthorizedPersonsScreenState();
}

class _AuthorizedPersonsScreenState
    extends ConsumerState<AuthorizedPersonsScreen> {
  late Future<List<AuthorizedPickupPerson>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<AuthorizedPickupPerson>> _load() {
    return ref.read(parentApiProvider).listAuthorizedPersons(widget.studentId);
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _openForm({AuthorizedPickupPerson? existing}) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AuthorizedPersonFormScreen(
          studentId: widget.studentId,
          existing: existing,
        ),
      ),
    );
    if (changed == true) _refresh();
  }

  Future<void> _confirmDelete(AuthorizedPickupPerson p) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove authorized person?'),
        content: Text(
            '${p.fullName} will no longer appear as a pickup option. You can add them again later.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: VistaColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (yes != true) return;

    try {
      await ref.read(parentApiProvider).deleteAuthorizedPerson(p.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('${p.fullName} removed.')));
      _refresh();
    } on VistaApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Authorized fetchers')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Add person'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<AuthorizedPickupPerson>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  const SizedBox(height: 80),
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'Could not load: ${snap.error}',
                        style: const TextStyle(color: VistaColors.danger),
                      ),
                    ),
                  ),
                ],
              );
            }
            final items = snap.data ?? const <AuthorizedPickupPerson>[];
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 80),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 24),
                    child: Column(
                      children: [
                        Icon(Icons.group_outlined,
                            size: 56, color: Colors.black26),
                        SizedBox(height: 12),
                        Text(
                          'No authorized fetchers yet',
                          style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                              color: VistaColors.navy950),
                        ),
                        SizedBox(height: 6),
                        Text(
                          'Add a yaya, lola, driver, or relative so they can be selected when generating a Pickup QR.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.black54),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final p = items[i];
                return Card(
                  child: ListTile(
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    leading: CircleAvatar(
                      radius: 26,
                      backgroundColor: const Color(0xFFEEF1F7),
                      backgroundImage:
                          p.photoUrl != null ? NetworkImage(p.photoUrl!) : null,
                      child: p.photoUrl == null
                          ? const Icon(Icons.person, color: Colors.black45)
                          : null,
                    ),
                    title: Text(p.fullName,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: VistaColors.navy950)),
                    subtitle: Text(p.relationship,
                        style: const TextStyle(color: Colors.black54)),
                    trailing: Wrap(
                      spacing: 4,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.edit_outlined),
                          onPressed: () => _openForm(existing: p),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete_outline,
                              color: VistaColors.danger),
                          onPressed: () => _confirmDelete(p),
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

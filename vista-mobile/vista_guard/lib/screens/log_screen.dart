import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../providers.dart';
import '../theme.dart';

class LogScreen extends ConsumerWidget {
  const LogScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logs = ref.watch(todayLogProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Today’s log')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(todayLogProvider);
          await ref.read(todayLogProvider.future);
        },
        child: logs.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [Text('Unable to load log.\n$e')],
          ),
          data: (list) {
            if (list.isEmpty) {
              return const Center(
                  child: Text('No scans yet today.',
                      style: TextStyle(color: Colors.black54, fontSize: 16)));
            }
            return ListView.separated(
              itemCount: list.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (c, i) {
                final l = list[i];
                return ListTile(
                  leading: Icon(
                    l.isSuccess ? Icons.check_circle : Icons.cancel,
                    color: l.isSuccess
                        ? VistaColors.success
                        : VistaColors.danger,
                    size: 32,
                  ),
                  title: Text(l.studentName ?? 'Unknown student',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(
                      '${l.guardianName ?? '—'}\n${DateFormat.jm().format(l.scannedAt)}'),
                  trailing: Text(l.status,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  isThreeLine: true,
                );
              },
            );
          },
        ),
      ),
    );
  }
}

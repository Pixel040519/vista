import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../providers.dart';
import '../theme.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(notificationsProvider);
          await ref.read(notificationsProvider.future);
        },
        child: list.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            padding: const EdgeInsets.all(16),
            children: [Text('Unable to load notifications.\n$e')],
          ),
          data: (items) {
            if (items.isEmpty) {
              return const Center(
                  child: Text('No notifications yet.',
                      style: TextStyle(color: Colors.black54)));
            }
            return ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (c, i) {
                final n = items[i];
                return ListTile(
                  leading: Icon(
                    n.isRead ? Icons.mark_email_read : Icons.mark_email_unread,
                    color: n.isRead ? Colors.black45 : VistaColors.brand,
                  ),
                  title: Text(n.title,
                      style: TextStyle(
                          fontWeight:
                              n.isRead ? FontWeight.w500 : FontWeight.w700)),
                  subtitle: Text(
                    '${n.body}\n${DateFormat.yMMMd().add_jm().format(n.sentAt)}',
                  ),
                  isThreeLine: true,
                  onTap: () async {
                    if (!n.isRead) {
                      await ref.read(parentApiProvider).markNotificationRead(n.id);
                      ref.invalidate(notificationsProvider);
                    }
                    // Deep-link pickup alerts straight to the child's dismissal tab.
                    if (n.type == 'dismissal' && n.referenceId != null) {
                      if (context.mounted) {
                        context.push(
                            '/child/${n.referenceId}?tab=dismissal');
                      }
                    }
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }
}

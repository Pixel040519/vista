import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vista_api/vista_api.dart';

import 'env.dart';

/// Long-lived Dio wrapper. All other providers derive from this.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(baseUrl: vistaApiBase);
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(apiClientProvider));
});

final parentApiProvider = Provider<ParentApi>((ref) {
  return ParentApi(ref.watch(apiClientProvider));
});

/// Resolves the current session on app boot. `null` => logged out.
final sessionProvider = FutureProvider<VistaUser?>((ref) async {
  return ref.watch(authRepositoryProvider).me();
});

/// Active child selection — drives the detail screen + FCM deep-links.
final selectedChildIdProvider = StateProvider<String?>((_) => null);

final childrenProvider = FutureProvider<List<Student>>((ref) async {
  // Wait until we have a session before hitting the list endpoint.
  final user = await ref.watch(sessionProvider.future);
  if (user == null) return const [];
  return ref.watch(parentApiProvider).children();
});

final parentSummaryProvider =
    FutureProvider.family<ParentSummary, String>((ref, studentId) {
  return ref.watch(parentApiProvider).summary(studentId);
});

final notificationsProvider =
    FutureProvider<List<AppNotification>>((ref) async {
  return ref.watch(parentApiProvider).notifications();
});

final announcementsProvider =
    FutureProvider<List<Announcement>>((ref) async {
  return ref.watch(parentApiProvider).announcements();
});

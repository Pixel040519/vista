import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vista_api/vista_api.dart';

import 'env.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(baseUrl: vistaApiBase);
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(apiClientProvider),
      requiredRole: 'security_guard');
});

final guardApiProvider = Provider<GuardApi>((ref) {
  return GuardApi(ref.watch(apiClientProvider));
});

final sessionProvider = FutureProvider<VistaUser?>((ref) {
  return ref.watch(authRepositoryProvider).me();
});

final todayLogProvider = FutureProvider<List<DismissalLog>>((ref) {
  return ref.watch(guardApiProvider).todayLog();
});

/// Tracks whether the scanner should require a PIN re-entry. Flipped to
/// `true` after 2 minutes of idleness on the scan screen.
final lockedProvider = StateProvider<bool>((_) => false);

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'providers.dart';
import 'screens/gate_select_screen.dart';
import 'screens/log_screen.dart';
import 'screens/login_screen.dart';
import 'screens/scan_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/splash_screen.dart';

GoRouter buildRouter(WidgetRef ref) {
  final notifier = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, __) => notifier.value++);
  ref.listen(gateConfirmedProvider, (_, __) => notifier.value++);
  return GoRouter(
    initialLocation: '/',
    refreshListenable: notifier,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      if (session.isLoading) {
        return state.matchedLocation == '/' ? null : '/';
      }
      final loggedIn = session.valueOrNull != null;
      final loc = state.matchedLocation;
      final loggingIn = loc == '/login';
      if (!loggedIn && !loggingIn) return '/login';
      if (loggedIn) {
        final gateConfirmed = ref.read(gateConfirmedProvider);
        if (!gateConfirmed && loc != '/gate') return '/gate';
        if (gateConfirmed && (loggingIn || loc == '/' || loc == '/gate')) {
          return '/scan';
        }
      }
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/gate', builder: (_, __) => const GateSelectScreen()),
      GoRoute(path: '/scan', builder: (_, __) => const ScanScreen()),
      GoRoute(path: '/log', builder: (_, __) => const LogScreen()),
      GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
    ],
  );
}

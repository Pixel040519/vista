import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'providers.dart';
import 'screens/activate_screen.dart';
import 'screens/child_detail_screen.dart';
import 'screens/children_screen.dart';
import 'screens/edit_profile_screen.dart';
import 'screens/login_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/splash_screen.dart';

GoRouter buildRouter(WidgetRef ref) {
  final notifier = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, __) => notifier.value++);
  return GoRouter(
    initialLocation: '/',
    refreshListenable: notifier,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      // Still resolving `/me` — keep users on splash.
      if (session.isLoading) {
        return state.matchedLocation == '/' ? null : '/';
      }
      final loggedIn = session.valueOrNull != null;
      // Activation and password reset are signed-out surfaces, like /login —
      // a parent reaching them has no session yet by definition, so they must
      // not be bounced to /login by the guard below.
      const signedOut = {'/login', '/activate', '/forgot-password'};
      final onSignedOut = signedOut.contains(state.matchedLocation);
      if (!loggedIn && !onSignedOut) return '/login';
      if (loggedIn && (onSignedOut || state.matchedLocation == '/')) {
        return '/children';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(
        path: '/activate',
        builder: (_, __) => const ActivateScreen(flow: CodeFlow.activate),
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (_, __) => const ActivateScreen(flow: CodeFlow.reset),
      ),
      GoRoute(
        path: '/children',
        builder: (_, __) => const ChildrenScreen(),
      ),
      GoRoute(
        path: '/child/:id',
        builder: (_, s) => ChildDetailScreen(
          studentId: s.pathParameters['id']!,
          initialTab: s.uri.queryParameters['tab'],
        ),
      ),
      GoRoute(
        path: '/notifications',
        builder: (_, __) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/profile',
        builder: (_, __) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/profile/edit',
        builder: (_, __) => const EditProfileScreen(),
      ),
    ],
  );
}

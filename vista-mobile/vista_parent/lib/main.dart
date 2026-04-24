import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'fcm.dart';
import 'providers.dart';
import 'router.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: VistaParentApp()));
}

class VistaParentApp extends ConsumerStatefulWidget {
  const VistaParentApp({super.key});

  @override
  ConsumerState<VistaParentApp> createState() => _VistaParentAppState();
}

class _VistaParentAppState extends ConsumerState<VistaParentApp> {
  bool _fcmStarted = false;

  @override
  Widget build(BuildContext context) {
    // Start FCM once we have a confirmed session, so we only register the
    // device token under an authenticated user.
    ref.listen(sessionProvider, (_, next) async {
      if (_fcmStarted) return;
      final user = next.valueOrNull;
      if (user != null) {
        _fcmStarted = true;
        try {
          await setupFcm(ref.read(parentApiProvider));
        } catch (_) {
          // Firebase not yet provisioned on this build — app still works.
        }
      }
    });

    final router = buildRouter(ref);
    return MaterialApp.router(
      title: 'VISTA Parent',
      theme: buildVistaTheme(),
      debugShowCheckedModeBanner: false,
      routerConfig: router,
    );
  }
}

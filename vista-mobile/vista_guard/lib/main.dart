import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'env.dart';
import 'offline_queue.dart';
import 'providers.dart';
import 'router.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  debugPrint('[VISTA] Guard app API base: $vistaApiBase');
  runApp(const ProviderScope(child: VistaGuardApp()));
}

class VistaGuardApp extends ConsumerStatefulWidget {
  const VistaGuardApp({super.key});

  @override
  ConsumerState<VistaGuardApp> createState() => _VistaGuardAppState();
}

class _VistaGuardAppState extends ConsumerState<VistaGuardApp> {
  @override
  void initState() {
    super.initState();
    // Kick the offline queue periodically; it no-ops on empty / disconnected.
    Future.microtask(
        () => OfflineQueue.instance.start(() => ref.read(guardApiProvider)));
  }

  @override
  Widget build(BuildContext context) {
    final router = buildRouter(ref);
    return MaterialApp.router(
      title: 'VISTA Guard',
      theme: buildVistaGuardTheme(),
      debugShowCheckedModeBanner: false,
      routerConfig: router,
    );
  }
}

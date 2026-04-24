import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:vista_api/vista_api.dart';

/// FCM bootstrap + device-token registration. Run `setupFcm(parentApi)`
/// from `main()` after Firebase.initializeApp() and an authenticated session
/// is confirmed.
///
/// Separate from the rest of the app so that the non-Firebase test harness
/// never imports `firebase_messaging`.
Future<void> setupFcm(ParentApi api) async {
  await Firebase.initializeApp();

  final messaging = FirebaseMessaging.instance;
  final settings = await messaging.requestPermission(
    alert: true,
    badge: true,
    sound: true,
  );
  if (settings.authorizationStatus == AuthorizationStatus.denied) return;

  final token = await messaging.getToken();
  if (token != null && token.isNotEmpty) {
    await api.registerDevice(
      token: token,
      platform: Platform.isIOS ? 'ios' : 'android',
    );
  }

  messaging.onTokenRefresh.listen((t) async {
    await api.registerDevice(
      token: t,
      platform: Platform.isIOS ? 'ios' : 'android',
    );
  });

  final local = FlutterLocalNotificationsPlugin();
  const initAndroid = AndroidInitializationSettings('@mipmap/ic_launcher');
  const initIos = DarwinInitializationSettings();
  await local.initialize(
      const InitializationSettings(android: initAndroid, iOS: initIos));

  FirebaseMessaging.onMessage.listen((msg) async {
    final n = msg.notification;
    if (n == null) return;
    await local.show(
      n.hashCode,
      n.title,
      n.body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'vista_pickup',
          'Pickup Alerts',
          channelDescription: 'Fires when your child is picked up at the gate.',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      payload: msg.data['student_id']?.toString(),
    );
  });
}

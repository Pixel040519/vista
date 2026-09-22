import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:vista_api/vista_api.dart';

/// The in-app route a push should open, from its data payload. Null when the
/// message has nowhere specific to go.
String? routeForPush(Map<String, dynamic> data) {
  switch (data['type']) {
    case 'announcement':
      final id = data['announcement_id']?.toString();
      return id == null ? '/announcements' : '/announcements?id=$id';
    case 'pickup':
      final id = data['student_id']?.toString();
      return id == null ? null : '/child/$id?tab=dismissal';
  }
  return null;
}

/// Each push type gets its own Android channel, so a parent can silence
/// school announcements without also silencing gate pickup alerts.
const _pickupChannel = AndroidNotificationDetails(
  'vista_pickup',
  'Pickup Alerts',
  channelDescription: 'Fires when your child is picked up at the gate.',
  importance: Importance.high,
  priority: Priority.high,
);

const _announcementChannel = AndroidNotificationDetails(
  'vista_announcements',
  'School Announcements',
  channelDescription: 'News and notices from the school.',
  importance: Importance.defaultImportance,
  priority: Priority.defaultPriority,
);

/// FCM bootstrap + device-token registration. Run `setupFcm(parentApi)`
/// from `main()` after Firebase.initializeApp() and an authenticated session
/// is confirmed. [onOpen] receives the route to show when the parent taps a
/// notification — foreground, background, or the one that launched the app.
///
/// Separate from the rest of the app so that the non-Firebase test harness
/// never imports `firebase_messaging`.
Future<void> setupFcm(ParentApi api, {void Function(String route)? onOpen}) async {
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
    const InitializationSettings(android: initAndroid, iOS: initIos),
    // A notification shown by onMessage below carries its route as payload.
    onDidReceiveNotificationResponse: (r) {
      final route = r.payload;
      if (route != null && route.isNotEmpty) onOpen?.call(route);
    },
  );

  FirebaseMessaging.onMessage.listen((msg) async {
    final n = msg.notification;
    if (n == null) return;
    final isAnnouncement = msg.data['type'] == 'announcement';
    await local.show(
      n.hashCode,
      n.title,
      n.body,
      NotificationDetails(
        android: isAnnouncement ? _announcementChannel : _pickupChannel,
        iOS: const DarwinNotificationDetails(),
      ),
      payload: routeForPush(msg.data),
    );
  });

  // Tapped while the app was in the background, or used to launch it.
  void open(RemoteMessage msg) {
    final route = routeForPush(msg.data);
    if (route != null) onOpen?.call(route);
  }

  FirebaseMessaging.onMessageOpenedApp.listen(open);
  final initial = await messaging.getInitialMessage();
  if (initial != null) open(initial);
}

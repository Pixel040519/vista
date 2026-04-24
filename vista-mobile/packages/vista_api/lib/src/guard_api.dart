import 'package:dio/dio.dart';

import 'api_client.dart';
import 'models/dismissal.dart';

/// Guard-only API surface. The only mutation the guard app performs is
/// `POST /api/dismissal/verify`; everything else is read-only logs.
class GuardApi {
  GuardApi(this.client);

  final ApiClient client;

  /// Submits a scanned QR payload to the backend. [qrPayload] is the raw
  /// string decoded by `mobile_scanner` — the server parses + validates it
  /// (expiry, single-use, authorized guardians) and invalidates the QR on
  /// success. [authorizedBy] is the name displayed to the guard of the
  /// guardian they visually confirmed at the gate (required by v1).
  Future<DismissalVerifyResult> verify({
    required String qrPayload,
    required String authorizedBy,
  }) async {
    try {
      final r = await client.raw.post('/api/dismissal/verify', data: {
        'qrPayload': qrPayload,
        'authorized_by': authorizedBy,
      });
      return DismissalVerifyResult.fromJson(
          (r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<DismissalLog>> todayLog() async {
    try {
      final r = await client.raw
          .get('/api/dismissal/logs', queryParameters: {'date': 'today'});
      final list = (r.data['logs'] as List? ?? r.data as List? ?? const [])
          .cast<Map>()
          .map((m) => DismissalLog.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<void> registerDevice({required String token, required String platform}) async {
    try {
      await client.raw.post('/api/devices/register',
          data: {'token': token, 'platform': platform});
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<void> unregisterDevice(String token) async {
    try {
      await client.raw.delete('/api/devices/$token');
    } catch (_) {}
  }
}

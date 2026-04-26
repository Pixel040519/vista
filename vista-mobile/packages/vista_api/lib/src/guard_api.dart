import 'package:dio/dio.dart';

import 'api_client.dart';
import 'models/dismissal.dart';

/// Guard-only API surface. The only mutation the guard app performs is
/// `POST /api/dismissal/verify`; everything else is read-only logs.
class GuardApi {
  GuardApi(this.client);

  final ApiClient client;

  /// Step 1: decode the QR and load the student's authorized-pickup guardians
  /// for the picker. Does not consume the QR — the guard must still confirm by
  /// calling [verify] with the chosen guardian's UUID.
  Future<DismissalScanResult> scan({required String qrPayload}) async {
    try {
      final r = await client.raw.post('/api/dismissal/scan', data: {
        'qrPayload': qrPayload,
      });
      return DismissalScanResult.fromJson(
          (r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  /// Step 2: confirm the pickup with the UUID of the guardian the guard tapped
  /// on the picker. Server invalidates the QR on success.
  Future<DismissalVerifyResult> verify({
    required String qrPayload,
    required String authorizedById,
    String fetcherType = 'self',
    String? gateLabel,
  }) async {
    try {
      final r = await client.raw.post('/api/dismissal/verify', data: {
        'qrPayload': qrPayload,
        'authorized_by_id': authorizedById,
        'fetcher_type': fetcherType,
        if (gateLabel != null && gateLabel.isNotEmpty) 'gate_label': gateLabel,
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

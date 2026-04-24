import 'package:dio/dio.dart';

import 'api_client.dart';
import 'errors.dart';
import 'models/user.dart';

/// Auth API glue. Handles login (including role-mismatch rejection for the
/// guard app), token persistence, and `/me`.
class AuthRepository {
  AuthRepository(this.client, {this.requiredRole});

  final ApiClient client;

  /// If set, login rejects with [RoleMismatchException] when the server
  /// returns a user whose role != this value. vista_guard sets this to
  /// `security_guard` so parent credentials can't open the guard app.
  final String? requiredRole;

  Future<VistaUser> login(String email, String password) async {
    try {
      final r = await client.raw.post('/api/auth/login', data: {
        'email': email,
        'password': password,
      });
      final access = r.data['accessToken'] as String?;
      final refresh = r.data['refreshToken'] as String?;
      if (access == null || refresh == null) {
        throw VistaApiException(
            r.statusCode, 'Login response missing tokens.');
      }

      final user = VistaUser.fromJson(
          (r.data['user'] as Map).cast<String, dynamic>());

      if (requiredRole != null && user.role != requiredRole) {
        throw RoleMismatchException(requiredRole!, user.role);
      }

      await client.setTokens(access: access, refresh: refresh);
      return user;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<VistaUser?> me() async {
    final access = await client.readAccessToken();
    if (access == null || access.isEmpty) return null;
    try {
      final r = await client.raw.get('/api/auth/me');
      final user = VistaUser.fromJson(
          (r.data['user'] as Map).cast<String, dynamic>());
      if (requiredRole != null && user.role != requiredRole) {
        await client.clearTokens();
        throw RoleMismatchException(requiredRole!, user.role);
      }
      return user;
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        await client.clearTokens();
        return null;
      }
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<void> logout({String? deviceToken}) async {
    if (deviceToken != null && deviceToken.isNotEmpty) {
      try {
        await client.raw.delete('/api/devices/$deviceToken');
      } catch (_) {}
    }
    await client.clearTokens();
  }
}

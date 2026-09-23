import 'package:dio/dio.dart';

import 'api_client.dart';
import 'errors.dart';
import 'models/user.dart';

/// Auth API glue. Handles login (including optional role-mismatch rejection),
/// token persistence, and `/me`.
class AuthRepository {
  AuthRepository(this.client, {this.requiredRole});

  final ApiClient client;

  /// If set, login rejects with [RoleMismatchException] when the server
  /// returns a user whose role != this value, so an app built for one role
  /// can refuse credentials that belong to another.
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

  // ── Account activation ──────────────────────────────────────────────────
  //
  // VISTA has no self-registration: an account exists only where the school has
  // authorized the email address. These three calls let the holder of that
  // address prove it and choose their own password.
  //
  // The server answers `requestActivationCode` identically whether or not the
  // email was ever invited — same words, same timing — so this layer must not
  // try to infer anything from the response. There is nothing in it to read.

  Future<void> requestActivationCode(String email) async {
    try {
      await client.raw.post('/api/auth/activation/request', data: {'email': email});
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  /// Returns the short-lived activation token used by [completeActivation].
  Future<String> verifyActivationCode(String email, String code) async {
    try {
      final r = await client.raw.post('/api/auth/activation/verify', data: {
        'email': email,
        'code': code,
      });
      final token = r.data['activation_token'] as String?;
      if (token == null) {
        throw VistaApiException(r.statusCode, 'Verification response missing token.');
      }
      return token;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  /// Sets the password and signs the parent in — they proved they hold the
  /// address and chose the password in the same session, so there is nothing
  /// further to prove. Password *reset* deliberately does not do this.
  Future<VistaUser> completeActivation(String activationToken, String password) async {
    try {
      final r = await client.raw.post('/api/auth/activation/complete', data: {
        'activation_token': activationToken,
        'password': password,
      });
      final access = r.data['accessToken'] as String?;
      final refresh = r.data['refreshToken'] as String?;
      if (access == null || refresh == null) {
        throw VistaApiException(r.statusCode, 'Activation response missing tokens.');
      }
      final user = VistaUser.fromJson((r.data['user'] as Map).cast<String, dynamic>());
      if (requiredRole != null && user.role != requiredRole) {
        throw RoleMismatchException(requiredRole!, user.role);
      }
      await client.setTokens(access: access, refresh: refresh);
      return user;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  // ── Password reset ──────────────────────────────────────────────────────

  Future<void> requestPasswordReset(String email) async {
    try {
      await client.raw.post('/api/auth/password-reset/request', data: {'email': email});
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<String> verifyPasswordResetCode(String email, String code) async {
    try {
      final r = await client.raw.post('/api/auth/password-reset/verify', data: {
        'email': email,
        'code': code,
      });
      final token = r.data['reset_token'] as String?;
      if (token == null) {
        throw VistaApiException(r.statusCode, 'Verification response missing token.');
      }
      return token;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  /// Returns nothing and signs nobody in. The parent signs in with the new
  /// password, which is the last step that proves the reset landed where it
  /// was meant to.
  Future<void> completePasswordReset(String resetToken, String password) async {
    try {
      await client.raw.post('/api/auth/password-reset/complete', data: {
        'reset_token': resetToken,
        'password': password,
      });
    } on DioException catch (e) {
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

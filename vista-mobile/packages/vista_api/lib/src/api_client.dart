import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'errors.dart';

/// Dio wrapper that mirrors the behaviour of the web dashboard's client:
/// attaches `Authorization: Bearer <access>` on every request, and on 401
/// refreshes via `POST /api/auth/refresh` — single-flight so concurrent
/// failures don't stampede the refresh endpoint.
///
/// Access + refresh tokens are cached in [FlutterSecureStorage] so they
/// survive app restarts without leaking to cleartext preferences.
class ApiClient {
  ApiClient({required this.baseUrl, FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final String baseUrl;
  final FlutterSecureStorage _storage;

  static const _kAccess = 'vista.access';
  static const _kRefresh = 'vista.refresh';

  late final Dio _dio = _buildDio();
  Future<String?>? _refreshInFlight;

  Dio get raw => _dio;

  Dio _buildDio() {
    final d = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
      headers: {'Content-Type': 'application/json'},
    ));

    d.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final access = await _storage.read(key: _kAccess);
        if (access != null && access.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $access';
        }
        handler.next(options);
      },
      onError: (e, handler) async {
        final status = e.response?.statusCode;

        if (status == 423) {
          final data = e.response?.data;
          final reason = data is Map ? data['reason']?.toString() : null;
          return handler.reject(
            DioException(
              requestOptions: e.requestOptions,
              response: e.response,
              error: AcademicAccessSuspended(reason),
            ),
          );
        }

        if (status == 401 && e.requestOptions.path != '/api/auth/refresh') {
          try {
            final newToken = await _refreshAccessToken();
            if (newToken != null) {
              final retried = await _retryWithNewToken(e.requestOptions, newToken);
              return handler.resolve(retried);
            }
          } catch (_) {
            // fall through — let the 401 reach the caller; the UI should log out.
          }
        }

        handler.next(e);
      },
    ));

    return d;
  }

  Future<String?> _refreshAccessToken() {
    // Single-flight: the first caller kicks off the refresh, every other
    // concurrent 401 awaits the same future.
    return _refreshInFlight ??= _refreshImpl().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<String?> _refreshImpl() async {
    final refresh = await _storage.read(key: _kRefresh);
    if (refresh == null || refresh.isEmpty) return null;

    final fresh = Dio(BaseOptions(baseUrl: baseUrl));
    try {
      final r = await fresh.post('/api/auth/refresh',
          data: {'refreshToken': refresh});
      final access = r.data['accessToken'] ?? r.data['token'];
      if (access is String && access.isNotEmpty) {
        await _storage.write(key: _kAccess, value: access);
        return access;
      }
    } on DioException {
      await clearTokens();
    }
    return null;
  }

  Future<Response<dynamic>> _retryWithNewToken(
    RequestOptions original,
    String newToken,
  ) async {
    final opts = Options(
      method: original.method,
      headers: {
        ...original.headers,
        'Authorization': 'Bearer $newToken',
      },
    );
    return _dio.request<dynamic>(
      original.path,
      data: original.data,
      queryParameters: original.queryParameters,
      options: opts,
    );
  }

  Future<void> setTokens({required String access, required String refresh}) async {
    await _storage.write(key: _kAccess, value: access);
    await _storage.write(key: _kRefresh, value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
  }

  Future<String?> readAccessToken() => _storage.read(key: _kAccess);

  /// Convert any DioException into a typed VistaApiException. Safe to call
  /// from repository code that already `try/catch`es.
  static Never rethrowAsVistaException(Object e) {
    if (e is AcademicAccessSuspended) throw e;
    if (e is VistaApiException) throw e;
    if (e is DioException) {
      if (e.error is VistaApiException) throw e.error as VistaApiException;
      final res = e.response;
      final data = res?.data;
      final message = (data is Map && data['error'] is String)
          ? data['error'] as String
          : e.message ?? 'Network error';
      throw VistaApiException(
        res?.statusCode,
        message,
        data: data is Map<String, dynamic> ? data : null,
      );
    }
    throw VistaApiException(null, e.toString());
  }
}

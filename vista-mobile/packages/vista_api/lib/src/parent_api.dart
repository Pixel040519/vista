import 'dart:io';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'models/attendance.dart';
import 'models/authorized_pickup_person.dart';
import 'models/behavior.dart';
import 'models/dismissal.dart';
import 'models/ece.dart';
import 'models/grade.dart';
import 'models/notification.dart';
import 'models/parent_summary.dart';
import 'models/student.dart';
import 'models/user.dart';

/// Thin wrapper around the parent-scoped REST endpoints. Every call goes
/// through [ApiClient] so Bearer auth + 401 refresh are handled upstream.
class ParentApi {
  ParentApi(this.client);

  final ApiClient client;

  Future<List<Student>> children() async {
    try {
      final r = await client.raw.get('/api/students');
      final list = (r.data['students'] as List? ?? r.data as List? ?? const [])
          .cast<Map>()
          .map((m) => Student.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<Student> child(String studentId) async {
    try {
      final r = await client.raw.get('/api/students/$studentId');
      final data = (r.data['student'] as Map? ?? r.data as Map)
          .cast<String, dynamic>();
      return Student.fromJson(data);
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<ParentSummary> summary(String studentId) async {
    try {
      final r = await client.raw.get('/api/ai/parent-summary/$studentId');
      return ParentSummary.fromJson(
          (r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<AttendanceRecord>> attendance(String studentId,
      {String? from, String? to}) async {
    try {
      final r = await client.raw.get('/api/attendance', queryParameters: {
        'student_id': studentId,
        if (from != null) 'start_date': from,
        if (to != null) 'end_date': to,
      });
      final list = (r.data['attendance'] as List? ?? const [])
          .cast<Map>()
          .map((m) => AttendanceRecord.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<Grade>> grades(String studentId, {int? quarter}) async {
    try {
      final r = await client.raw.get('/api/grades', queryParameters: {
        'student_id': studentId,
        if (quarter != null) 'quarter': quarter,
      });
      final list = (r.data['grades'] as List? ?? r.data as List? ?? const [])
          .cast<Map>()
          .map((m) => Grade.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<EceStudentRecords> eceRecords(String studentId,
      {int? quarter, String? syId}) async {
    try {
      final r = await client.raw.get('/api/ece/student-records',
          queryParameters: {
            'student_id': studentId,
            if (quarter != null) 'quarter': quarter,
            if (syId != null) 'sy_id': syId,
          });
      return EceStudentRecords.fromJson((r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<BehaviorLog>> behavior(String studentId) async {
    try {
      final r = await client.raw.get('/api/behavior', queryParameters: {
        'student_id': studentId,
      });
      final list = (r.data['logs'] as List? ?? r.data as List? ?? const [])
          .cast<Map>()
          .map((m) => BehaviorLog.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<DismissalLog>> dismissalLogs({String? studentId}) async {
    try {
      final r = await client.raw.get('/api/dismissal/logs', queryParameters: {
        if (studentId != null) 'student_id': studentId,
      });
      final list = (r.data['logs'] as List? ?? r.data as List? ?? const [])
          .cast<Map>()
          .map((m) => DismissalLog.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  /// Asks the backend for a short-lived pickup QR payload, optionally bound
  /// to a specific fetcher. [fetcherType] is 'self' (parent themself) or
  /// 'auth' (one of the parent's authorized_pickup_persons rows). When 'auth',
  /// [fetcherId] must be the authorized person's UUID.
  Future<PickupQr> generateQr(
    String studentId, {
    String fetcherType = 'self',
    String? fetcherId,
  }) async {
    try {
      final r = await client.raw.post(
        '/api/students/$studentId/generate-qr',
        data: {
          'fetcher_type': fetcherType,
          if (fetcherId != null) 'fetcher_id': fetcherId,
        },
      );
      return PickupQr.fromJson((r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<AuthorizedPickupPerson>> listAuthorizedPersons(String studentId) async {
    try {
      final r = await client.raw.get('/api/pickup-persons',
          queryParameters: {'student_id': studentId});
      final list = (r.data as List? ?? const [])
          .cast<Map>()
          .map((m) => AuthorizedPickupPerson.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<AuthorizedPickupPerson> addAuthorizedPerson({
    required String studentId,
    required String surname,
    required String firstName,
    String? middleName,
    required String relationship,
    required File photo,
  }) async {
    try {
      final form = FormData.fromMap({
        'student_id': studentId,
        'surname': surname,
        'first_name': firstName,
        if (middleName != null && middleName.isNotEmpty) 'middle_name': middleName,
        'relationship': relationship,
        'photo': await MultipartFile.fromFile(photo.path),
      });
      final r = await client.raw.post('/api/pickup-persons', data: form);
      return AuthorizedPickupPerson.fromJson(
          (r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<AuthorizedPickupPerson> updateAuthorizedPerson({
    required String id,
    required String surname,
    required String firstName,
    String? middleName,
    required String relationship,
    File? photo,
  }) async {
    try {
      final form = FormData.fromMap({
        'surname': surname,
        'first_name': firstName,
        if (middleName != null && middleName.isNotEmpty) 'middle_name': middleName,
        'relationship': relationship,
        if (photo != null) 'photo': await MultipartFile.fromFile(photo.path),
      });
      final r = await client.raw.put('/api/pickup-persons/$id', data: form);
      return AuthorizedPickupPerson.fromJson(
          (r.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<void> deleteAuthorizedPerson(String id) async {
    try {
      await client.raw.delete('/api/pickup-persons/$id');
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<VistaUser> uploadProfilePhoto(File photo) async {
    try {
      final form = FormData.fromMap({
        'photo': await MultipartFile.fromFile(photo.path),
      });
      final r = await client.raw.post('/api/profile/me/photo', data: form);
      return VistaUser.fromJson((r.data['user'] as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<List<AppNotification>> notifications() async {
    try {
      final r = await client.raw.get('/api/notifications');
      final list = (r.data['notifications'] as List? ??
              r.data as List? ??
              const [])
          .cast<Map>()
          .map((m) => AppNotification.fromJson(m.cast<String, dynamic>()))
          .toList();
      return list;
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<void> markNotificationRead(String id) async {
    try {
      await client.raw.patch('/api/notifications/$id/read');
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
    } catch (_) {
      // Logout should not fail on a stale token delete.
    }
  }

  Future<VistaUser> updateProfile({
    required String surname,
    required String firstName,
    String? middleName,
    required String phone,
  }) async {
    try {
      final r = await client.raw.put('/api/profile/me', data: {
        'surname': surname,
        'first_name': firstName,
        'middle_name': middleName ?? '',
        'phone': phone,
      });
      return VistaUser.fromJson(
          (r.data['user'] as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await client.raw.patch('/api/profile/me/password', data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      });
    } on DioException catch (e) {
      ApiClient.rethrowAsVistaException(e);
    }
  }
}

class PickupQr {
  PickupQr({required this.payload, required this.expiresAt});
  final String payload;
  final DateTime expiresAt;

  factory PickupQr.fromJson(Map<String, dynamic> json) {
    // Backend returns either `qr_payload` (string) or a nested object.
    final payload = (json['qr_payload'] ?? json['payload'] ?? '').toString();
    final exp = json['expires_at'] ?? json['expiresAt'];
    return PickupQr(
      payload: payload,
      expiresAt: exp is String
          ? DateTime.parse(exp)
          : DateTime.now().add(const Duration(minutes: 2)),
    );
  }
}

class EceStudentRecords {
  EceStudentRecords({
    required this.skills,
    required this.records,
    this.quarter,
    this.schoolYear,
  });

  final List<EceSkill> skills;
  final List<EceRecord> records;
  final int? quarter;
  final String? schoolYear;

  factory EceStudentRecords.fromJson(Map<String, dynamic> json) {
    final skillList = (json['skills'] as List? ?? const [])
        .cast<Map>()
        .map((m) => EceSkill.fromJson(m.cast<String, dynamic>()))
        .toList();
    final recList = (json['records'] as List? ?? const [])
        .cast<Map>()
        .map((m) => EceRecord.fromJson(m.cast<String, dynamic>()))
        .toList();
    final sy = json['school_year'];
    return EceStudentRecords(
      skills: skillList,
      records: recList,
      quarter: json['quarter'] as int?,
      schoolYear: sy is Map ? sy['name'] as String? : sy as String?,
    );
  }
}

import 'dart:io';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'models/announcement.dart';
import 'models/attendance.dart';
import 'models/behavior.dart';
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

  /// Live school announcements for parents, pinned first.
  Future<List<Announcement>> announcements() async {
    try {
      final r = await client.raw.get('/api/announcements');
      return (r.data['announcements'] as List? ?? const [])
          .cast<Map>()
          .map((m) => Announcement.fromJson(m.cast<String, dynamic>()))
          .toList();
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

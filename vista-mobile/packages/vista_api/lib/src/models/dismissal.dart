class DismissalLog {
  DismissalLog({
    required this.id,
    required this.studentId,
    required this.scannedAt,
    required this.status,
    this.studentName,
    this.guardianName,
  });

  final String id;
  final String studentId;
  final DateTime scannedAt;
  final String status; // Success / Expired / Unauthorized
  final String? studentName;
  final String? guardianName;

  bool get isSuccess => status == 'Success';

  factory DismissalLog.fromJson(Map<String, dynamic> json) => DismissalLog(
        id: json['id'].toString(),
        studentId: (json['student_id'] ?? '').toString(),
        scannedAt: DateTime.parse(json['scanned_at'] as String),
        status: (json['status'] ?? '') as String,
        studentName: json['student_name'] as String?,
        guardianName: json['guardian_name'] as String?,
      );
}

class DismissalVerifyResult {
  DismissalVerifyResult({
    required this.message,
    required this.student,
    required this.authorizedGuardian,
    required this.dismissedAt,
  });

  final String message;
  final String student;
  final String authorizedGuardian;
  final DateTime dismissedAt;

  factory DismissalVerifyResult.fromJson(Map<String, dynamic> json) =>
      DismissalVerifyResult(
        message: (json['message'] ?? '') as String,
        student: (json['student'] ?? '') as String,
        authorizedGuardian: (json['authorizedGuardian'] ?? '') as String,
        dismissedAt: DateTime.parse(json['dismissedAt'] as String),
      );
}

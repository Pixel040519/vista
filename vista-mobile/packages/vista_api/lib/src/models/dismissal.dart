class DismissalLog {
  DismissalLog({
    required this.id,
    required this.studentId,
    required this.scannedAt,
    required this.status,
    this.studentName,
    this.guardianName,
    this.gateLabel,
  });

  final String id;
  final String studentId;
  final DateTime scannedAt;
  final String status; // Success / Expired / Unauthorized
  final String? studentName;
  final String? guardianName;
  final String? gateLabel;

  bool get isSuccess => status == 'Success';

  factory DismissalLog.fromJson(Map<String, dynamic> json) => DismissalLog(
        id: json['id'].toString(),
        studentId: (json['student_id'] ?? '').toString(),
        scannedAt: DateTime.parse(json['scanned_at'] as String),
        status: (json['status'] ?? '') as String,
        studentName: json['student_name'] as String?,
        guardianName: json['guardian_name'] as String?,
        gateLabel: json['gate_label'] as String?,
      );
}

class AuthorizedGuardian {
  AuthorizedGuardian({
    required this.id,
    required this.fullName,
    this.relationship,
    this.photoUrl,
    this.kind = 'self',
  });

  final String id;
  final String fullName;
  final String? relationship;
  final String? photoUrl;

  /// 'self' (parent user) or 'auth' (authorized_pickup_persons row). The guard
  /// app forwards this back to /api/dismissal/verify so the server validates
  /// against the right table.
  final String kind;

  factory AuthorizedGuardian.fromJson(Map<String, dynamic> json) =>
      AuthorizedGuardian(
        id: json['id'].toString(),
        fullName: (json['full_name'] ?? '').toString(),
        relationship: json['relationship'] as String?,
        photoUrl: json['photo_url'] as String?,
        kind: (json['kind'] as String?) ?? 'self',
      );
}

class DismissalScanResult {
  DismissalScanResult({
    required this.studentId,
    required this.studentName,
    required this.gradeLevel,
    required this.section,
    required this.authorizedGuardians,
  });

  final String studentId;
  final String studentName;
  final String? gradeLevel;
  final String? section;
  final List<AuthorizedGuardian> authorizedGuardians;

  factory DismissalScanResult.fromJson(Map<String, dynamic> json) {
    final student = (json['student'] as Map).cast<String, dynamic>();
    final guardians = (json['authorizedGuardians'] as List? ?? const [])
        .cast<Map>()
        .map((m) => AuthorizedGuardian.fromJson(m.cast<String, dynamic>()))
        .toList();
    return DismissalScanResult(
      studentId: student['id'].toString(),
      studentName: (student['full_name'] ?? '').toString(),
      gradeLevel: student['grade_level'] as String?,
      section: student['section'] as String?,
      authorizedGuardians: guardians,
    );
  }
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

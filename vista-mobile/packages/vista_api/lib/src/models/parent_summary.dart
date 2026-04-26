class ParentSummary {
  ParentSummary({
    required this.isEce,
    this.riskTier,
    this.riskScore,
    this.riskAssessedAt,
    this.riskAttendanceFactor,
    this.riskAcademicFactor,
    this.riskBehavioralFactor,
    this.riskCompetencyFactor,
    this.attendanceRatePct,
    this.attendancePresentDays = 0,
    this.attendanceTotalDays = 0,
    this.academicAvgGrade,
    this.academicQuarter,
    this.eceRated = 0,
    this.eceTotalSkills = 0,
    this.eceDistribution = const {},
    this.latestBehaviorSentiment,
    this.unreadNotifications = 0,
    this.academicAccessSuspended = false,
    this.academicAccessSuspendedReason,
  });

  final bool isEce;
  final String? riskTier;
  final double? riskScore;
  final DateTime? riskAssessedAt;
  final double? riskAttendanceFactor;
  final double? riskAcademicFactor;
  final double? riskBehavioralFactor;
  final double? riskCompetencyFactor;
  final double? attendanceRatePct;
  final int attendancePresentDays;
  final int attendanceTotalDays;
  final double? academicAvgGrade;
  final int? academicQuarter;
  final int eceRated;
  final int eceTotalSkills;
  final Map<String, int> eceDistribution;
  final String? latestBehaviorSentiment;
  final int unreadNotifications;
  final bool academicAccessSuspended;
  final String? academicAccessSuspendedReason;

  factory ParentSummary.fromJson(Map<String, dynamic> json) {
    final academic = json['academic'] as Map<String, dynamic>?;
    final attendance = json['attendance'] as Map<String, dynamic>?;
    final risk = json['risk'] as Map<String, dynamic>?;
    final factors = (risk?['factors'] as Map?)?.cast<String, dynamic>();
    final behavior = json['latest_behavior'] as Map<String, dynamic>?;
    final student = (json['student'] as Map<String, dynamic>?) ?? const {};
    final dist = (academic?['distribution'] as Map?)?.cast<String, dynamic>();
    return ParentSummary(
      isEce: json['is_ece'] == true,
      riskTier: risk?['tier'] as String?,
      riskScore: _toDouble(risk?['score']),
      riskAssessedAt: _toDate(risk?['assessed_at']),
      riskAttendanceFactor: _toDouble(factors?['attendance']),
      riskAcademicFactor: _toDouble(factors?['academic']),
      riskBehavioralFactor: _toDouble(factors?['behavioral']),
      riskCompetencyFactor: _toDouble(factors?['competency']),
      attendanceRatePct: _toDouble(attendance?['rate_pct']),
      attendancePresentDays: (attendance?['present_days'] ?? 0) as int,
      attendanceTotalDays: (attendance?['total_days'] ?? 0) as int,
      academicAvgGrade: _toDouble(academic?['avg_grade']),
      academicQuarter: academic?['quarter'] as int?,
      eceRated: (academic?['rated'] ?? 0) as int,
      eceTotalSkills: (academic?['total_skills'] ?? 0) as int,
      eceDistribution: dist == null
          ? const {}
          : dist.map((k, v) => MapEntry(k, (v as num).toInt())),
      latestBehaviorSentiment: behavior?['sentiment'] as String?,
      unreadNotifications: (json['unread_notifications'] ?? 0) as int,
      academicAccessSuspended: student['academic_access_suspended'] == true,
      academicAccessSuspendedReason:
          student['academic_access_suspended_reason'] as String?,
    );
  }
}

double? _toDouble(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

DateTime? _toDate(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse(v.toString());
}

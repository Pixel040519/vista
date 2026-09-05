class Grade {
  Grade({
    required this.subjectName,
    required this.quarter,
    this.score,
    this.grade,
    this.remarks,
    this.schoolYear,
    this.parentSubjectName,
  });

  final String subjectName;
  final int quarter;
  final double? score;
  final double? grade;
  final String? remarks;
  final String? schoolYear;

  /// The learning area this row belongs to, or null when it IS one.
  ///
  /// MAPEH is graded through four areas -- Music, Arts, Physical Education,
  /// Health -- and the API returns all five rows: the four areas plus the MAPEH
  /// grade averaged from them. Anything that counts learning areas (the quarter
  /// average, a report-card row) must use only the rows where this is null, or
  /// MAPEH is weighed five times against every other subject.
  final String? parentSubjectName;

  /// True for MAPEH's Music/Arts/PE/Health rows, false for a learning area.
  bool get isArea => parentSubjectName != null;

  factory Grade.fromJson(Map<String, dynamic> json) => Grade(
        subjectName: (json['subject_name'] ?? '') as String,
        quarter: (json['quarter'] ?? 0) as int,
        score: _toDouble(json['score']),
        grade: _toDouble(json['grade']),
        remarks: json['remarks'] as String?,
        schoolYear: json['school_year'] as String?,
        parentSubjectName: json['parent_subject_name'] as String?,
      );
}

double? _toDouble(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

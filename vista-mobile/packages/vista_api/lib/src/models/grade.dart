class Grade {
  Grade({
    required this.subjectName,
    required this.quarter,
    this.score,
    this.grade,
    this.remarks,
    this.schoolYear,
  });

  final String subjectName;
  final int quarter;
  final double? score;
  final double? grade;
  final String? remarks;
  final String? schoolYear;

  factory Grade.fromJson(Map<String, dynamic> json) => Grade(
        subjectName: (json['subject_name'] ?? '') as String,
        quarter: (json['quarter'] ?? 0) as int,
        score: _toDouble(json['score']),
        grade: _toDouble(json['grade']),
        remarks: json['remarks'] as String?,
        schoolYear: json['school_year'] as String?,
      );
}

double? _toDouble(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

class AttendanceRecord {
  AttendanceRecord({
    required this.id,
    required this.date,
    required this.status,
    this.subjectName,
    this.remarks,
    this.recordedByName,
  });

  final String id;
  final DateTime date;
  final String status; // Present / Absent / Late / Excused
  final String? subjectName;
  final String? remarks;
  final String? recordedByName;

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) =>
      AttendanceRecord(
        id: json['id'].toString(),
        date: DateTime.parse(json['date'] as String),
        status: json['status'] as String,
        subjectName: json['subject_name'] as String?,
        remarks: json['remarks'] as String?,
        recordedByName: json['recorded_by_name'] as String?,
      );
}

class AttendanceSummary {
  AttendanceSummary({
    this.present = 0,
    this.absent = 0,
    this.late = 0,
    this.excused = 0,
    this.total = 0,
  });

  final int present;
  final int absent;
  final int late;
  final int excused;
  final int total;

  factory AttendanceSummary.fromJson(Map<String, dynamic> json) =>
      AttendanceSummary(
        present: (json['Present'] ?? 0) as int,
        absent: (json['Absent'] ?? 0) as int,
        late: (json['Late'] ?? 0) as int,
        excused: (json['Excused'] ?? 0) as int,
        total: (json['total'] ?? 0) as int,
      );
}

class Student {
  Student({
    required this.id,
    required this.fullName,
    required this.gradeLevel,
    this.section,
    this.lrn,
    this.profilePhotoUrl,
    this.academicAccessSuspended = false,
    this.academicAccessSuspendedReason,
    this.guardians = const [],
  });

  final String id;
  final String fullName;
  final String gradeLevel;
  final String? section;
  final String? lrn;
  final String? profilePhotoUrl;
  final bool academicAccessSuspended;
  final String? academicAccessSuspendedReason;
  final List<Guardian> guardians;

  bool get isEce => const {
        'Kinder',
      }.contains(gradeLevel);

  factory Student.fromJson(Map<String, dynamic> json) => Student(
        id: json['id'].toString(),
        fullName: (json['full_name'] ?? '') as String,
        gradeLevel: (json['grade_level'] ?? '') as String,
        section: json['section'] as String?,
        lrn: json['lrn'] as String?,
        profilePhotoUrl: json['profile_photo_url'] as String?,
        academicAccessSuspended:
            json['academic_access_suspended'] == true,
        academicAccessSuspendedReason:
            json['academic_access_suspended_reason'] as String?,
        guardians: ((json['guardians'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(Guardian.fromJson)
            .toList(),
      );
}

class Guardian {
  Guardian({
    required this.id,
    required this.fullName,
    this.relationship,
    this.isEmergencyContact = false,
  });

  final String id;
  final String fullName;
  final String? relationship;
  final bool isEmergencyContact;

  factory Guardian.fromJson(Map<String, dynamic> json) => Guardian(
        id: json['id'].toString(),
        fullName: (json['full_name'] ?? '') as String,
        relationship: json['relationship'] as String?,
        isEmergencyContact: json['is_emergency_contact'] == true,
      );
}

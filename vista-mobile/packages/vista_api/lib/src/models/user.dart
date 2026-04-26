class VistaUser {
  VistaUser({
    required this.id,
    required this.email,
    required this.role,
    required this.fullName,
    this.surname,
    this.firstName,
    this.middleName,
    this.phone,
    this.photoUrl,
    this.gradeScope = const [],
  });

  final String id;
  final String email;
  final String role;
  final String fullName;
  final String? surname;
  final String? firstName;
  final String? middleName;
  final String? phone;
  final String? photoUrl;
  final List<String> gradeScope;

  static const roleParent = 'parent';
  static const roleSecurityGuard = 'security_guard';

  bool get isParent => role == roleParent;
  bool get isSecurityGuard => role == roleSecurityGuard;

  factory VistaUser.fromJson(Map<String, dynamic> json) => VistaUser(
        id: json['id'].toString(),
        email: json['email'] as String,
        role: json['role'] as String,
        fullName: (json['full_name'] ?? json['fullName'] ?? '') as String,
        surname: json['surname'] as String?,
        firstName: (json['first_name'] ?? json['firstName']) as String?,
        middleName: (json['middle_name'] ?? json['middleName']) as String?,
        phone: json['phone'] as String?,
        photoUrl: (json['photo_url'] ?? json['photoUrl']) as String?,
        gradeScope: (json['grade_scope'] as List?)?.cast<String>() ?? const [],
      );
}

class VistaUser {
  VistaUser({
    required this.id,
    required this.email,
    required this.role,
    required this.fullName,
    this.phone,
    this.gradeScope = const [],
  });

  final String id;
  final String email;
  final String role;
  final String fullName;
  final String? phone;
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
        phone: json['phone'] as String?,
        gradeScope: (json['grade_scope'] as List?)?.cast<String>() ?? const [],
      );
}

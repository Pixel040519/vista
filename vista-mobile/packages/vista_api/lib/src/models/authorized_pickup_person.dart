/// Non-account fetcher (yaya, lola, driver, …) a parent has authorized to
/// pick up a specific child. Backed by the `authorized_pickup_persons` table.
class AuthorizedPickupPerson {
  AuthorizedPickupPerson({
    required this.id,
    required this.studentId,
    required this.surname,
    required this.firstName,
    this.middleName,
    required this.relationship,
    required this.fullName,
    this.photoUrl,
  });

  final String id;
  final String studentId;
  final String surname;
  final String firstName;
  final String? middleName;
  final String relationship;
  final String fullName;
  final String? photoUrl;

  factory AuthorizedPickupPerson.fromJson(Map<String, dynamic> json) {
    final surname = (json['surname'] ?? '').toString();
    final firstName = (json['first_name'] ?? json['firstName'] ?? '').toString();
    final middleName = json['middle_name'] as String? ?? json['middleName'] as String?;
    final composed = [
      firstName,
      if (middleName != null && middleName.isNotEmpty) middleName,
      surname,
    ].where((s) => s.isNotEmpty).join(' ').trim();
    return AuthorizedPickupPerson(
      id: json['id'].toString(),
      studentId: (json['student_id'] ?? json['studentId'] ?? '').toString(),
      surname: surname,
      firstName: firstName,
      middleName: middleName,
      relationship: (json['relationship'] ?? '').toString(),
      fullName: (json['full_name'] as String?) ?? composed,
      photoUrl: json['photo_url'] as String?,
    );
  }
}

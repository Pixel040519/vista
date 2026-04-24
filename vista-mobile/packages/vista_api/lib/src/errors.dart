class VistaApiException implements Exception {
  VistaApiException(this.statusCode, this.message, {this.data});
  final int? statusCode;
  final String message;
  final Map<String, dynamic>? data;

  @override
  String toString() => 'VistaApiException($statusCode): $message';
}

/// HTTP 423 Locked — server signals that the parent's academic view for this
/// student is suspended by admin. The Academics tab renders a reason screen
/// instead of the usual content.
class AcademicAccessSuspended extends VistaApiException {
  AcademicAccessSuspended(this.reason)
      : super(423, reason ?? 'Academic access is temporarily suspended.',
            data: {'reason': reason});
  final String? reason;
}

/// The mobile app tried to sign in with credentials that belong to the wrong
/// role (e.g., a parent signing in on vista_guard). Thrown by AuthRepository
/// so the login UI can show a specific "this app is for guards only" message.
class RoleMismatchException extends VistaApiException {
  RoleMismatchException(this.expectedRole, this.actualRole)
      : super(403,
            'This app is only available for $expectedRole accounts. Signed-in role: $actualRole');
  final String expectedRole;
  final String actualRole;
}

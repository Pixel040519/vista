class AppNotification {
  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.sentAt,
    this.type,
    this.referenceId,
    this.isRead = false,
  });

  final String id;
  final String title;
  final String body;
  final DateTime sentAt;
  final String? type;
  final String? referenceId;
  final bool isRead;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'].toString(),
        title: (json['title'] ?? '') as String,
        body: (json['body'] ?? '') as String,
        sentAt: DateTime.parse(json['sent_at'] as String),
        type: json['type'] as String?,
        referenceId: json['reference_id']?.toString(),
        isRead: json['is_read'] == true,
      );
}

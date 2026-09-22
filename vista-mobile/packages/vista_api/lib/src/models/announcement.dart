/// A school announcement, as `GET /api/announcements` returns it to a parent:
/// only posts that are live and addressed to parents (or everyone).
class Announcement {
  Announcement({
    required this.id,
    required this.title,
    required this.content,
    required this.category,
    required this.publishedAt,
    this.summary,
    this.imageUrl,
    this.isPinned = false,
  });

  final String id;
  final String title;
  final String content;
  final String category;
  final DateTime publishedAt;
  final String? summary;
  final String? imageUrl;
  final bool isPinned;

  /// The one-line version for cards: the summary if the school wrote one.
  String get preview => (summary != null && summary!.isNotEmpty) ? summary! : content;

  factory Announcement.fromJson(Map<String, dynamic> json) => Announcement(
        id: json['id'].toString(),
        title: (json['title'] ?? '') as String,
        content: (json['content'] ?? '') as String,
        category: (json['category'] ?? 'General') as String,
        publishedAt: DateTime.parse(
                (json['published_at'] ?? json['created_at']) as String)
            .toLocal(),
        summary: json['summary'] as String?,
        imageUrl: json['image_url'] as String?,
        isPinned: json['is_pinned'] == true,
      );
}

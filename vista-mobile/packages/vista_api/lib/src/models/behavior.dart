class BehaviorLog {
  BehaviorLog({
    required this.id,
    required this.observation,
    required this.observedAt,
    this.category,
    this.sentiment,
    this.sentimentScore,
    this.teacherName,
  });

  final String id;
  final String observation;
  final DateTime observedAt;
  final String? category;
  final String? sentiment; // Positive / Neutral / Negative
  final double? sentimentScore;
  final String? teacherName;

  factory BehaviorLog.fromJson(Map<String, dynamic> json) => BehaviorLog(
        id: json['id'].toString(),
        observation: (json['observation'] ?? '') as String,
        observedAt: DateTime.parse(json['observed_at'] as String),
        category: json['category'] as String?,
        sentiment: json['sentiment'] as String?,
        sentimentScore: _toDouble(json['sentiment_score']),
        teacherName: json['teacher_name'] as String?,
      );
}

double? _toDouble(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

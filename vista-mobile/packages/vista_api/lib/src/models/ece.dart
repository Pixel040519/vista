class EceSkill {
  EceSkill({
    required this.id,
    required this.subjectId,
    required this.subjectName,
    required this.name,
    this.description,
    this.displayOrder = 0,
  });

  final String id;
  final String subjectId;
  final String subjectName;
  final String name;
  final String? description;
  final int displayOrder;

  factory EceSkill.fromJson(Map<String, dynamic> json) => EceSkill(
        id: json['id'].toString(),
        subjectId: (json['subject_id'] ?? '').toString(),
        subjectName: (json['subject_name'] ?? '') as String,
        name: (json['name'] ?? '') as String,
        description: json['description'] as String?,
        displayOrder: (json['display_order'] ?? 0) as int,
      );
}

class EceRecord {
  EceRecord({
    required this.skillId,
    required this.rating,
    this.notes,
  });

  final String skillId;
  final String rating; // E / G / F / NA
  final String? notes;

  factory EceRecord.fromJson(Map<String, dynamic> json) => EceRecord(
        skillId: (json['skill_id'] ?? '').toString(),
        rating: (json['rating'] ?? '') as String,
        notes: json['notes'] as String?,
      );
}

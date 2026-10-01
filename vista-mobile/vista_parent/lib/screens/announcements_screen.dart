import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';

/// Every live school announcement addressed to parents, pinned first.
/// [highlightId] opens that post expanded — set when arriving from a push or
/// from the notifications list.
class AnnouncementsScreen extends ConsumerWidget {
  const AnnouncementsScreen({super.key, this.highlightId});
  final String? highlightId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(announcementsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('School Announcements')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(announcementsProvider);
          await ref.read(announcementsProvider.future);
        },
        child: list.when(
          loading: () => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            children: const [
              SizedBox(height: 120),
              Center(child: CircularProgressIndicator()),
            ],
          ),
          error: (e, _) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Text('Unable to load announcements.\n$e',
                  style: const TextStyle(color: Colors.black54)),
            ],
          ),
          data: (items) {
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  Icon(Icons.campaign_outlined, size: 64, color: Colors.black26),
                  SizedBox(height: 12),
                  Center(
                    child: Text('No announcements right now.',
                        style: TextStyle(color: Colors.black54)),
                  ),
                ],
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => AnnouncementCard(
                announcement: items[i],
                initiallyExpanded: items[i].id == highlightId,
              ),
            );
          },
        ),
      ),
    );
  }
}

/// One announcement. Collapsed it shows the opening lines; tapping expands it to
/// the full text. Also used, collapsed, on the home screen.
class AnnouncementCard extends StatefulWidget {
  const AnnouncementCard({
    super.key,
    required this.announcement,
    this.initiallyExpanded = false,
    this.onTap,
  });

  final Announcement announcement;
  final bool initiallyExpanded;

  /// Overrides expand-on-tap (the home screen opens the full list instead).
  final VoidCallback? onTap;

  @override
  State<AnnouncementCard> createState() => _AnnouncementCardState();
}

class _AnnouncementCardState extends State<AnnouncementCard> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final a = widget.announcement;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: widget.onTap ?? () => setState(() => _expanded = !_expanded),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (a.imageUrl != null && (_expanded || widget.onTap == null))
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Image.network(
                  a.imageUrl!,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) =>
                      Container(color: VistaColors.brand.withValues(alpha: 0.08)),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _Tag(a.category),
                      if (a.isPinned) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.push_pin, size: 14, color: VistaColors.brand),
                      ],
                      const Spacer(),
                      Text(
                        DateFormat.yMMMd().format(a.publishedAt),
                        style: const TextStyle(fontSize: 12, color: Colors.black54),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    a.title,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w700, color: VistaColors.navy950),
                  ),
                  const SizedBox(height: 4),
                  if (_expanded)
                    SelectableText(a.content,
                        style: const TextStyle(color: Colors.black87, height: 1.45))
                  else
                    Text(
                      a.content,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.black54, height: 1.4),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: VistaColors.brand.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label.toUpperCase(),
          style: const TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: VistaColors.brand),
        ),
      );
}

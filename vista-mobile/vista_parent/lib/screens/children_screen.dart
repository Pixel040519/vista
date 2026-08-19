import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers.dart';
import '../theme.dart';
import '../widgets/risk_chip.dart';

class ChildrenScreen extends ConsumerWidget {
  const ChildrenScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final children = ref.watch(childrenProvider);
    final unread = ref.watch(notificationsProvider).valueOrNull
            ?.where((n) => !n.isRead)
            .length ??
        0;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        title: Row(
          children: [
            ClipOval(
              child: SizedBox(
                width: 36,
                height: 36,
                child: Semantics(
                  label: 'NRYS school logo',
                  child: Image.asset(
                    'assets/images/nrys_logo.png',
                    fit: BoxFit.cover,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'NRYS',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                      height: 1.1,
                    ),
                  ),
                  Text(
                    'VISTA Parent',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.notifications_outlined),
                if (unread > 0)
                  Positioned(
                    right: -4,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                          color: VistaColors.danger, shape: BoxShape.circle),
                      constraints:
                          const BoxConstraints(minWidth: 16, minHeight: 16),
                      child: Text(
                        unread > 9 ? '9+' : '$unread',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w700),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
              ],
            ),
            onPressed: () => context.push('/notifications'),
          ),
          IconButton(
            tooltip: 'Profile',
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(childrenProvider);
          ref.invalidate(notificationsProvider);
          await ref.read(childrenProvider.future);
        },
        child: children.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
            children: [
              const _SectionTitle(count: null),
              const SizedBox(height: 16),
              Text('Unable to load children.\n$e',
                  style: const TextStyle(color: Colors.black54)),
            ],
          ),
          data: (list) {
            if (list.isEmpty) {
              return ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
                children: const [
                  _SectionTitle(count: 0),
                  SizedBox(height: 80),
                  Icon(Icons.family_restroom,
                      size: 72, color: Colors.black26),
                  SizedBox(height: 12),
                  Center(
                    child: Text(
                      'No children linked to your account yet.\nPlease contact the school office.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.black54),
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
              itemBuilder: (c, i) {
                if (i == 0) return _SectionTitle(count: list.length);
                return _ChildCard(student: list[i - 1]);
              },
              separatorBuilder: (_, i) =>
                  SizedBox(height: i == 0 ? 16 : 12),
              itemCount: list.length + 1,
            );
          },
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.count});
  final int? count;

  @override
  Widget build(BuildContext context) {
    final subtitle = count == null
        ? null
        : count == 1
            ? '1 student linked to your account'
            : '$count students linked to your account';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 4,
          height: 36,
          decoration: BoxDecoration(
            color: VistaColors.brand,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'My Children',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                  height: 1.15,
                  color: VistaColors.navy950,
                ),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0.1,
                    color: Colors.black54,
                  ),
                ),
              ],
            ],
          ),
        ),
        if (count != null && count! > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: VistaColors.brand.withOpacity(0.10),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$count',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: VistaColors.brand,
              ),
            ),
          ),
      ],
    );
  }
}

class _ChildCard extends ConsumerWidget {
  const _ChildCard({required this.student});
  final dynamic student;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = ref.watch(parentSummaryProvider(student.id));
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          ref.read(selectedChildIdProvider.notifier).state = student.id;
          context.push('/child/${student.id}');
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: VistaColors.brand.withOpacity(0.12),
                child: Text(
                  student.fullName.isEmpty
                      ? '?'
                      : student.fullName[0].toUpperCase(),
                  style: const TextStyle(
                      color: VistaColors.brand,
                      fontWeight: FontWeight.w700,
                      fontSize: 22),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      student.fullName,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${student.gradeLevel}'
                      '${student.section != null ? ' • ${student.section}' : ''}',
                      style: const TextStyle(color: Colors.black54),
                    ),
                    const SizedBox(height: 8),
                    summary.when(
                      loading: () => const SizedBox(
                          height: 18,
                          width: 60,
                          child: LinearProgressIndicator(minHeight: 2)),
                      error: (_, __) =>
                          const Text('—', style: TextStyle(color: Colors.black45)),
                      data: (s) => Row(
                        children: [
                          RiskChip(s.riskTier),
                          if (s.attendanceRatePct != null) ...[
                            const SizedBox(width: 8),
                            Text(
                              '${s.attendanceRatePct!.toStringAsFixed(0)}% attendance',
                              style: const TextStyle(
                                  color: Colors.black54, fontSize: 12),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.black38),
            ],
          ),
        ),
      ),
    );
  }
}

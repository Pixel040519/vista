import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';
import '../widgets/locked_screen.dart';
import '../widgets/risk_chip.dart';

const _tabNames = ['overview', 'attendance', 'academics', 'behavior', 'qr', 'dismissal'];

class ChildDetailScreen extends ConsumerStatefulWidget {
  const ChildDetailScreen({
    super.key,
    required this.studentId,
    this.initialTab,
  });

  final String studentId;
  final String? initialTab;

  @override
  ConsumerState<ChildDetailScreen> createState() => _ChildDetailScreenState();
}

class _ChildDetailScreenState extends ConsumerState<ChildDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tab;

  @override
  void initState() {
    super.initState();
    final idx = _tabNames.indexOf(widget.initialTab ?? 'overview');
    _tab = TabController(
      length: _tabNames.length,
      vsync: this,
      initialIndex: idx < 0 ? 0 : idx,
    );
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final children = ref.watch(childrenProvider).valueOrNull ?? const [];
    final student = children
        .where((s) => s.id == widget.studentId)
        .cast<Student?>()
        .firstOrNull;

    final isEce = student?.isEce ?? false;

    return Scaffold(
      appBar: AppBar(
        title: Text(student?.fullName ?? 'Child'),
        bottom: TabBar(
          controller: _tab,
          isScrollable: true,
          indicatorColor: Colors.white,
          tabs: [
            const Tab(text: 'Overview'),
            const Tab(text: 'Attendance'),
            Tab(text: isEce ? 'ECE' : 'Academics'),
            const Tab(text: 'Behavior'),
            const Tab(text: 'Pickup QR'),
            const Tab(text: 'Dismissal'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [
          _OverviewTab(studentId: widget.studentId),
          _AttendanceTab(studentId: widget.studentId),
          _AcademicsTab(student: student),
          _BehaviorTab(studentId: widget.studentId),
          _PickupQrTab(studentId: widget.studentId),
          _DismissalTab(studentId: widget.studentId),
        ],
      ),
    );
  }
}

/* ─────────────────────────── Overview ─────────────────────────── */

class _OverviewTab extends ConsumerWidget {
  const _OverviewTab({required this.studentId});
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = ref.watch(parentSummaryProvider(studentId));
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(parentSummaryProvider(studentId));
        await ref.read(parentSummaryProvider(studentId).future);
      },
      child: summary.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(
          padding: const EdgeInsets.all(16),
          children: [Text('Unable to load summary.\n$e')],
        ),
        data: (s) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _StatCard(
              label: 'Risk',
              child: RiskChip(s.riskTier),
            ),
            const SizedBox(height: 12),
            _StatCard(
              label: 'Attendance (last 30 days)',
              value: s.attendanceRatePct == null
                  ? '—'
                  : '${s.attendanceRatePct!.toStringAsFixed(0)}%',
              subtitle:
                  '${s.attendancePresentDays} of ${s.attendanceTotalDays} days present',
            ),
            const SizedBox(height: 12),
            if (s.isEce)
              _StatCard(
                label: 'ECE competency',
                value: '${s.eceRated} / ${s.eceTotalSkills}',
                subtitle: 'skills rated this quarter',
              )
            else
              _StatCard(
                label: 'Academic average',
                value: s.academicAvgGrade == null
                    ? '—'
                    : s.academicAvgGrade!.toStringAsFixed(1),
                subtitle: s.academicQuarter == null
                    ? 'Current quarter'
                    : 'Quarter ${s.academicQuarter}',
              ),
            const SizedBox(height: 12),
            _StatCard(
              label: 'Recent behavior',
              value: s.latestBehaviorSentiment ?? '—',
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, this.value, this.subtitle, this.child});
  final String label;
  final String? value;
  final String? subtitle;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            if (child != null)
              child!
            else
              Text(
                value ?? '—',
                style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: VistaColors.navy950),
              ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(subtitle!,
                  style:
                      const TextStyle(color: Colors.black54, fontSize: 12)),
            ],
          ],
        ),
      ),
    );
  }
}

/* ─────────────────────────── Attendance ─────────────────────────── */

final _attendanceFamily = FutureProvider.family<List<AttendanceRecord>, String>(
    (ref, id) => ref.watch(parentApiProvider).attendance(id));

class _AttendanceTab extends ConsumerWidget {
  const _AttendanceTab({required this.studentId});
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final records = ref.watch(_attendanceFamily(studentId));
    return records.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _errorList('Unable to load attendance.\n$e'),
      data: (list) => ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: list.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (c, i) {
          final r = list[i];
          return ListTile(
            leading: _attendanceIcon(r.status),
            title: Text(DateFormat.yMMMEd().format(r.date)),
            subtitle: Text(r.subjectName ?? ''),
            trailing: Text(r.status,
                style: const TextStyle(fontWeight: FontWeight.w600)),
          );
        },
      ),
    );
  }

  Widget _attendanceIcon(String status) {
    switch (status) {
      case 'Present':
        return const Icon(Icons.check_circle, color: VistaColors.success);
      case 'Late':
        return const Icon(Icons.schedule, color: VistaColors.warn);
      case 'Absent':
        return const Icon(Icons.cancel, color: VistaColors.danger);
      default:
        return const Icon(Icons.help_outline, color: Colors.black45);
    }
  }
}

/* ─────────────────────────── Academics ─────────────────────────── */

final _gradesFamily = FutureProvider.family<List<Grade>, String>(
    (ref, id) => ref.watch(parentApiProvider).grades(id));

final _eceFamily = FutureProvider.family<EceStudentRecords, String>(
    (ref, id) => ref.watch(parentApiProvider).eceRecords(id));

class _AcademicsTab extends ConsumerWidget {
  const _AcademicsTab({required this.student});
  final Student? student;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (student == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (student!.academicAccessSuspended) {
      return LockedScreen(reason: student!.academicAccessSuspendedReason);
    }
    return student!.isEce
        ? _EceAcademics(studentId: student!.id)
        : _GradeAcademics(studentId: student!.id);
  }
}

class _GradeAcademics extends ConsumerWidget {
  const _GradeAcademics({required this.studentId});
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final grades = ref.watch(_gradesFamily(studentId));
    return grades.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) {
        if (e is AcademicAccessSuspended) {
          return LockedScreen(reason: e.reason);
        }
        return _errorList('Unable to load grades.\n$e');
      },
      data: (list) => ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: list.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (c, i) {
          final g = list[i];
          return Card(
            child: ListTile(
              title: Text(g.subjectName ?? ''),
              subtitle: Text('Quarter ${g.quarter}'),
              trailing: Text(
                g.grade?.toStringAsFixed(1) ?? '—',
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w700),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _EceAcademics extends ConsumerWidget {
  const _EceAcademics({required this.studentId});
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ece = ref.watch(_eceFamily(studentId));
    return ece.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) {
        if (e is AcademicAccessSuspended) {
          return LockedScreen(reason: e.reason);
        }
        return _errorList('Unable to load ECE records.\n$e');
      },
      data: (data) {
        final ratingsBySkill = {
          for (final r in data.records) r.skillId: r,
        };
        // Group skills by subject.
        final bySubject = <String, List<EceSkill>>{};
        for (final s in data.skills) {
          bySubject.putIfAbsent(s.subjectName, () => []).add(s);
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: bySubject.entries.map((e) {
            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(e.key,
                        style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: VistaColors.navy950)),
                    const SizedBox(height: 8),
                    ...e.value.map((skill) {
                      final rating = ratingsBySkill[skill.id]?.rating;
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Expanded(child: Text(skill.name)),
                            _EceBadge(rating),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            );
          }).toList(),
        );
      },
    );
  }
}

class _EceBadge extends StatelessWidget {
  const _EceBadge(this.rating);
  final String? rating;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, label) = switch (rating) {
      'E' => (const Color(0xFFE6F4EA), VistaColors.success, 'Excellent'),
      'G' => (const Color(0xFFE3F2FD), Colors.blue.shade700, 'Good'),
      'F' => (const Color(0xFFFFF4E5), VistaColors.warn, 'Fair'),
      'NA' => (const Color(0xFFFDECEA), VistaColors.danger, 'Needs assist.'),
      _ => (const Color(0xFFEEF1F7), Colors.black54, 'Not rated'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label,
          style: TextStyle(
              color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/* ─────────────────────────── Behavior ─────────────────────────── */

final _behaviorFamily = FutureProvider.family<List<BehaviorLog>, String>(
    (ref, id) => ref.watch(parentApiProvider).behavior(id));

class _BehaviorTab extends ConsumerWidget {
  const _BehaviorTab({required this.studentId});
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logs = ref.watch(_behaviorFamily(studentId));
    return logs.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _errorList('Unable to load behavior.\n$e'),
      data: (list) {
        if (list.isEmpty) {
          return const Center(
              child: Text('No behavior observations yet.',
                  style: TextStyle(color: Colors.black54)));
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (c, i) {
            final b = list[i];
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        _SentimentChip(b.sentiment),
                        const Spacer(),
                        Text(DateFormat.yMMMd().format(b.observedAt),
                            style: const TextStyle(
                                color: Colors.black45, fontSize: 12)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(b.observation),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _SentimentChip extends StatelessWidget {
  const _SentimentChip(this.sentiment);
  final String? sentiment;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (sentiment) {
      'Positive' => (const Color(0xFFE6F4EA), VistaColors.success),
      'Negative' => (const Color(0xFFFDECEA), VistaColors.danger),
      _ => (const Color(0xFFEEF1F7), Colors.black54),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(sentiment ?? 'Neutral',
          style: TextStyle(
              color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/* ─────────────────────────── Pickup QR ─────────────────────────── */

class _PickupQrTab extends ConsumerStatefulWidget {
  const _PickupQrTab({required this.studentId});
  final String studentId;

  @override
  ConsumerState<_PickupQrTab> createState() => _PickupQrTabState();
}

class _PickupQrTabState extends ConsumerState<_PickupQrTab> {
  PickupQr? _qr;
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _regenerate();
  }

  Future<void> _regenerate() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final qr = await ref.read(parentApiProvider).generateQr(widget.studentId);
      if (!mounted) return;
      setState(() => _qr = qr);
    } on VistaApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _qr == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_error!, style: const TextStyle(color: VistaColors.danger)),
            const SizedBox(height: 16),
            FilledButton(onPressed: _regenerate, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_qr == null) return const SizedBox.shrink();

    final remaining = _qr!.expiresAt.difference(DateTime.now());
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text(
            'Show this at the gate',
            style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: VistaColors.navy950),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFDDE2EC)),
            ),
            child: QrImageView(
              data: _qr!.payload,
              size: 240,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            remaining.isNegative
                ? 'Expired — tap Refresh'
                : 'Expires in ${remaining.inMinutes}m ${remaining.inSeconds % 60}s',
            style: const TextStyle(color: Colors.black54),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _loading ? null : _regenerate,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh QR'),
          ),
        ],
      ),
    );
  }
}

/* ─────────────────────────── Dismissal ─────────────────────────── */

final _dismissalFamily = FutureProvider.family<List<DismissalLog>, String>(
    (ref, id) => ref.watch(parentApiProvider).dismissalLogs(studentId: id));

class _DismissalTab extends ConsumerWidget {
  const _DismissalTab({required this.studentId});
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logs = ref.watch(_dismissalFamily(studentId));
    return logs.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _errorList('Unable to load dismissal history.\n$e'),
      data: (list) {
        if (list.isEmpty) {
          return const Center(
              child: Text('No pickup history yet.',
                  style: TextStyle(color: Colors.black54)));
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: list.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (c, i) {
            final l = list[i];
            return ListTile(
              leading: Icon(
                l.isSuccess ? Icons.check_circle : Icons.cancel,
                color: l.isSuccess ? VistaColors.success : VistaColors.danger,
              ),
              title: Text(l.guardianName ?? 'Unknown guardian'),
              subtitle: Text(DateFormat.yMMMd().add_jm().format(l.scannedAt)),
              trailing: Text(l.status,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            );
          },
        );
      },
    );
  }
}

Widget _errorList(String message) => ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(message, style: const TextStyle(color: Colors.black54)),
      ],
    );

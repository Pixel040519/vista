import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gal/gal.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';
import '../widgets/locked_screen.dart';
import '../widgets/risk_chip.dart';
import 'authorized_persons_screen.dart';

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

  void _jumpToTab(String name) {
    final i = _tabNames.indexOf(name);
    if (i >= 0) _tab.animateTo(i);
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
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
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
          _OverviewTab(studentId: widget.studentId, onJumpToTab: _jumpToTab),
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
  const _OverviewTab({required this.studentId, required this.onJumpToTab});
  final String studentId;
  final void Function(String tab) onJumpToTab;

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
            _RiskCard(summary: s, onJumpToTab: onJumpToTab),
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

/* ─────────────────────────── Risk card ─────────────────────────── */

class _RiskDriver {
  const _RiskDriver(this.text, this.tab, this.severity);
  final String text;
  final String tab;
  final double severity; // lower = worse, used for sort
}

List<_RiskDriver> _driversFor(ParentSummary s) {
  final tier = s.riskTier;
  if (tier == null || tier == 'Stable') return const [];
  final out = <_RiskDriver>[];

  final att = s.riskAttendanceFactor;
  if (att != null && att < 0.85) {
    out.add(_RiskDriver(
        'Attendance has dropped recently', 'attendance', att));
  }

  if (s.isEce) {
    final comp = s.riskCompetencyFactor;
    if (comp != null && comp < 0.70) {
      out.add(_RiskDriver(
          'Competency progress is behind pace this quarter',
          'academics',
          comp));
    }
  } else {
    final acad = s.riskAcademicFactor;
    if (acad != null && acad < 0.80) {
      out.add(_RiskDriver(
          'Quarter grades have slipped below passing', 'academics', acad));
    }
  }

  final beh = s.riskBehavioralFactor;
  if (beh != null && beh < 0.0) {
    out.add(_RiskDriver(
        'Recent classroom observations have been negative',
        'behavior',
        1.0 + beh));
  }

  out.sort((a, b) => a.severity.compareTo(b.severity));
  return out.take(2).toList();
}

class _RiskCard extends StatelessWidget {
  const _RiskCard({required this.summary, required this.onJumpToTab});
  final ParentSummary summary;
  final void Function(String tab) onJumpToTab;

  @override
  Widget build(BuildContext context) {
    final drivers = _driversFor(summary);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Risk',
                style: TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            RiskChip(summary.riskTier),
            if (drivers.isNotEmpty) ...[
              const SizedBox(height: 16),
              const Divider(height: 1),
              const SizedBox(height: 12),
              const Text("What's driving this",
                  style: TextStyle(
                      color: Colors.black54,
                      fontSize: 12,
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              ...drivers.map((d) => _DriverRow(
                    driver: d,
                    onTap: () => onJumpToTab(d.tab),
                  )),
              const SizedBox(height: 8),
              const Text(
                "Your child's class teacher can share more context.",
                style: TextStyle(color: Colors.black54, fontSize: 11),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DriverRow extends StatelessWidget {
  const _DriverRow({required this.driver, required this.onTap});
  final _RiskDriver driver;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Container(
              width: 6,
              height: 6,
              margin: const EdgeInsets.only(right: 10),
              decoration: const BoxDecoration(
                color: VistaColors.brand,
                shape: BoxShape.circle,
              ),
            ),
            Expanded(
              child: Text(
                driver.text,
                style: const TextStyle(
                    fontSize: 14,
                    color: VistaColors.navy950,
                    height: 1.3),
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.black38, size: 20),
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
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_attendanceFamily(studentId));
        await ref.read(_attendanceFamily(studentId).future);
      },
      child: records.when(
        loading: () => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 200),
            Center(child: CircularProgressIndicator()),
          ],
        ),
        error: (e, _) => _errorList('Unable to load attendance.\n$e'),
        data: (list) {
          if (list.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                Center(
                  child: Text('No attendance records yet.',
                      style: TextStyle(color: Colors.black54)),
                ),
              ],
            );
          }
          final byMonth = <String, List<AttendanceRecord>>{};
          for (final r in list) {
            final key =
                '${r.date.year}-${r.date.month.toString().padLeft(2, '0')}';
            byMonth.putIfAbsent(key, () => []).add(r);
          }
          final monthKeys = byMonth.keys.toList()
            ..sort((a, b) => b.compareTo(a));
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: monthKeys.length,
            itemBuilder: (c, i) {
              final key = monthKeys[i];
              final rows = byMonth[key]!
                ..sort((a, b) => b.date.compareTo(a.date));
              return _MonthAttendanceCard(
                monthLabel: DateFormat.yMMMM().format(rows.first.date),
                rows: rows,
                initiallyExpanded: false,
              );
            },
          );
        },
      ),
    );
  }
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

class _MonthAttendanceCard extends StatelessWidget {
  const _MonthAttendanceCard({
    required this.monthLabel,
    required this.rows,
    required this.initiallyExpanded,
  });

  final String monthLabel;
  final List<AttendanceRecord> rows;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    int present = 0, late = 0, absent = 0, excused = 0;
    for (final r in rows) {
      switch (r.status) {
        case 'Present':
          present++;
          break;
        case 'Late':
          late++;
          break;
        case 'Absent':
          absent++;
          break;
        case 'Excused':
          excused++;
          break;
      }
    }
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          tilePadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: EdgeInsets.zero,
          title: Text(
            monthLabel,
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: VistaColors.navy950),
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                if (present > 0)
                  _AttendancePill(
                      'P $present', VistaColors.success, const Color(0xFFE6F4EA)),
                if (late > 0)
                  _AttendancePill(
                      'L $late', VistaColors.warn, const Color(0xFFFFF4E5)),
                if (absent > 0)
                  _AttendancePill(
                      'A $absent', VistaColors.danger, const Color(0xFFFDECEA)),
                if (excused > 0)
                  _AttendancePill('E $excused', Colors.black54,
                      const Color(0xFFEEF1F7)),
              ],
            ),
          ),
          children: [
            const Divider(height: 1),
            ...rows.map((r) => ListTile(
                  leading: _attendanceIcon(r.status),
                  title: Text(DateFormat.yMMMEd().format(r.date)),
                  subtitle: Text(r.subjectName ?? ''),
                  trailing: Text(r.status,
                      style:
                          const TextStyle(fontWeight: FontWeight.w600)),
                )),
          ],
        ),
      ),
    );
  }
}

class _AttendancePill extends StatelessWidget {
  const _AttendancePill(this.label, this.fg, this.bg);
  final String label;
  final Color fg;
  final Color bg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label,
          style: TextStyle(
              color: fg, fontSize: 11, fontWeight: FontWeight.w700)),
    );
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
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_gradesFamily(studentId));
        await ref.read(_gradesFamily(studentId).future);
      },
      child: grades.when(
        loading: () => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 200),
            Center(child: CircularProgressIndicator()),
          ],
        ),
        error: (e, _) {
          if (e is AcademicAccessSuspended) {
            return LockedScreen(reason: e.reason);
          }
          return _errorList('Unable to load grades.\n$e');
        },
        data: (list) {
          if (list.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                Center(
                  child: Text('No grades yet.',
                      style: TextStyle(color: Colors.black54)),
                ),
              ],
            );
          }
          final byQuarter = <int, List<Grade>>{};
          for (final g in list) {
            byQuarter.putIfAbsent(g.quarter, () => []).add(g);
          }
          final quarters = byQuarter.keys.toList()..sort();
          final schoolYear = list
              .map((g) => g.schoolYear)
              .firstWhere((sy) => sy != null && sy.isNotEmpty,
                  orElse: () => null);
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: quarters.length + 1,
            itemBuilder: (c, i) {
              if (i == 0) {
                return _SchoolYearHeader(schoolYear: schoolYear);
              }
              final q = quarters[i - 1];
              final rows = byQuarter[q]!
                ..sort((a, b) => a.subjectName.compareTo(b.subjectName));
              final graded = rows.where((g) => g.grade != null).toList();
              final avg = graded.isEmpty
                  ? null
                  : graded
                          .map((g) => g.grade!)
                          .reduce((a, b) => a + b) /
                      graded.length;
              return _QuarterGradesCard(
                quarter: q,
                average: avg,
                rows: rows,
              );
            },
          );
        },
      ),
    );
  }
}

class _QuarterGradesCard extends StatelessWidget {
  const _QuarterGradesCard({
    required this.quarter,
    required this.average,
    required this.rows,
  });

  final int quarter;
  final double? average;
  final List<Grade> rows;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Quarter $quarter',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: VistaColors.navy950,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEEF1F7),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    average == null
                        ? 'Avg —'
                        : 'Avg ${average!.toStringAsFixed(1)}',
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: VistaColors.navy950),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            ...rows.map((g) {
              final pass = (g.remarks ?? '').toLowerCase() == 'passed';
              final fail = (g.remarks ?? '').toLowerCase() == 'failed';
              final gradeColor = fail
                  ? VistaColors.danger
                  : (pass ? VistaColors.success : VistaColors.navy950);
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            g.subjectName,
                            style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: VistaColors.navy950),
                          ),
                          if (g.remarks != null && g.remarks!.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              g.remarks!,
                              style: TextStyle(
                                fontSize: 12,
                                color: fail
                                    ? VistaColors.danger
                                    : (pass
                                        ? VistaColors.success
                                        : Colors.black54),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    Text(
                      g.grade?.toStringAsFixed(1) ?? '—',
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: gradeColor),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
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
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_eceFamily(studentId));
        await ref.read(_eceFamily(studentId).future);
      },
      child: ece.when(
      loading: () => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 200),
          Center(child: CircularProgressIndicator()),
        ],
      ),
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
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _SchoolYearHeader(schoolYear: data.schoolYear),
            ...bySubject.entries.map((e) {
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
            }),
          ],
        );
      },
      ),
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

class _SchoolYearHeader extends StatelessWidget {
  const _SchoolYearHeader({required this.schoolYear});
  final String? schoolYear;

  @override
  Widget build(BuildContext context) {
    final label = (schoolYear == null || schoolYear!.isEmpty)
        ? 'Current school year'
        : 'S.Y. $schoolYear';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: VistaColors.brand.withOpacity(0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: VistaColors.brand.withOpacity(0.18)),
      ),
      child: Row(
        children: [
          const Icon(Icons.calendar_month_outlined,
              size: 18, color: VistaColors.brand),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'School Year',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.8,
                    color: VistaColors.brand,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: VistaColors.navy950,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
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
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_behaviorFamily(studentId));
        await ref.read(_behaviorFamily(studentId).future);
      },
      child: logs.when(
        loading: () => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 200),
            Center(child: CircularProgressIndicator()),
          ],
        ),
        error: (e, _) => _errorList('Unable to load behavior.\n$e'),
        data: (list) {
          if (list.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                Center(
                  child: Text('No behavior observations yet.',
                      style: TextStyle(color: Colors.black54)),
                ),
              ],
            );
          }
          final byMonth = <String, List<BehaviorLog>>{};
          for (final b in list) {
            final key =
                '${b.observedAt.year}-${b.observedAt.month.toString().padLeft(2, '0')}';
            byMonth.putIfAbsent(key, () => []).add(b);
          }
          final monthKeys = byMonth.keys.toList()
            ..sort((a, b) => b.compareTo(a));
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: monthKeys.length,
            itemBuilder: (c, i) {
              final key = monthKeys[i];
              final rows = byMonth[key]!
                ..sort((a, b) => b.observedAt.compareTo(a.observedAt));
              return _MonthBehaviorCard(
                monthLabel: DateFormat.yMMMM().format(rows.first.observedAt),
                rows: rows,
                initiallyExpanded: false,
              );
            },
          );
        },
      ),
    );
  }
}

class _MonthBehaviorCard extends StatelessWidget {
  const _MonthBehaviorCard({
    required this.monthLabel,
    required this.rows,
    required this.initiallyExpanded,
  });

  final String monthLabel;
  final List<BehaviorLog> rows;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    int positive = 0, neutral = 0, negative = 0;
    for (final b in rows) {
      switch (b.sentiment) {
        case 'Positive':
          positive++;
          break;
        case 'Negative':
          negative++;
          break;
        default:
          neutral++;
      }
    }
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          tilePadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: EdgeInsets.zero,
          title: Text(
            monthLabel,
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: VistaColors.navy950),
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                if (positive > 0)
                  _AttendancePill('+ $positive', VistaColors.success,
                      const Color(0xFFE6F4EA)),
                if (neutral > 0)
                  _AttendancePill('• $neutral', Colors.black54,
                      const Color(0xFFEEF1F7)),
                if (negative > 0)
                  _AttendancePill('− $negative', VistaColors.danger,
                      const Color(0xFFFDECEA)),
              ],
            ),
          ),
          children: [
            const Divider(height: 1),
            ...rows.asMap().entries.map((entry) {
              final b = entry.value;
              final isLast = entry.key == rows.length - 1;
              return Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, isLast ? 12 : 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        _SentimentChip(b.sentiment),
                        const Spacer(),
                        Text(DateFormat.MMMd().format(b.observedAt),
                            style: const TextStyle(
                                color: Colors.black45, fontSize: 12)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(b.observation),
                    if ((b.category != null && b.category!.isNotEmpty) ||
                        (b.teacherName != null &&
                            b.teacherName!.isNotEmpty)) ...[
                      const SizedBox(height: 6),
                      Text(
                        [
                          if (b.category != null && b.category!.isNotEmpty)
                            b.category!,
                          if (b.teacherName != null &&
                              b.teacherName!.isNotEmpty)
                            'by ${b.teacherName!}',
                        ].join(' · '),
                        style: const TextStyle(
                            color: Colors.black45, fontSize: 12),
                      ),
                    ],
                    if (!isLast) ...[
                      const SizedBox(height: 12),
                      const Divider(height: 1),
                    ],
                  ],
                ),
              );
            }),
          ],
        ),
      ),
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

/// Internal representation of the chip selection. `personId == null` →
/// the parent themself; otherwise an authorized_pickup_persons row.
class _FetcherChoice {
  _FetcherChoice.self(this.parentName, this.parentPhotoUrl)
      : person = null;
  _FetcherChoice.auth(AuthorizedPickupPerson p)
      : parentName = null,
        parentPhotoUrl = null,
        person = p;

  final String? parentName;
  final String? parentPhotoUrl;
  final AuthorizedPickupPerson? person;

  String get id => person?.id ?? 'self';
  bool get isSelf => person == null;
  String get displayName => person?.fullName ?? parentName ?? 'You';
  String? get photoUrl => person?.photoUrl ?? parentPhotoUrl;
  String? get relationship => person?.relationship;
}

class _PickupQrTabState extends ConsumerState<_PickupQrTab> {
  PickupQr? _qr;
  String? _error;
  bool _loading = false;
  bool _loadingPersons = true;
  bool _sharing = false;
  List<AuthorizedPickupPerson> _persons = const [];
  _FetcherChoice? _selected;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _loadPersons();
    if (!mounted) return;
    _ensureDefaultSelection();
    await _regenerate();
  }

  Future<void> _loadPersons() async {
    setState(() => _loadingPersons = true);
    try {
      final list = await ref
          .read(parentApiProvider)
          .listAuthorizedPersons(widget.studentId);
      if (!mounted) return;
      setState(() => _persons = list);
    } on VistaApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loadingPersons = false);
    }
  }

  void _ensureDefaultSelection() {
    if (_selected != null) {
      // Re-resolve the selected entry against the latest list (in case it was
      // edited or deleted while the form was open).
      if (!_selected!.isSelf) {
        final match = _persons.firstWhere(
          (p) => p.id == _selected!.id,
          orElse: () => _persons.isNotEmpty
              ? _persons.first
              : AuthorizedPickupPerson(
                  id: '',
                  studentId: widget.studentId,
                  surname: '',
                  firstName: '',
                  relationship: '',
                  fullName: ''),
        );
        if (match.id.isEmpty) {
          _selected = _selfChoice();
        } else {
          _selected = _FetcherChoice.auth(match);
        }
      }
      return;
    }
    _selected = _selfChoice();
  }

  _FetcherChoice _selfChoice() {
    final me = ref.read(sessionProvider).valueOrNull;
    return _FetcherChoice.self(me?.fullName ?? 'You', me?.photoUrl);
  }

  Future<void> _regenerate() async {
    final choice = _selected;
    if (choice == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final qr = await ref.read(parentApiProvider).generateQr(
            widget.studentId,
            fetcherType: choice.isSelf ? 'self' : 'auth',
            fetcherId: choice.isSelf ? null : choice.id,
          );
      if (!mounted) return;
      setState(() => _qr = qr);
    } on VistaApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openManage() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AuthorizedPersonsScreen(studentId: widget.studentId),
      ),
    );
    // List may have changed — reload and re-resolve selection.
    await _loadPersons();
    if (!mounted) return;
    _ensureDefaultSelection();
    await _regenerate();
  }

  void _select(_FetcherChoice c) {
    if (_selected?.id == c.id) return;
    setState(() => _selected = c);
    _regenerate();
  }

  /// Renders the active QR to a PNG and saves it to the device photo gallery
  /// so the parent can hand it off to the authorized fetcher (forwarding it
  /// from Photos / Gallery via Messenger, email, print, etc.). Only relevant
  /// when the chosen fetcher is an authorized_pickup_persons row — the 'self'
  /// QR is timed and used by the parent themselves at the gate.
  Future<void> _shareToFetcher() async {
    final qr = _qr;
    final choice = _selected;
    if (qr == null || choice == null || choice.isSelf || _sharing) return;

    setState(() {
      _sharing = true;
      _error = null;
    });
    try {
      // Gal's add-only access scope is enough — we never read the gallery.
      final hasAccess = await Gal.hasAccess(toAlbum: true);
      if (!hasAccess) {
        final granted = await Gal.requestAccess(toAlbum: true);
        if (!granted) {
          throw Exception('Gallery permission denied.');
        }
      }

      final children = ref.read(childrenProvider).valueOrNull ?? const [];
      final student = children
          .where((s) => s.id == widget.studentId)
          .cast<Student?>()
          .firstOrNull;
      final studentName = student?.fullName ?? 'child';
      final gradeLine = <String>[
        if ((student?.gradeLevel ?? '').isNotEmpty) student!.gradeLevel,
        if ((student?.section ?? '').isNotEmpty) student!.section!,
      ].join(' · ');
      final fetcherLine = (choice.relationship?.isNotEmpty ?? false)
          ? '${choice.displayName} (${choice.relationship})'
          : choice.displayName;
      final generatedAt = DateFormat('MMM d, y · h:mm a').format(DateTime.now());

      final bytes = await _composePickupQrPng(
        payload: qr.payload,
        studentName: studentName,
        gradeLine: gradeLine,
        fetcherLine: fetcherLine,
        generatedAt: generatedAt,
      );

      final fileName =
          'vista-pickup-${studentName.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '-').toLowerCase()}-${DateTime.now().millisecondsSinceEpoch}';

      await Gal.putImageBytes(
        bytes,
        album: 'VISTA',
        name: fileName,
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'QR saved to your gallery — share it with ${choice.displayName}.'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Could not save QR to gallery: $e');
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingPersons && _qr == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final selfChoice = _selfChoice();
    final choices = <_FetcherChoice>[
      selfChoice,
      ..._persons.map(_FetcherChoice.auth),
    ];

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: [
        const Text(
          "Who's fetching today?",
          style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: VistaColors.navy950),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final c in choices)
              _FetcherChip(
                choice: c,
                selected: _selected?.id == c.id,
                onTap: () => _select(c),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _openManage,
            icon: const Icon(Icons.manage_accounts_outlined),
            label: const Text('Manage authorized fetchers'),
          ),
        ),
        const SizedBox(height: 16),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(_error!,
                style: const TextStyle(color: VistaColors.danger)),
          )
        else if (_qr != null)
          _QrCard(
            qr: _qr!,
            choice: _selected ?? selfChoice,
            loading: _loading,
            sharing: _sharing,
            onRefresh: _regenerate,
            onSendToFetcher: _shareToFetcher,
          )
        else if (_loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 60),
            child: Center(child: CircularProgressIndicator()),
          ),
      ],
    );
  }
}

class _FetcherChip extends StatelessWidget {
  const _FetcherChip({
    required this.choice,
    required this.selected,
    required this.onTap,
  });

  final _FetcherChoice choice;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.fromLTRB(6, 6, 14, 6),
        decoration: BoxDecoration(
          color: selected ? VistaColors.brand : Colors.white,
          border: Border.all(
              color: selected ? VistaColors.brand : const Color(0xFFDDE2EC)),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 16,
              backgroundColor: const Color(0xFFEEF1F7),
              backgroundImage: choice.photoUrl != null
                  ? NetworkImage(choice.photoUrl!)
                  : null,
              child: choice.photoUrl == null
                  ? Text(
                      _initials(choice.displayName),
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Colors.black54),
                    )
                  : null,
            ),
            const SizedBox(width: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 140),
              child: Text(
                choice.isSelf ? 'You' : choice.displayName,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? Colors.white : VistaColors.navy950,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}

class _QrCard extends StatelessWidget {
  const _QrCard({
    required this.qr,
    required this.choice,
    required this.loading,
    required this.sharing,
    required this.onRefresh,
    required this.onSendToFetcher,
  });

  final PickupQr qr;
  final _FetcherChoice choice;
  final bool loading;
  final bool sharing;
  final VoidCallback onRefresh;
  final VoidCallback onSendToFetcher;

  @override
  Widget build(BuildContext context) {
    final relSuffix =
        choice.relationship != null ? ' (${choice.relationship})' : '';
    final exp = qr.expiresAt;
    final remaining = exp?.difference(DateTime.now());
    final String statusLine;
    if (exp == null) {
      // Authorized-fetcher QR: single use only, no timer.
      statusLine = 'Single use — auto-invalidates after the guard scans it.';
    } else if (remaining!.isNegative) {
      statusLine = 'Expired — tap Refresh';
    } else {
      statusLine =
          'Expires in ${remaining.inMinutes}m ${remaining.inSeconds % 60}s';
    }
    return Column(
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
          child: QrImageView(data: qr.payload, size: 240),
        ),
        const SizedBox(height: 12),
        Text(
          'Fetcher: ${choice.displayName}$relSuffix',
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: VistaColors.navy950),
        ),
        const SizedBox(height: 6),
        Text(
          statusLine,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.black54),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: loading || sharing ? null : onRefresh,
          icon: const Icon(Icons.refresh),
          label: Text(exp == null ? 'Generate new QR' : 'Refresh QR'),
        ),
        // 'Upload to gallery' is only meaningful for authorized fetchers —
        // the 'self' QR is timed and used by the parent themselves at the
        // gate, so saving it as a photo doesn't fit that flow.
        if (!choice.isSelf) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: loading || sharing ? null : onSendToFetcher,
            icon: sharing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_outlined),
            label: Text(sharing ? 'Downloading...' : 'Download QR'),
          ),
        ],
      ],
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

/// Renders the Pickup QR PNG that gets saved to the gallery: a navy header
/// band ("VISTA Pickup QR" + timestamp), the QR module, and a labeled info
/// block (student, fetcher, single-use reminder) so whoever holds the photo
/// can read who it's for without opening the app.
Future<Uint8List> _composePickupQrPng({
  required String payload,
  required String studentName,
  required String gradeLine,
  required String fetcherLine,
  required String generatedAt,
}) async {
  const w = 800.0;
  const h = 1180.0;
  const pad = 48.0;
  const headerH = 140.0;

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);

  // White page background.
  canvas.drawRect(
    const Rect.fromLTWH(0, 0, w, h),
    Paint()..color = const Color(0xFFFFFFFF),
  );

  // Navy header band.
  canvas.drawRect(
    const Rect.fromLTWH(0, 0, w, headerH),
    Paint()..color = VistaColors.brand,
  );

  double y = 32;
  y = _drawCentered(canvas, w, 'VISTA Pickup QR', y,
      const TextStyle(
        color: Colors.white,
        fontSize: 34,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.4,
      ));
  y += 4;
  _drawCentered(canvas, w, 'Single-use code · $generatedAt', y,
      const TextStyle(color: Colors.white70, fontSize: 16));

  // QR module — sits below the header on a white card.
  const qrSize = 540.0;
  const qrX = (w - qrSize) / 2;
  const qrY = headerH + 40;
  canvas.drawRRect(
    RRect.fromRectAndRadius(
      const Rect.fromLTWH(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32),
      const Radius.circular(20),
    ),
    Paint()..color = const Color(0xFFFFFFFF),
  );
  canvas.drawRRect(
    RRect.fromRectAndRadius(
      const Rect.fromLTWH(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32),
      const Radius.circular(20),
    ),
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = const Color(0xFFE3E7EE),
  );
  canvas.save();
  canvas.translate(qrX, qrY);
  QrPainter(
    data: payload,
    version: QrVersions.auto,
    errorCorrectionLevel: QrErrorCorrectLevel.H,
    gapless: true,
    eyeStyle: const QrEyeStyle(
      eyeShape: QrEyeShape.square,
      color: Color(0xFF000000),
    ),
    dataModuleStyle: const QrDataModuleStyle(
      dataModuleShape: QrDataModuleShape.square,
      color: Color(0xFF000000),
    ),
  ).paint(canvas, const Size(qrSize, qrSize));
  canvas.restore();

  // Info block.
  double infoY = qrY + qrSize + 56;
  infoY = _drawCentered(canvas, w, 'STUDENT', infoY,
      const TextStyle(
        color: Color(0xFF7A8597),
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.4,
      ));
  infoY += 4;
  infoY = _drawCentered(canvas, w, studentName, infoY,
      const TextStyle(
        color: VistaColors.navy950,
        fontSize: 26,
        fontWeight: FontWeight.w700,
      ));
  if (gradeLine.isNotEmpty) {
    infoY += 2;
    infoY = _drawCentered(canvas, w, gradeLine, infoY,
        const TextStyle(color: Color(0xFF6B7280), fontSize: 16));
  }

  infoY += 20;
  infoY = _drawCentered(canvas, w, 'AUTHORIZED FETCHER', infoY,
      const TextStyle(
        color: Color(0xFF7A8597),
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.4,
      ));
  infoY += 4;
  infoY = _drawCentered(canvas, w, fetcherLine, infoY,
      const TextStyle(
        color: VistaColors.navy950,
        fontSize: 22,
        fontWeight: FontWeight.w600,
      ),
      maxWidth: w - pad * 2);

  // Footer pill — single-use notice.
  const footerH = 56.0;
  const footerY = h - pad - footerH;
  canvas.drawRRect(
    RRect.fromRectAndRadius(
      const Rect.fromLTWH(pad, footerY, w - pad * 2, footerH),
      const Radius.circular(14),
    ),
    Paint()..color = const Color(0xFFF1F4F9),
  );
  _drawCentered(
    canvas,
    w,
    'Present this at the school gate. Auto-invalidates after one scan.',
    footerY + (footerH - 18) / 2,
    const TextStyle(
      color: VistaColors.navy950,
      fontSize: 15,
      fontWeight: FontWeight.w500,
    ),
    maxWidth: w - pad * 2,
  );

  final image = await recorder.endRecording().toImage(w.toInt(), h.toInt());
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  if (bytes == null) throw Exception('Failed to render Pickup QR PNG.');
  return bytes.buffer.asUint8List();
}

/// Lays out [text] centered horizontally on [canvas] at [y] and returns the
/// next y-cursor (i.e. y + textHeight).
double _drawCentered(
  Canvas canvas,
  double pageWidth,
  String text,
  double y,
  TextStyle style, {
  double? maxWidth,
}) {
  final tp = TextPainter(
    text: TextSpan(text: text, style: style),
    textAlign: TextAlign.center,
    textDirection: ui.TextDirection.ltr,
  );
  tp.layout(maxWidth: maxWidth ?? pageWidth);
  tp.paint(canvas, Offset((pageWidth - tp.width) / 2, y));
  return y + tp.height;
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:vista_api/vista_api.dart';

import '../providers.dart';
import '../theme.dart';
import '../widgets/locked_screen.dart';
import '../widgets/risk_chip.dart';

const _tabNames = ['overview', 'attendance', 'academics', 'behavior'];

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
              // Learning areas only. MAPEH's four areas come back alongside the
              // MAPEH grade averaged from them, so counting every row would
              // weigh that one learning area five times against the others.
              final graded = rows
                  .where((g) => g.grade != null && !g.isArea)
                  .toList();
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
    final learningAreas = rows.where((g) => !g.isArea).toList();
    final areasByParent = <String, List<Grade>>{};
    for (final g in rows.where((g) => g.isArea)) {
      areasByParent.putIfAbsent(g.parentSubjectName!, () => []).add(g);
    }

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
            ...learningAreas.expand((g) {
              final pass = (g.remarks ?? '').toLowerCase() == 'passed';
              final fail = (g.remarks ?? '').toLowerCase() == 'failed';
              final gradeColor = fail
                  ? VistaColors.danger
                  : (pass ? VistaColors.success : VistaColors.navy950);
              // MAPEH's areas, indented directly beneath it — a parent reading
              // "MAPEH 88" is entitled to see it is the average of four marks.
              // They are shown but never counted: the quarter average above and
              // the report card both treat MAPEH as one learning area.
              final areas = areasByParent[g.subjectName] ?? const <Grade>[];
              return [
              Padding(
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
              ),
              for (final area in areas)
                Padding(
                  padding: const EdgeInsets.only(left: 16, bottom: 10),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '› ${area.subjectName}',
                          style: const TextStyle(
                              fontSize: 13, color: Colors.black54),
                        ),
                      ),
                      Text(
                        area.grade?.toStringAsFixed(1) ?? '—',
                        style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Colors.black54),
                      ),
                    ],
                  ),
                ),
              ];
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

Widget _errorList(String message) => ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(message, style: const TextStyle(color: Colors.black54)),
      ],
    );

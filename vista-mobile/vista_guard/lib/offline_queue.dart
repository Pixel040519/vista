import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:vista_api/vista_api.dart';

/// Persistent queue of `/api/dismissal/verify` attempts made while offline.
///
/// The guard app cannot lose a scan — if a gate scan succeeds locally but the
/// network is flaky, we must still post it to the server so the parent's push
/// notification fires and the audit log is complete. Entries that stay failed
/// for more than 24h are dropped (school day ended).
class OfflineQueue {
  OfflineQueue._();
  static final instance = OfflineQueue._();

  Database? _db;
  Timer? _timer;
  GuardApi Function()? _apiFactory;

  Future<Database> _open() async {
    if (_db != null) return _db!;
    final dir = await getApplicationDocumentsDirectory();
    final path = p.join(dir.path, 'vista_guard_queue.db');
    _db = await openDatabase(
      path,
      version: 3,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE scan_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qr_payload TEXT NOT NULL,
            authorized_by TEXT NOT NULL,
            gate_label TEXT,
            fetcher_type TEXT,
            queued_at INTEGER NOT NULL
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute('ALTER TABLE scan_queue ADD COLUMN gate_label TEXT');
        }
        if (oldVersion < 3) {
          await db.execute('ALTER TABLE scan_queue ADD COLUMN fetcher_type TEXT');
        }
      },
    );
    return _db!;
  }

  Future<void> enqueue({
    required String qrPayload,
    required String authorizedBy,
    String? gateLabel,
    String fetcherType = 'self',
  }) async {
    final db = await _open();
    await db.insert('scan_queue', {
      'qr_payload': qrPayload,
      'authorized_by': authorizedBy,
      'gate_label': gateLabel,
      'fetcher_type': fetcherType,
      'queued_at': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<int> pendingCount() async {
    final db = await _open();
    final r = await db.rawQuery('SELECT COUNT(*) AS c FROM scan_queue');
    return (r.first['c'] as int?) ?? 0;
  }

  void start(GuardApi Function() apiFactory) {
    _apiFactory = apiFactory;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _drain());
    Connectivity().onConnectivityChanged.listen((_) => _drain());
  }

  Future<void> _drain() async {
    final api = _apiFactory?.call();
    if (api == null) return;
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) return;

    final db = await _open();
    final rows = await db.query('scan_queue', orderBy: 'queued_at ASC', limit: 20);
    for (final row in rows) {
      final id = row['id'] as int;
      final queuedAt = row['queued_at'] as int;
      if (DateTime.now().millisecondsSinceEpoch - queuedAt >
          const Duration(hours: 24).inMilliseconds) {
        await db.delete('scan_queue', where: 'id=?', whereArgs: [id]);
        continue;
      }
      try {
        await api.verify(
          qrPayload: row['qr_payload'] as String,
          authorizedById: row['authorized_by'] as String,
          fetcherType: (row['fetcher_type'] as String?) ?? 'self',
          gateLabel: row['gate_label'] as String?,
        );
        await db.delete('scan_queue', where: 'id=?', whereArgs: [id]);
      } catch (_) {
        // Leave in queue for the next tick.
        break;
      }
    }
  }
}

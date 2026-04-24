/// Compile-time API base URL. Override per-build via
/// `flutter run --dart-define=VISTA_API_BASE=https://staging.vista.ph`.
///
/// Defaults:
/// - Android emulator: `http://10.0.2.2:5000` (host loopback).
/// - iOS simulator / device: expects `--dart-define=VISTA_API_BASE=...`.
const vistaApiBase = String.fromEnvironment(
  'VISTA_API_BASE',
  defaultValue: 'http://10.0.2.2:5000',
);

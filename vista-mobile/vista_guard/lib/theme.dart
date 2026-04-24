import 'package:flutter/material.dart';

/// Guard app uses the same navy palette as vista_parent but with larger
/// typography and bigger tap targets because it is operated one-handed at a
/// school gate.
class VistaColors {
  static const brand = Color(0xFF2B4F9E);
  static const navy950 = Color(0xFF0B1733);
  static const success = Color(0xFF2E7D32);
  static const warn = Color(0xFFEF9300);
  static const danger = Color(0xFFC62828);
}

TextStyle? _scale(TextStyle? s, double factor) {
  if (s == null || s.fontSize == null) return s;
  return s.copyWith(fontSize: s.fontSize! * factor);
}

TextTheme _scaledTextTheme(TextTheme base, double factor) {
  return TextTheme(
    displayLarge: _scale(base.displayLarge, factor),
    displayMedium: _scale(base.displayMedium, factor),
    displaySmall: _scale(base.displaySmall, factor),
    headlineLarge: _scale(base.headlineLarge, factor),
    headlineMedium: _scale(base.headlineMedium, factor),
    headlineSmall: _scale(base.headlineSmall, factor),
    titleLarge: _scale(base.titleLarge, factor),
    titleMedium: _scale(base.titleMedium, factor),
    titleSmall: _scale(base.titleSmall, factor),
    bodyLarge: _scale(base.bodyLarge, factor),
    bodyMedium: _scale(base.bodyMedium, factor),
    bodySmall: _scale(base.bodySmall, factor),
    labelLarge: _scale(base.labelLarge, factor),
    labelMedium: _scale(base.labelMedium, factor),
    labelSmall: _scale(base.labelSmall, factor),
  );
}

ThemeData buildVistaGuardTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: VistaColors.brand,
    primary: VistaColors.brand,
    brightness: Brightness.light,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme);
  return base.copyWith(
    scaffoldBackgroundColor: const Color(0xFFF5F7FB),
    textTheme: _scaledTextTheme(base.textTheme, 1.1),
    appBarTheme: const AppBarTheme(
      backgroundColor: VistaColors.brand,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: VistaColors.brand,
        minimumSize: const Size.fromHeight(56),
        textStyle:
            const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFDDE2EC)),
      ),
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    ),
  );
}

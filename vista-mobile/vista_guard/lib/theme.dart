import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Guard app uses the same navy palette as vista_parent but with larger
/// typography and bigger tap targets because it is operated one-handed at a
/// school gate. Tokens mirror the VISTA Guard UI kit `G` object.
class VistaColors {
  static const brand = Color(0xFF2B4F9E);
  static const brandDark = Color(0xFF1C3C7D);
  static const navy950 = Color(0xFF0B1733);
  static const scanBg = Color(0xFF1A1F2A);
  static const success = Color(0xFF2E7D32);
  static const warn = Color(0xFFEF9300);
  static const danger = Color(0xFFC62828);
}

// Resolves to the family name google_fonts assigns to the loaded DM Sans
// font (e.g. "DM Sans_regular"). Used for non-themed widget styles that need
// to opt into the same font without going through TextTheme inheritance.
final _fontFamily = GoogleFonts.dmSans().fontFamily;

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
  final dmTextTheme = GoogleFonts.dmSansTextTheme(base.textTheme);
  return base.copyWith(
    scaffoldBackgroundColor: const Color(0xFFF5F7FB),
    textTheme: _scaledTextTheme(dmTextTheme, 1.1),
    appBarTheme: AppBarTheme(
      backgroundColor: VistaColors.brand,
      foregroundColor: Colors.white,
      elevation: 0,
      titleTextStyle: TextStyle(
        fontFamily: _fontFamily,
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: Colors.white,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: VistaColors.brand,
        minimumSize: const Size.fromHeight(56),
        textStyle: TextStyle(
          fontFamily: _fontFamily,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFDDE2EC)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFDDE2EC)),
      ),
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
    ),
  );
}

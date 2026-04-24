import 'package:flutter/material.dart';

/// VISTA brand palette — mirrors the navy-blue scheme used in the web
/// dashboard so the mobile app feels continuous with the desktop product.
class VistaColors {
  static const brand = Color(0xFF2B4F9E);
  static const brandDark = Color(0xFF1C3C7D);
  static const navy950 = Color(0xFF0B1733);
  static const surface = Color(0xFFF5F7FB);
  static const success = Color(0xFF2E7D32);
  static const warn = Color(0xFFEF9300);
  static const danger = Color(0xFFC62828);
}

ThemeData buildVistaTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: VistaColors.brand,
    primary: VistaColors.brand,
    brightness: Brightness.light,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: VistaColors.surface,
    appBarTheme: const AppBarTheme(
      backgroundColor: VistaColors.brand,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: VistaColors.brand,
        minimumSize: const Size.fromHeight(48),
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
          const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
  );
}

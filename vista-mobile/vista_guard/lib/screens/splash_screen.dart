import 'package:flutter/material.dart';

import '../theme.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: VistaColors.brand,
        body: Center(child: CircularProgressIndicator(color: Colors.white)),
      );
}

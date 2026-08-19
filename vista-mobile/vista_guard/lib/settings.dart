import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _gateKey = 'gate_label';
const gateOptions = ['Gate 1', 'Gate 2'];

class GateSetting extends StateNotifier<String> {
  GateSetting() : super('Gate 1') {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_gateKey);
    if (value != null && gateOptions.contains(value)) state = value;
  }

  Future<void> set(String gate) async {
    if (!gateOptions.contains(gate)) return;
    state = gate;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_gateKey, gate);
  }
}

final gateSettingProvider =
    StateNotifierProvider<GateSetting, String>((ref) => GateSetting());

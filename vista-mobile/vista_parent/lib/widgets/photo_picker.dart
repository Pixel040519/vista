import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

/// Shared bottom-sheet helper. Opens "Take photo" / "Choose from gallery" and
/// returns the picked [File], or null if the user dismissed. Used by the
/// parent's own profile avatar.
Future<File?> pickPhoto(BuildContext context) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Take photo'),
            onTap: () => Navigator.pop(ctx, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Choose from gallery'),
            onTap: () => Navigator.pop(ctx, ImageSource.gallery),
          ),
        ],
      ),
    ),
  );
  if (source == null) return null;

  final picker = ImagePicker();
  final picked = await picker.pickImage(
    source: source,
    imageQuality: 80,
    maxWidth: 1280,
  );
  return picked == null ? null : File(picked.path);
}

# VISTA Mobile — CLAUDE.md

Flutter monorepo for the VISTA parent app (Chapter 1 of the manuscript, Apr 2026). The security-guard app (`vista_guard`) and everything SecurePass — pickup QR, dismissal log, authorized fetchers — were removed in Sep 2026; see the root `CLAUDE.md`.

- `vista_parent/` — Parent app. Login, per-child Overview (risk + signals) / Attendance / Academics / Behavior, plus Profile (read-only summary + Edit Profile screen with name/phone update, profile-photo upload, password change). FCM push for school announcements. Conditional-access 423 Locked screen when a child's academic view is suspended by admin.
- `packages/vista_api/` — Shared Dart package. `ApiClient` (Dio + JWT interceptors + single-flight refresh), `AuthRepository` (secure-storage token cache), DTOs, `ParentApi` method wrappers. The app depends on this package via a relative path.

## Backend contract

All mobile traffic goes to the Node API at `:5000` — never FastAPI directly (auth + role checks live in Node).

Parent-relevant endpoints introduced in Phase 1 of the mobile plan (`2026_04_22_*` migrations):

- `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me` — reused from the web dashboard. Login now refuses any account whose `account_status` is not `'active'`, with the same `Invalid credentials.` as a wrong password — telling an unauthenticated caller "that account exists but is not activated" is the disclosure the activation flow goes to such lengths to avoid.
- `POST /api/auth/activation/{request,verify,complete}` — **the only way a parent account comes into existence.** There is no self-registration: an admin authorizes the email in the web portal, and these let its holder prove it and choose a password. `complete` signs them in. `screens/activate_screen.dart` (`CodeFlow.activate`) is the UI; `AuthRepository` has the three calls.
- `POST /api/auth/password-reset/{request,verify,complete}` — the same three beats for an active account, reached from **Forgot password?** on the login screen (`CodeFlow.reset`). It deliberately does **not** sign the user in: signing in with the new password is the last step that proves the reset landed where it was meant to.

  **`request` answers identically whether or not the email was ever invited** — same words, same status, same timing. `activate_screen.dart` therefore always advances to the code step and must never branch on what comes back; there is nothing in the response to branch on. Do not add a "no invitation found" state, and do not skip the step for an address the app thinks is unknown.
- `GET /api/students`, `GET /api/students/:id` — filtered server-side to linked students for `role=parent`.
- `GET /api/attendance?student_id=` — `enforceParentLinked` on the Node side.
- `GET /api/grades?student_id=` — `enforceParentLinked`; returns `423 Locked` with `{reason}` when `students.academic_access_suspended`. Every row now carries `parent_subject_name`: non-null on one of MAPEH's four **areas** (Music, Arts, Physical Education, Health), null on a learning area. See "Composite learning areas" below.
- `GET /api/ece/student-records?student_id=&quarter=&sy_id=` — same guards; returns `{ school_year, student, skills[], records[] }` for the ECE Academics tab.
- `GET /api/behavior?student_id=` — `enforceParentLinked`.
- `POST /api/profile/me/photo` — multipart photo upload for the parent's own avatar (field `photo`). Response mirrors `PUT /me`. After upload the Edit Profile screen calls `ref.invalidate(sessionProvider)` so the new `photo_url` flows back through `/me` into the Profile screen.
- `GET /api/ai/parent-summary/:student_id` — lightweight Overview rollup (risk, 30d attendance, latest quarter academic or ECE dist, last behavior log, unread notification count). The `risk` block includes a `factors` object (`{attendance, academic, behavioral, competency}`) read straight from the `risk_assessments` row; the parent-app Overview risk card uses these to render a "What's driving this" section under the chip with up to two plain-language drivers, each tappable to deep-link into the relevant tab. The `attendance` block is **day-based via per-day BOOL_OR collapse** — total_days = distinct calendar dates with any attendance row in the last 30 days; present_days = dates where any subject was Present/Late. Per-subject session counts are intentionally NOT used here — the card label reads "X of Y days present" so the units must match. The Attendance tab below counts rows per-subject, so its numbers can legitimately differ.
- `GET /api/notifications`, `PATCH /api/notifications/:id/read` — in-app bell (server-side notification rows are written alongside every push, so the history survives an FCM drop). A row with `type: 'announcement'` deep-links to `/announcements?id=<reference_id>`.
- `GET /api/announcements` — live school announcements for parents (audience `all` or `parents`), pinned first; `ParentApi.announcements()` → `Announcement`. Shown as the "School Announcements" strip at the top of `ChildrenScreen` (latest two; takes no space when there are none or they fail to load) and in full on `screens/announcements_screen.dart` (`/announcements`, `?id=` opens that post expanded). When an admin ticks **Notify parents** the API also sends an FCM push with `data: { type: 'announcement', announcement_id }` on Android channel `vista_announcements`, so a parent can mute announcements on their own. `fcm.dart`'s `routeForPush()` maps a push's data to a route, and `setupFcm(api, onOpen:)` opens it on tap (foreground local notification, background, or cold launch); `main.dart` passes `onOpen` through to the `GoRouter`.
- `POST /api/devices/register`, `DELETE /api/devices/:token` — FCM token registry. The vista_parent app calls register after login + permission grant, and delete on logout.
- `PUT /api/profile/me`, `PATCH /api/profile/me/password` — self-service profile edit (name parts + phone) and password change. Role-agnostic (shared with the web dashboard); the parent app's Edit Profile screen wraps both. After a successful PUT the screen calls `ref.invalidate(sessionProvider)` so `/me` is re-fetched and the Profile screen reflects the new name. Password change does NOT rotate JWTs — existing tokens stay valid.

## Composite learning areas (MAPEH)

MAPEH is one learning area graded through four areas, and `GET /api/grades`
returns **all five rows** — the four areas plus the MAPEH grade averaged from
them. `Grade.parentSubjectName` (null on a learning area) and its `isArea` getter
are how the app tells them apart.

**Anything that counts learning areas must use `!g.isArea`.** The Academics tab's
quarter average is computed client-side in `child_detail_screen.dart`, so without
that filter MAPEH would be weighed five times against every other subject. This is
the only cross-subject average computed on the client — everything else
(`ParentSummary.academicAvgGrade`, from `/api/ai/parent-summary`) is filtered
server-side.

`_QuarterGradesCard` renders one row per learning area with its areas indented
directly beneath it, prefixed `›`. Showing them is deliberate: a parent
reading "MAPEH 88" is entitled to see it is the average of four marks, and that is
how an SF9 prints it. Showing them is not the same as counting them.

## Conditional access

When academic view is suspended, the backend returns:

```
HTTP 423 Locked
{ "error": "Academic access is temporarily suspended.", "reason": "<admin's note>" }
```

Parent app must render a dedicated screen showing the reason and a "Contact school" CTA — NOT a generic error toast. Only the Academics tab is blocked; Attendance and Behavior stay fully accessible (safety information must never be gated).

## Design language

- Navy-blue brand palette (same as `vista-dashboard`): `#2b4f9e` brand-500, `navy-950` chrome background.
- Parent UI supports Filipino + English via `flutter_localizations` + ARB files (Villaseñor 2024 grassroots-inclusion point in the manuscript).

## Bundle identifiers

- iOS + Android: `ph.nrys.vista.parent`.

## Flutter conventions

- **Router refresh on session change**: `GoRouter.redirect` does not re-run when a Riverpod provider changes. `router.dart` bridges `sessionProvider` → `refreshListenable` via a `ValueNotifier<int>` incremented inside `ref.listen(sessionProvider, ...)`. Without this the splash redirect fires once at boot, sees `session.isLoading`, and never navigates away when `/me` resolves.
- **Theme text scaling must be null-safe**: Material 3's base `TextTheme` has entries with `fontSize == null` (geometry is applied later). Calling `.apply(fontSizeFactor: x)` on such a theme trips the `text_style.dart` assertion `fontSize != null || (fontSizeFactor == 1.0 && fontSizeDelta == 0.0)`. Scale text with a per-style helper that skips null-fontSize entries, never `.apply()`.
- **Emulator base URL**: `env.dart` defaults `vistaApiBase` to `http://10.0.2.2:5000` (Android emulator loopback to host). Override via `--dart-define=VISTA_API_BASE=...` for physical devices.
- **Test stubs**: `test/widget_test.dart` is an intentional placeholder (`expect(1 + 1, 2)`), not the Flutter counter template. The real app entrypoint (`VistaParentApp`) needs a `ProviderScope` + routing context that a widget-test harness does not provide yet.
- **Postgres DECIMAL arrives as String**: node-postgres returns `DECIMAL`/`NUMERIC` columns as strings, not numbers. DTOs that blindly cast `json['x'] as num?` will blow up on any `sentiment_score`, `grade.score`, `risk_score`, etc. Use the `_toDouble` helper pattern (`num → toDouble`, `String → double.tryParse`, else null) seen in `models/grade.dart` and `models/behavior.dart`.
- **Android desugaring is required**: `flutter_local_notifications` needs Java 8+ APIs backported. `vista_parent/android/app/build.gradle.kts` sets `isCoreLibraryDesugaringEnabled = true` and pulls `com.android.tools:desugar_jdk_libs:2.1.4` — without these the debug build fails with `A failure occurred while executing com.android.build.gradle.internal.tasks.CheckAarMetadataWorkAction`.
- **Student IDs are UUIDs, not integers**: the `students.id` column is `UUID`. Any backend middleware that touches a student ID from `req.params`/`req.query` must treat it as a string — the previous `parentScope.js` parsed it with `Number.parseInt` and silently truncated `4186f23e-…` to `4186`, triggering `invalid input syntax for type uuid`. Validate with a UUID regex, never `parseInt`.
- **TabBar on navy AppBar needs explicit label colors**: Material 3 defaults `labelColor` to `colorScheme.primary` (navy), which is invisible against the navy AppBar. `ChildDetailScreen`'s TabBar sets `labelColor: Colors.white` + `unselectedLabelColor: Colors.white70` + `indicatorColor: Colors.white` explicitly — don't rely on theme defaults for any TabBar sitting inside a `VistaColors.brand` AppBar.
- **Risk tier strings are the full DB enum**: `/api/ai/parent-summary` returns `risk.tier` verbatim from `risk_assessments.risk_level`, which the DB constrains to `'Stable' | 'Moderate Risk' | 'High Risk'` (not `'Moderate'`/`'High'`). `widgets/risk_chip.dart` switch cases must match those exact strings, or the chip falls through to the gray "Unknown" default.
- **Parent risk-card driver thresholds**: `_RiskCard` / `_driversFor` in `vista_parent/lib/screens/child_detail_screen.dart` map `risk.factors` to plain-language sentences with these cutoffs — `attendance < 0.85`, `academic < 0.80`, `competency < 0.70` (ECE only), `behavioral < 0.0` (signed VADER, NOT 0–1 — see root CLAUDE.md correction). These mirror risk.py's "medium" cutoffs so the explanation always agrees with what nudged the tier above Stable. The drivers section is hidden entirely when `tier == 'Stable'` so we never manufacture concern; for ECE students the academic driver is replaced by the competency one. Severity sort is "lower = worse" — for behavioral that means using `1.0 + beh` so the signed VADER value sorts consistently against the 0–1 factors.
- **Deep-link tab navigation in `ChildDetailScreen`**: tabs (Overview / Attendance / Academics / Behavior) are owned by the screen's `TabController`. To jump from one tab body to another, use the `_jumpToTab(String name)` callback the parent state passes down (e.g. `_OverviewTab(onJumpToTab: _jumpToTab)`) rather than reaching for `DefaultTabController.of(context)` — the screen uses an explicit `TabController`, not a `DefaultTabController`, so the inherited lookup returns null. Names come from the file-scope `_tabNames` list.
- **Pull-to-refresh needs `AlwaysScrollableScrollPhysics` on short/empty lists**: `RefreshIndicator` only fires when the child is scrollable. A `ListView` with one row or an empty-state message is not scrollable by default, so the pull gesture never triggers `onRefresh`. Every refreshable tab in `child_detail_screen.dart` (Overview, Attendance, Academics, Behavior) wraps its loading/empty/data branches in a ListView with `physics: AlwaysScrollableScrollPhysics()` — keep this when adding new tabs.
- **Image picker permissions (vista_parent)**: `image_picker: ^1.1.2` is wired up. iOS needs `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` in `ios/Runner/Info.plist`; Android 1.x doesn't need extra permission strings. The shared bottom-sheet helper lives at `vista_parent/lib/widgets/photo_picker.dart` (`pickPhoto(context)` returns a `File?`) and is used by the Edit Profile avatar tile — don't duplicate the camera/gallery action sheet in new screens.
- **Login screen layout**: `vista_parent/lib/screens/login_screen.dart` renders a Row(64×64 `ClipOval` logo with a navy `BoxShadow` halo + Column(title w800 + subtitle)), followed by a white form card (rounded 20, hairline `#E3E7EF` border, soft navy shadow), with `prefixIcon`s on email/password, an eye toggle that flips `_obscure`, and an `_ErrorBanner` widget (tinted danger bg + icon, NOT bare red text). It overrides `Scaffold.backgroundColor` to `#EEF1F7` — explicitly lighter than the global theme's `#F5F7FB` so the white card lifts. If you add a footer pinned to the viewport bottom, use `LayoutBuilder` + `IntrinsicHeight` + `Spacer` (NOT `Scaffold.bottomNavigationBar`) so it sits at the bottom only when the form is short. The earlier centered-NRYS / 120-px logo design was replaced with the row layout; don't reintroduce the centered block.

-- Adds the entrance label captured by the guard mobile app to each dismissal log
-- so the audit trail records which gate handled the pickup. Nullable because
-- existing rows pre-date the setting and admin/teacher-side scans (rare) do
-- not pass through the guard app.
ALTER TABLE dismissal_logs
  ADD COLUMN IF NOT EXISTS gate_label VARCHAR(20);

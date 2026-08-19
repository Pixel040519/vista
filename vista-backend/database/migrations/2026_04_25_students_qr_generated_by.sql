-- Tracks which user generated the active SecurePass QR for a student. The
-- guard scan flow uses this to skip the guardian picker and go straight to
-- the result screen with the parent who tapped "Generate" in the parent app.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS qr_generated_by UUID REFERENCES users(id);

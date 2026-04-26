-- Authorized pickup persons + fetcher photos.
--
-- Lets a parent authorize non-account persons (yaya, lola, driver, etc.) to
-- pick up a specific child, and binds each generated SecurePass QR to a chosen
-- fetcher so the guard scan result can show that one person's photo.
--
-- 1) New table for non-account fetchers, scoped to (parent, student).
CREATE TABLE IF NOT EXISTS authorized_pickup_persons (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    surname      VARCHAR(80)  NOT NULL,
    first_name   VARCHAR(80)  NOT NULL,
    middle_name  VARCHAR(80),
    relationship VARCHAR(50)  NOT NULL,
    photo_path   TEXT,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_authorized_pickup_parent_student
    ON authorized_pickup_persons(parent_id, student_id);

-- 2) Parent's own face for the gate scan result.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS photo_path TEXT;

-- 3) Bind the active QR to a chosen fetcher.
--    qr_fetcher_type: 'self' (parent themself, fetcher_id = parent users.id)
--                     'auth' (authorized_pickup_persons.id)
--                     NULL   (legacy / admin-generated QR — fall back to full list)
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS qr_fetcher_type VARCHAR(8),
    ADD COLUMN IF NOT EXISTS qr_fetcher_id   UUID;

-- 4) Audit trail on the dismissal log.
ALTER TABLE dismissal_logs
    ADD COLUMN IF NOT EXISTS fetcher_type          VARCHAR(8),
    ADD COLUMN IF NOT EXISTS fetcher_authorized_id UUID
        REFERENCES authorized_pickup_persons(id) ON DELETE SET NULL;

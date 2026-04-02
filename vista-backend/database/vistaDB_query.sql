-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS (Admin, Teachers, Parents)
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'parent')),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- STUDENTS
-- ============================================================
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id VARCHAR(50) UNIQUE NOT NULL,  -- School-assigned ID
    full_name VARCHAR(255) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', 'Other')),
    grade_level VARCHAR(20) NOT NULL,        -- Nursery, Kinder, Grade 1-6
    section VARCHAR(50),
    profile_photo_url TEXT,
    qr_code TEXT,                            -- Dynamic QR for SecurePass
    qr_expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- PARENT-STUDENT RELATIONSHIP
-- ============================================================
CREATE TABLE parent_student (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    relationship VARCHAR(50) DEFAULT 'Parent',  -- Parent, Guardian, etc.
    is_authorized_pickup BOOLEAN DEFAULT TRUE,
    UNIQUE(parent_id, student_id)
);

-- ============================================================
-- TEACHER-CLASS ASSIGNMENT
-- ============================================================
CREATE TABLE class_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id UUID REFERENCES users(id) ON DELETE CASCADE,
    grade_level VARCHAR(20) NOT NULL,
    section VARCHAR(50) NOT NULL,
    school_year VARCHAR(20) NOT NULL,        -- e.g., 2024-2025
    UNIQUE(grade_level, section, school_year)
);

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('Present', 'Absent', 'Late', 'Excused')),
    remarks TEXT,
    recorded_by UUID REFERENCES users(id),
    subject_id UUID REFERENCES subjects(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(student_id, date, subject_id)
);

-- ============================================================
-- SUBJECTS
-- ============================================================
CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    grade_level VARCHAR(20) NOT NULL,
    description TEXT
);

-- ============================================================
-- GRADES / ACADEMIC PERFORMANCE
-- ============================================================
CREATE TABLE grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id),
    quarter SMALLINT CHECK (quarter BETWEEN 1 AND 4),
    school_year VARCHAR(20) NOT NULL,
    score DECIMAL(5,2),                      -- Raw score
    grade DECIMAL(5,2),                      -- Final grade (e.g., 85.5)
    remarks VARCHAR(50),                     -- Passed, Failed, etc.
    recorded_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(student_id, subject_id, quarter, school_year)
);

-- ============================================================
-- BEHAVIORAL OBSERVATIONS
-- ============================================================
CREATE TABLE behavior_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES users(id),
    observation TEXT NOT NULL,               -- Teacher's note
    category VARCHAR(50),                    -- Social, Emotional, Academic
    sentiment VARCHAR(20),                   -- Positive, Negative, Neutral (AI-tagged)
    sentiment_score DECIMAL(5,4),            -- VADER compound score
    observed_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AI RISK ASSESSMENTS
-- ============================================================
CREATE TABLE risk_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('Stable', 'Moderate Risk', 'High Risk')),
    risk_score DECIMAL(5,4),                 -- 0.0 to 1.0
    attendance_factor DECIMAL(5,4),
    academic_factor DECIMAL(5,4),
    behavioral_factor DECIMAL(5,4),
    contributing_factors JSONB,              -- Array of factor descriptions
    assessed_at TIMESTAMP DEFAULT NOW(),
    model_version VARCHAR(50)
);

-- ============================================================
-- ACADEMIC PREDICTIONS
-- ============================================================
CREATE TABLE academic_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id),
    predicted_grade DECIMAL(5,2),
    confidence_score DECIMAL(5,4),
    prediction_quarter SMALLINT,
    school_year VARCHAR(20),
    predicted_at TIMESTAMP DEFAULT NOW(),
    model_version VARCHAR(50)
);

-- ============================================================
-- SECUREPASS QR DISMISSAL LOGS
-- ============================================================
CREATE TABLE dismissal_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id),
    authorized_by UUID REFERENCES users(id),   -- Parent/Guardian
    scanned_by UUID REFERENCES users(id),       -- Staff who scanned
    qr_token VARCHAR(255) NOT NULL,
    status VARCHAR(20) CHECK (status IN ('Success', 'Failed', 'Expired')),
    scanned_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50),                        -- alert, announcement, grade, attendance
    reference_id UUID,                       -- Link to related record
    is_read BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    posted_by UUID REFERENCES users(id),
    target_audience VARCHAR(20) DEFAULT 'all',  -- all, parents, teachers
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- VISTA Migration: Teacher Assignments
-- Run this once:  psql vista_db < database/migration_teacher_assignments.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS teacher_assignments (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    grade_level   VARCHAR(20) NOT NULL,
    section       VARCHAR(50) NOT NULL,
    subject       VARCHAR(100) NOT NULL,
    school_year   VARCHAR(20) NOT NULL DEFAULT '2024-2025',
    created_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(teacher_id, grade_level, section, subject, school_year)
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments(teacher_id);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX idx_attendance_student_date ON attendance(student_id, date);
CREATE INDEX idx_grades_student ON grades(student_id, school_year);
CREATE INDEX idx_behavior_student ON behavior_logs(student_id);
CREATE INDEX idx_risk_student ON risk_assessments(student_id);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read);

-- TO CHANGE COLUMN student_id to lrn IN students TABLE.*************
-- ============================================================
-- VISTA Migration: Rename student_id → lrn
-- Run once: psql vista_db < database/migration_lrn.sql
-- ============================================================

-- Rename column
ALTER TABLE students
  RENAME COLUMN student_id TO lrn;

-- Update unique constraint name for clarity
ALTER TABLE students
  RENAME CONSTRAINT students_student_id_key TO students_lrn_key;



  -- ============================================================
-- VISTA Migration: Update parent_student table
-- Run once: psql vista_db < database/migration_parent_student.sql
-- ============================================================

-- The `student_id` column in parent_student is a UUID foreign key
-- referencing students(id) — this is correct and stays as-is.
-- The LRN is a field on the students table, not here.

-- Rename relationship default to be more descriptive
ALTER TABLE parent_student
  ALTER COLUMN relationship SET DEFAULT 'Guardian';

-- Ensure is_authorized_pickup has a default
ALTER TABLE parent_student
  ALTER COLUMN is_authorized_pickup SET DEFAULT TRUE;

-- Add created_at if missing
ALTER TABLE parent_student
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Index for faster guardian lookups per student
CREATE INDEX IF NOT EXISTS idx_parent_student_student
  ON parent_student(student_id);

CREATE INDEX IF NOT EXISTS idx_parent_student_parent
  ON parent_student(parent_id);



  -- ============================================================
-- VISTA Migration: Restructure parent_student table
-- Guardian info now stored directly — no user account required.
-- Run once: psql vista_db < database/migration_parent_student_v2.sql
-- ============================================================

-- Add standalone contact columns
ALTER TABLE parent_student
  ADD COLUMN IF NOT EXISTS full_name            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS email                VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone                VARCHAR(50),
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMP DEFAULT NOW();

-- Make parent_id optional (guardian may or may not have a portal account)
ALTER TABLE parent_student
  ALTER COLUMN parent_id DROP NOT NULL;

-- Ensure defaults
ALTER TABLE parent_student
  ALTER COLUMN relationship         SET DEFAULT 'Guardian',
  ALTER COLUMN is_authorized_pickup SET DEFAULT TRUE;

-- Back-fill full_name + email + phone from linked users (if any)
UPDATE parent_student ps
SET
  full_name = u.full_name,
  email     = u.email,
  phone     = u.phone
FROM users u
WHERE ps.parent_id = u.id
  AND ps.full_name IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_parent_student_student ON parent_student(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_parent  ON parent_student(parent_id);



-- ============================================================
-- VISTA Migration: Sections table + seed default curriculum
-- Run once: psql vista_db < database/migration_curriculum.sql
-- ============================================================

-- ── Sections table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sections (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grade_level VARCHAR(20)  NOT NULL,
    name        VARCHAR(100) NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW(),
    UNIQUE(grade_level, name)
);

CREATE INDEX IF NOT EXISTS idx_sections_grade ON sections(grade_level);

-- ── Add is_active + updated_at to subjects (if missing) ───────
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_active  BOOLEAN   NOT NULL DEFAULT TRUE;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_grade_name_unique;
ALTER TABLE subjects ADD CONSTRAINT subjects_grade_name_unique UNIQUE (grade_level, name);

-- ── Seed default subjects ─────────────────────────────────────
INSERT INTO subjects (name, grade_level) VALUES
  -- Nursery
  ('Reading Readiness',  'Nursery'),
  ('Number Concepts',    'Nursery'),
  ('Arts & Crafts',      'Nursery'),
  ('Music & Movement',   'Nursery'),
  -- Kinder
  ('Reading Readiness',  'Kinder'),
  ('Number Concepts',    'Kinder'),
  ('Arts & Crafts',      'Kinder'),
  ('Music & Movement',   'Kinder'),
  ('Science Exploration','Kinder'),
  -- Grade 1
  ('Filipino',           'Grade 1'),
  ('English',            'Grade 1'),
  ('Mathematics',        'Grade 1'),
  ('Science',            'Grade 1'),
  ('Araling Panlipunan', 'Grade 1'),
  ('MAPEH',              'Grade 1'),
  ('Character Education','Grade 1'),
  -- Grade 2
  ('Filipino',           'Grade 2'),
  ('English',            'Grade 2'),
  ('Mathematics',        'Grade 2'),
  ('Science',            'Grade 2'),
  ('Araling Panlipunan', 'Grade 2'),
  ('MAPEH',              'Grade 2'),
  ('Character Education','Grade 2'),
  -- Grade 3
  ('Filipino',           'Grade 3'),
  ('English',            'Grade 3'),
  ('Mathematics',        'Grade 3'),
  ('Science',            'Grade 3'),
  ('Araling Panlipunan', 'Grade 3'),
  ('MAPEH',              'Grade 3'),
  ('Character Education','Grade 3'),
  -- Grade 4
  ('Filipino',           'Grade 4'),
  ('English',            'Grade 4'),
  ('Mathematics',        'Grade 4'),
  ('Science',            'Grade 4'),
  ('Araling Panlipunan', 'Grade 4'),
  ('MAPEH',              'Grade 4'),
  ('EPP',                'Grade 4'),
  ('Character Education','Grade 4'),
  -- Grade 5
  ('Filipino',           'Grade 5'),
  ('English',            'Grade 5'),
  ('Mathematics',        'Grade 5'),
  ('Science',            'Grade 5'),
  ('Araling Panlipunan', 'Grade 5'),
  ('MAPEH',              'Grade 5'),
  ('EPP',                'Grade 5'),
  ('Character Education','Grade 5'),
  -- Grade 6
  ('Filipino',           'Grade 6'),
  ('English',            'Grade 6'),
  ('Mathematics',        'Grade 6'),
  ('Science',            'Grade 6'),
  ('Araling Panlipunan', 'Grade 6'),
  ('MAPEH',              'Grade 6'),
  ('EPP',                'Grade 6'),
  ('Character Education','Grade 6')
ON CONFLICT (grade_level, name) DO NOTHING;

-- ── Seed default sections ─────────────────────────────────────
INSERT INTO sections (grade_level, name) VALUES
  ('Nursery', 'Sunflower'), ('Nursery', 'Daisy'),
  ('Kinder',  'Sampaguita'),('Kinder',  'Rosal'),
  ('Grade 1', 'Makabayan'), ('Grade 1', 'Masagana'),
  ('Grade 2', 'Mabuti'),    ('Grade 2', 'Magiting'),
  ('Grade 3', 'Matapat'),   ('Grade 3', 'Maliwanag'),
  ('Grade 4', 'Matalino'),  ('Grade 4', 'Malusog'),
  ('Grade 5', 'Mapagmahal'),('Grade 5', 'Matiyaga'),
  ('Grade 6', 'Maharlika'), ('Grade 6', 'Mabuhay')
ON CONFLICT (grade_level, name) DO NOTHING;


-- ============================================================
-- VISTA Migration: Add Pre-Nursery and Pre-Kinder
-- Run once: psql vista_db < database/migration_pre_levels.sql
-- ============================================================
 
-- Seed default subjects for Pre-Nursery and Pre-Kinder
INSERT INTO subjects (name, grade_level) VALUES
  ('Play & Learn',         'Pre-Nursery'),
  ('Sensory Activities',   'Pre-Nursery'),
  ('Arts & Crafts',        'Pre-Nursery'),
  ('Music & Movement',     'Pre-Nursery'),
  ('Reading Readiness',    'Pre-Kinder'),
  ('Number Concepts',      'Pre-Kinder'),
  ('Arts & Crafts',        'Pre-Kinder'),
  ('Music & Movement',     'Pre-Kinder'),
  ('Science Exploration',  'Pre-Kinder')
ON CONFLICT (grade_level, name) DO NOTHING;
 
-- Seed default sections for Pre-Nursery and Pre-Kinder
INSERT INTO sections (grade_level, name) VALUES
  ('Pre-Nursery', 'Butterfly'),
  ('Pre-Nursery', 'Dragonfly'),
  ('Pre-Kinder',  'Tulip'),
  ('Pre-Kinder',  'Iris')
ON CONFLICT (grade_level, name) DO NOTHING;


-- ============================================================
-- VISTA Migration: Split full_name → surname, first_name, middle_name
-- Drops and recreates relevant data. Run once:
-- psql vista_db < database/migration_name_split.sql
-- ============================================================

-- ── users table ───────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS surname     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS first_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);

-- Back-fill: treat existing full_name as first_name temporarily
UPDATE users SET first_name = full_name WHERE first_name IS NULL;

-- Make surname + first_name required going forward
ALTER TABLE users ALTER COLUMN surname    SET DEFAULT '',
                  ALTER COLUMN first_name SET DEFAULT '';

-- Add generated full_name column (always computed, never stored manually)
-- We keep full_name as a generated column for backward-compat with joins
ALTER TABLE users DROP COLUMN IF EXISTS full_name;
ALTER TABLE users ADD COLUMN full_name VARCHAR(255)
  GENERATED ALWAYS AS (
    surname || ', ' || first_name ||
    CASE WHEN middle_name IS NOT NULL AND middle_name <> ''
         THEN ' ' || middle_name ELSE '' END
  ) STORED;

-- ── students table ────────────────────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS surname     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS first_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);

UPDATE students SET first_name = full_name WHERE first_name IS NULL;

ALTER TABLE students DROP COLUMN IF EXISTS full_name;
ALTER TABLE students ADD COLUMN full_name VARCHAR(255)
  GENERATED ALWAYS AS (
    surname || ', ' || first_name ||
    CASE WHEN middle_name IS NOT NULL AND middle_name <> ''
         THEN ' ' || middle_name ELSE '' END
  ) STORED;

-- ── parent_student table (guardian contact info) ──────────────
ALTER TABLE parent_student
  ADD COLUMN IF NOT EXISTS surname     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS first_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);

UPDATE parent_student SET first_name = full_name WHERE first_name IS NULL;

ALTER TABLE parent_student DROP COLUMN IF EXISTS full_name;
ALTER TABLE parent_student ADD COLUMN full_name VARCHAR(255)
  GENERATED ALWAYS AS (
    COALESCE(surname, '') || CASE WHEN surname IS NOT NULL AND surname <> '' THEN ', ' ELSE '' END ||
    COALESCE(first_name, '') ||
    CASE WHEN middle_name IS NOT NULL AND middle_name <> ''
         THEN ' ' || middle_name ELSE '' END
  ) STORED;

-- ── Re-seed admin account (old data wiped) ────────────────────
-- Run seed-admin.js again after this migration if needed.




-- ============================================================
-- VISTA Migration: Add address fields
-- Run once: psql vista_db < database/migration_address.sql
-- ============================================================

-- Students: add home_address
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS home_address TEXT;

-- Guardians: add home_address
ALTER TABLE parent_student
  ADD COLUMN IF NOT EXISTS home_address TEXT;



-- ============================================================
-- VISTA Migration: home_address removed from users table
-- ============================================================

ALTER TABLE users DROP COLUMN IF EXISTS home_address;


  -- ============================================================
-- VISTA Migration: Add is_emergency_contact to parent_student
-- Run once: psql vista_db < database/migration_emergency_contact.sql
-- ============================================================

ALTER TABLE parent_student
  ADD COLUMN IF NOT EXISTS is_emergency_contact BOOLEAN NOT NULL DEFAULT FALSE;



-- ============================================================
-- VISTA Migration: School Years table
-- Run once: psql vista_db < database/migration_school_years.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS school_years (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label       VARCHAR(20)  NOT NULL UNIQUE,  -- e.g. "2024-2025"
    is_active   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_upcoming BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW()
);

-- Seed the active school year
INSERT INTO school_years (label, is_active)
VALUES ('2024-2025', TRUE)
ON CONFLICT (label) DO NOTHING;




-- ============================================================
-- VISTA Migration: School year context for subjects & sections
-- Run once: psql vista_db < database/migration_sy_curriculum.sql
-- ============================================================

-- Add dates to school_years
ALTER TABLE school_years
  ADD COLUMN IF NOT EXISTS start_date  DATE,
  ADD COLUMN IF NOT EXISTS end_date    DATE,
  ADD COLUMN IF NOT EXISTS is_upcoming BOOLEAN NOT NULL DEFAULT FALSE;

-- Add school_year_id to subjects
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id) ON DELETE CASCADE;

-- Add school_year_id to sections
ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id) ON DELETE CASCADE;

-- Back-fill existing subjects/sections to the current school year
UPDATE subjects
SET school_year_id = (SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1)
WHERE school_year_id IS NULL;

UPDATE sections
SET school_year_id = (SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1)
WHERE school_year_id IS NULL;

-- Make school_year_id required going forward
ALTER TABLE subjects ALTER COLUMN school_year_id SET NOT NULL;
ALTER TABLE sections ALTER COLUMN school_year_id SET NOT NULL;

-- Drop old unique constraints and add new ones including school_year_id
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_grade_name_unique;
ALTER TABLE subjects ADD CONSTRAINT subjects_sy_grade_name_unique
  UNIQUE(school_year_id, grade_level, name);

ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_grade_level_name_key;
ALTER TABLE sections ADD CONSTRAINT sections_sy_grade_name_unique
  UNIQUE(school_year_id, grade_level, name);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subjects_sy ON subjects(school_year_id);
CREATE INDEX IF NOT EXISTS idx_sections_sy ON sections(school_year_id);


-- ============================================================
-- VISTA Migration: Grading structure per subject
-- Allows configuring grading categories (e.g. Written Tasks 30%)
-- and components (e.g. Quizzes 15%) per subject.
-- ============================================================

CREATE TABLE IF NOT EXISTS grading_structure (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    category_id UUID REFERENCES grading_structure(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    weight      DECIMAL(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
    sort_order  SMALLINT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grading_structure_subject  ON grading_structure(subject_id);
CREATE INDEX IF NOT EXISTS idx_grading_structure_category ON grading_structure(category_id);


-- ============================================================
-- Score Items & Student Scores
-- Individual assessments (e.g. Quiz 1, Quiz 2) under grading
-- components, with per-student raw scores.
-- ============================================================

CREATE TABLE IF NOT EXISTS score_items (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    component_id           UUID NOT NULL REFERENCES grading_structure(id) ON DELETE CASCADE,
    subject_id             UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    quarter                SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    name                   VARCHAR(100) NOT NULL,
    highest_possible_score DECIMAL(7,2) NOT NULL CHECK (highest_possible_score > 0),
    sort_order             SMALLINT NOT NULL DEFAULT 0,
    created_by             UUID REFERENCES users(id),
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_items_unique_active ON score_items(component_id, quarter, name) WHERE is_active=TRUE;
CREATE INDEX IF NOT EXISTS idx_score_items_component ON score_items(component_id, quarter);
CREATE INDEX IF NOT EXISTS idx_score_items_subject   ON score_items(subject_id, quarter);

CREATE TABLE IF NOT EXISTS student_scores (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    score_item_id UUID NOT NULL REFERENCES score_items(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    score         DECIMAL(7,2) CHECK (score >= 0),
    recorded_by   UUID REFERENCES users(id),
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(score_item_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_scores_item    ON student_scores(score_item_id);
CREATE INDEX IF NOT EXISTS idx_student_scores_student ON student_scores(student_id);
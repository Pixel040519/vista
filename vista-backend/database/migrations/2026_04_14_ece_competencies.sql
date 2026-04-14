-- ============================================================
-- Migration: ECE Competency Module (Pre-Nursery to Kinder)
-- Adds domain/skill catalog + per-student quarterly records
-- using the E/G/F/NA qualitative scale from the NRYS manuscript.
-- ============================================================

BEGIN;

-- ── 1. Domain catalog ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS competency_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ── 2. Skill catalog (belongs to a domain) ─────────────────
CREATE TABLE IF NOT EXISTS competency_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES competency_domains(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (domain_id, name)
);

CREATE INDEX IF NOT EXISTS idx_competency_skills_domain ON competency_skills(domain_id);

-- ── 3. Per-student quarterly records ───────────────────────
-- Rating scale: E=Excellent, G=Good, F=Fair, NA=Needs Assistance
CREATE TABLE IF NOT EXISTS ece_competency_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES competency_skills(id) ON DELETE CASCADE,
    school_year_id UUID NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    rating VARCHAR(2) NOT NULL CHECK (rating IN ('E','G','F','NA')),
    notes TEXT,
    recorded_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (student_id, skill_id, school_year_id, quarter)
);

CREATE INDEX IF NOT EXISTS idx_ece_records_student ON ece_competency_records(student_id, school_year_id, quarter);
CREATE INDEX IF NOT EXISTS idx_ece_records_skill ON ece_competency_records(skill_id);

-- ── 4. Seed starter domains and skills ─────────────────────
-- Based on NRYS manuscript (Reading & Language Development,
-- Phonemic Awareness, Cognitive Development, Motor Development)
-- plus Social-Emotional which the manuscript references in the
-- Naïve Bayes readiness study (Siregar et al., 2025).

INSERT INTO competency_domains (name, description, display_order) VALUES
    ('Reading and Language Development', 'Vocabulary, comprehension, and verbal expression skills', 1),
    ('Phonemic Awareness', 'Recognition and manipulation of letter sounds', 2),
    ('Cognitive Development', 'Problem solving, memory, and early numeracy', 3),
    ('Motor Development', 'Gross and fine motor coordination', 4),
    ('Social-Emotional Development', 'Self-regulation, peer interaction, and classroom behavior', 5)
ON CONFLICT (name) DO NOTHING;

-- Reading and Language Development
INSERT INTO competency_skills (domain_id, name, description, display_order)
SELECT d.id, s.name, s.description, s.display_order
FROM competency_domains d
CROSS JOIN (VALUES
    ('Listens attentively to stories', 'Can focus on a read-aloud for 5+ minutes', 1),
    ('Follows 3-4 step instructions', 'Executes multi-step verbal directions in order', 2),
    ('Uses complete sentences when speaking', 'Expresses ideas in subject-verb-object form', 3),
    ('Identifies objects by name', 'Points to common objects when named by the teacher', 4)
) AS s(name, description, display_order)
WHERE d.name = 'Reading and Language Development'
ON CONFLICT (domain_id, name) DO NOTHING;

-- Phonemic Awareness
INSERT INTO competency_skills (domain_id, name, description, display_order)
SELECT d.id, s.name, s.description, s.display_order
FROM competency_domains d
CROSS JOIN (VALUES
    ('Identifies phonics sounds', 'Matches letters to their basic sounds', 1),
    ('Recognizes rhyming words', 'Can pick out words that rhyme from a set', 2),
    ('Claps out syllables in words', 'Segments simple words by syllable', 3),
    ('Identifies initial letter of own name', 'Recognizes and says first letter', 4)
) AS s(name, description, display_order)
WHERE d.name = 'Phonemic Awareness'
ON CONFLICT (domain_id, name) DO NOTHING;

-- Cognitive Development
INSERT INTO competency_skills (domain_id, name, description, display_order)
SELECT d.id, s.name, s.description, s.display_order
FROM competency_domains d
CROSS JOIN (VALUES
    ('Counts from 1 to 10', 'Recites numbers in order', 1),
    ('Sorts objects by color and shape', 'Groups items by a single attribute', 2),
    ('Completes simple puzzles (4-6 pieces)', 'Solves age-appropriate puzzles independently', 3),
    ('Recognizes basic shapes', 'Names circle, square, triangle, rectangle', 4)
) AS s(name, description, display_order)
WHERE d.name = 'Cognitive Development'
ON CONFLICT (domain_id, name) DO NOTHING;

-- Motor Development
INSERT INTO competency_skills (domain_id, name, description, display_order)
SELECT d.id, s.name, s.description, s.display_order
FROM competency_domains d
CROSS JOIN (VALUES
    ('Holds a pencil with proper grip', 'Uses tripod grip when drawing', 1),
    ('Cuts along a straight line with scissors', 'Controls scissors on a guided path', 2),
    ('Hops on one foot', 'Balances and hops without support', 3),
    ('Catches a ball with both hands', 'Tracks and catches a thrown ball', 4)
) AS s(name, description, display_order)
WHERE d.name = 'Motor Development'
ON CONFLICT (domain_id, name) DO NOTHING;

-- Social-Emotional Development
INSERT INTO competency_skills (domain_id, name, description, display_order)
SELECT d.id, s.name, s.description, s.display_order
FROM competency_domains d
CROSS JOIN (VALUES
    ('Shares toys and materials with peers', 'Takes turns without conflict', 1),
    ('Expresses emotions in words', 'Says "I feel sad/happy" instead of acting out', 2),
    ('Follows classroom rules', 'Transitions between activities when asked', 3),
    ('Separates from parent without distress', 'Enters classroom calmly at drop-off', 4)
) AS s(name, description, display_order)
WHERE d.name = 'Social-Emotional Development'
ON CONFLICT (domain_id, name) DO NOTHING;

COMMIT;

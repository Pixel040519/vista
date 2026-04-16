-- Migration: Link competency_skills to subjects instead of domains
-- ECE Competency page now uses curriculum subjects as domain groupings

-- Add subject_id column
ALTER TABLE competency_skills
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE;

-- Make domain_id nullable (was NOT NULL via the original schema)
ALTER TABLE competency_skills
  ALTER COLUMN domain_id DROP NOT NULL;

-- Drop old unique constraint on (domain_id, name)
ALTER TABLE competency_skills
  DROP CONSTRAINT IF EXISTS competency_skills_domain_id_name_key;

-- Add new unique constraint on (subject_id, name)
ALTER TABLE competency_skills
  ADD CONSTRAINT competency_skills_subject_id_name_key UNIQUE (subject_id, name);

-- Index for fast lookups by subject
CREATE INDEX IF NOT EXISTS idx_competency_skills_subject ON competency_skills(subject_id);

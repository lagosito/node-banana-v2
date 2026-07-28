-- T6: Add prompts_used and vertical_resolved columns to geo_check_reports
-- Run this in Supabase SQL Editor BEFORE deploying code changes

ALTER TABLE geo_check_reports
  ADD COLUMN IF NOT EXISTS prompts_used JSONB,
  ADD COLUMN IF NOT EXISTS vertical_resolved TEXT;

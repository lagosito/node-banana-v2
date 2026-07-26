-- GEO-Check: Add competitor + visibility summary columns
-- Run via Supabase SQL Editor

ALTER TABLE geo_check_reports
  ADD COLUMN IF NOT EXISTS top_competitor TEXT,
  ADD COLUMN IF NOT EXISTS top_competitor_mentions INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visibility_summary TEXT;

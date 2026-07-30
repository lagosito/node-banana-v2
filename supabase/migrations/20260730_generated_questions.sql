-- V1: Add generated_questions, question_source, brand_tokens columns
-- Run this in Supabase SQL Editor BEFORE deploying code changes

ALTER TABLE geo_check_reports
  ADD COLUMN IF NOT EXISTS generated_questions JSONB,
  ADD COLUMN IF NOT EXISTS question_source TEXT,
  ADD COLUMN IF NOT EXISTS brand_tokens JSONB;

-- GEO-Check: Persist reports + leads in Supabase (v2 — two-phase architecture)
-- Run via Supabase SQL Editor

-- ─── Reports table ───
CREATE TABLE IF NOT EXISTS geo_check_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_slug    TEXT UNIQUE NOT NULL,
  domain        TEXT NOT NULL,
  url           TEXT NOT NULL,
  resolved_url  TEXT,
  lang          TEXT,

  -- Phase 1: deterministic scores (filled by /quick)
  overall_score INT,
  category_scores   JSONB,
  citability        JSONB,
  findings          JSONB,
  top_problems      JSONB,
  verified_facts    JSONB,

  -- Phase 2: LLM results (filled by /llm)
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | error
  provider_status JSONB DEFAULT '{}'::jsonb,       -- { gemini: {status, queriesRun, mentions}, openai: {...}, perplexity: {...} }
  llm_results   JSONB,                             -- raw LLM responses per provider
  mention_rate  NUMERIC,
  queries_tested INT,

  -- Phase 2b: review (filled after LLM)
  quality_meta  JSONB,
  recommendations JSONB,

  -- Metadata
  brand_name    TEXT,
  vertical      TEXT,
  region        TEXT,
  subpages      JSONB,
  ai_crawler_facts JSONB,
  timings       JSONB,
  unlocked      BOOLEAN NOT NULL DEFAULT false,    -- email gate status
  lead_id       UUID,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_geo_reports_domain ON geo_check_reports(domain);
CREATE INDEX IF NOT EXISTS idx_geo_reports_slug   ON geo_check_reports(short_slug);
CREATE INDEX IF NOT EXISTS idx_geo_reports_status ON geo_check_reports(status);
CREATE INDEX IF NOT EXISTS idx_geo_reports_expires ON geo_check_reports(expires_at);

-- ─── Leads table ───
CREATE TABLE IF NOT EXISTS geo_check_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       UUID NOT NULL REFERENCES geo_check_reports(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  consent_privacy BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geo_leads_report ON geo_check_leads(report_id);
CREATE INDEX IF NOT EXISTS idx_geo_leads_email  ON geo_check_leads(email);

-- ─── Rate limits table ───
CREATE TABLE IF NOT EXISTS geo_check_rate_limits (
  ip          TEXT NOT NULL,
  day         DATE NOT NULL DEFAULT CURRENT_DATE,
  count       INT NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, day)
);

-- ─── RLS ───
ALTER TABLE geo_check_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_check_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_check_rate_limits ENABLE ROW LEVEL SECURITY;

-- Reports: anon can read safe fields only (gated logic in app code via view)
CREATE POLICY "anon_read_reports"
  ON geo_check_reports FOR SELECT
  USING (true);

-- Reports: service role full access
CREATE POLICY "service_role_all_reports"
  ON geo_check_reports FOR ALL
  USING (auth.role() = 'service_role');

-- Leads: service role only
CREATE POLICY "service_role_all_leads"
  ON geo_check_leads FOR ALL
  USING (auth.role() = 'service_role');

-- Rate limits: service role only
CREATE POLICY "service_role_all_rate_limits"
  ON geo_check_rate_limits FOR ALL
  USING (auth.role() = 'service_role');

-- GEO-Check: Persist reports + leads in Supabase
-- Run via Supabase SQL Editor or: psql -f this_file.sql

-- ─── Reports table ───
CREATE TABLE IF NOT EXISTS geo_check_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_slug    TEXT UNIQUE NOT NULL,
  domain        TEXT NOT NULL,
  url           TEXT NOT NULL,
  resolved_url  TEXT,
  lang          TEXT,
  overall_score INT,
  category_scores   JSONB,
  citability        JSONB,
  findings          JSONB,
  recommendations   JSONB,
  top_problems      JSONB,
  llm_visibility    JSONB,
  verified_facts    JSONB,
  quality_meta      JSONB,
  timings           JSONB,
  brand_name        TEXT,
  vertical          TEXT,
  region            TEXT,
  subpages          JSONB,
  ai_crawler_facts  JSONB,
  mention_rate      NUMERIC,
  queries_tested    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  lead_id       UUID
);

CREATE INDEX IF NOT EXISTS idx_geo_reports_domain ON geo_check_reports(domain);
CREATE INDEX IF NOT EXISTS idx_geo_reports_slug   ON geo_check_reports(short_slug);
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

-- ─── RLS: public read for reports by id or short_slug ───
ALTER TABLE geo_check_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_check_leads ENABLE ROW LEVEL SECURITY;

-- Reports: anyone can read (gated logic handled in app code)
CREATE POLICY "Public read reports"
  ON geo_check_reports FOR SELECT
  USING (true);

-- Reports: service role can do everything
CREATE POLICY "Service role full access reports"
  ON geo_check_reports FOR ALL
  USING (auth.role() = 'service_role');

-- Leads: service role only
CREATE POLICY "Service role full access leads"
  ON geo_check_leads FOR ALL
  USING (auth.role() = 'service_role');

-- Rate limits: service role only (no public access)
ALTER TABLE geo_check_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access rate_limits"
  ON geo_check_rate_limits FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Auto-cleanup: expires_at index handles TTL ───
-- Reports are filtered by expires_at in app code (WHERE expires_at > now())

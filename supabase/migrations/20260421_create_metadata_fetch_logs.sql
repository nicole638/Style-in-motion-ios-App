-- Per-source telemetry for product metadata fetching.
-- Each row = one fetch attempt (source × URL). Lets us tune the routing rules
-- by comparing per-domain quality, latency, and field completeness across sources.

CREATE TABLE IF NOT EXISTS metadata_fetch_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  url           text NOT NULL,
  domain        text NOT NULL,
  source        text NOT NULL,
  source_order  smallint NOT NULL,
  http_status   int,
  latency_ms    int NOT NULL,
  ok            boolean NOT NULL,
  fields_count  smallint NOT NULL,
  field_flags   jsonb NOT NULL,
  parser_path   text,
  is_final      boolean NOT NULL,
  error_message text,
  creator_id    uuid
);

CREATE INDEX IF NOT EXISTS metadata_fetch_logs_domain_idx
  ON metadata_fetch_logs(domain, created_at DESC);

CREATE INDEX IF NOT EXISTS metadata_fetch_logs_source_idx
  ON metadata_fetch_logs(source, created_at DESC);

-- RLS: authenticated users can insert; only service-role can select.
ALTER TABLE metadata_fetch_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY metadata_fetch_logs_insert
  ON metadata_fetch_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY metadata_fetch_logs_select_service
  ON metadata_fetch_logs FOR SELECT
  TO service_role
  USING (true);

-- Insight query (run from Supabase dashboard with service-role):
--
-- SELECT
--   domain, source,
--   COUNT(*) AS attempts,
--   ROUND(AVG(fields_count)::numeric, 2) AS avg_fields,
--   ROUND(100.0 * SUM(CASE WHEN fields_count >= 3 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_complete,
--   ROUND(AVG(latency_ms)::numeric) AS avg_latency_ms,
--   SUM(CASE WHEN is_final THEN 1 ELSE 0 END) AS times_used
-- FROM metadata_fetch_logs
-- WHERE created_at > now() - interval '14 days'
-- GROUP BY domain, source
-- ORDER BY domain, avg_fields DESC;

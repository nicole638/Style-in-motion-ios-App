// amazon-reports-sync — Pulls commission reports from the Amazon Creators
// API and stages them for ingestion into the commissions table.
//
// Pipeline:
//   1. Get a fresh access token from the amazon-token EF.
//   2. POST /reports/v1/listReports → {reports: [{filename, md5, size, lastModified}]}
//   3. For each report we haven't already ingested (dedupe by filename+md5):
//      a. POST /reports/v1/getReport {filename} → {url: <presigned download URL>}
//      b. GET that URL → the CSV/TSV report content
//      c. Parse it (best-effort; first run stashes raw header + sample to learn shape)
//      d. Upsert rows into commissions with affiliate_network='amazon'
//      e. Record the run in amazon_report_runs
//
// On the first non-empty response from Amazon we'll see the actual column
// shape via amazon_report_runs.raw_header. Then column-mapping in this EF
// can be tightened. Until then this EF is a safe no-op when Amazon has
// nothing to give us.
//
// INPUT:  { dry_run?: boolean }  — when true, skip the upsert; just record
//                                 what we'd ingest. Useful for first-run
//                                 inspection.
// OUTPUT: { ok, new_reports, parsed_rows, ingested_rows, reports: [...] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AMAZON_API_BASE = "https://creatorsapi.amazon";
const MARKETPLACE = "www.amazon.com";
const PARTNER_TAG = Deno.env.get("AMAZON_PA_API_PARTNER_TAG") ?? "styledinmotio-20";

// We invoke the token EF (deployed at amazon-token) for access tokens. It
// handles cache + refresh. Internal Edge-Function-to-EF calls go via the
// project's function-invocation URL using the service-role key.
const TOKEN_FN_URL =
  `${SUPABASE_URL.replace("https://", "https://").replace(".supabase.co", ".supabase.co")}/functions/v1/amazon-token`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface ReportMetadata {
  filename: string;
  md5: string;
  size: number;
  lastModified: string;
}

async function getAccessToken(): Promise<string> {
  const r = await fetch(TOKEN_FN_URL, {
    method: "POST",
    headers: {
      // Internal call. The token EF has verify_jwt=false so any valid key
      // works; the service-role bearer satisfies Supabase's gateway.
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "apikey": SERVICE_ROLE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    throw new Error(`amazon-token EF failed: ${r.status} ${await r.text()}`);
  }
  const body = await r.json();
  if (!body.access_token) {
    throw new Error(`amazon-token returned no access_token: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function amazonApi(
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; text: string; json: any }> {
  const r = await fetch(`${AMAZON_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* might be empty or non-JSON */
  }
  return { status: r.status, text, json };
}

// Light CSV parser — handles quoted fields with commas + escaped quotes.
// We don't know Amazon's exact format yet; this is generic and tolerates
// either CSV or TSV (the delimiter is auto-detected on the header).
function parseDelimited(
  raw: string,
): { delimiter: "," | "\t"; header: string[]; rows: string[][] } {
  // Strip optional BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const firstNewline = raw.indexOf("\n");
  const firstLine = firstNewline < 0 ? raw : raw.slice(0, firstNewline);
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter: "," | "\t" = tabs > commas ? "\t" : ",";

  const rows: string[][] = [];
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  while (i < raw.length) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  // Drop empty trailing rows
  while (rows.length && rows[rows.length - 1].every((v) => v.trim() === "")) {
    rows.pop();
  }
  return { delimiter, header, rows };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")
    return jsonRes({ error: "method_not_allowed" }, 405);

  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty is fine */
  }
  const dryRun = body.dry_run === true;

  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    return jsonRes(
      { error: "token_fetch_failed", detail: (e as Error).message },
      502,
    );
  }

  // 1. listReports
  const list = await amazonApi("/reports/v1/listReports", token, {});
  if (list.status !== 200 || !list.json) {
    return jsonRes(
      {
        error: "list_reports_failed",
        status: list.status,
        detail: list.text.slice(0, 500),
      },
      502,
    );
  }

  const reports: ReportMetadata[] = Array.isArray(list.json.reports)
    ? list.json.reports
    : [];

  if (reports.length === 0) {
    return jsonRes({
      ok: true,
      new_reports: 0,
      parsed_rows: 0,
      ingested_rows: 0,
      reports: [],
      note: "Amazon has no reports available yet. This is expected for a newly-registered Creators API account or between report cycles.",
    });
  }

  // 2. Dedupe: which (filename, md5) pairs haven't we processed?
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: alreadySeen } = await supa
    .from("amazon_report_runs")
    .select("filename, md5")
    .in(
      "filename",
      reports.map((r) => r.filename),
    );
  const seenSet = new Set(
    (alreadySeen ?? []).map((r: any) => `${r.filename}::${r.md5}`),
  );
  const newReports = reports.filter(
    (r) => !seenSet.has(`${r.filename}::${r.md5}`),
  );

  if (newReports.length === 0) {
    return jsonRes({
      ok: true,
      new_reports: 0,
      parsed_rows: 0,
      ingested_rows: 0,
      reports: reports.map((r) => ({ ...r, status: "already_ingested" })),
      note: "All available reports already ingested. Nothing new to pull.",
    });
  }

  // 3. For each new report — getReport → download → parse → (optionally) upsert
  const perReport: any[] = [];
  let totalParsed = 0;
  let totalIngested = 0;

  for (const meta of newReports) {
    const runReport: any = { filename: meta.filename, md5: meta.md5 };
    try {
      // 3a. getReport → presigned URL
      const got = await amazonApi("/reports/v1/getReport", token, {
        filename: meta.filename,
      });
      if (got.status !== 200 || !got.json?.url) {
        throw new Error(`getReport ${got.status}: ${got.text.slice(0, 200)}`);
      }
      const url = got.json.url as string;

      // 3b. Download the file from the presigned URL
      const dl = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!dl.ok) {
        throw new Error(`download ${dl.status}: ${(await dl.text()).slice(0, 200)}`);
      }
      const raw = await dl.text();

      // 3c. Parse
      const { header, rows } = parseDelimited(raw);
      runReport.delimiter_detected = raw.indexOf("\t") >= 0 ? "tab" : "comma";
      runReport.header = header;
      runReport.row_count = rows.length;

      // 3d. Save the audit row including the header + first 3 rows as a
      // sample so we can tune the parser when real data lands.
      const sample = rows
        .slice(0, 3)
        .map((r) => r.join("|"))
        .join("\n");
      await supa.from("amazon_report_runs").upsert({
        filename: meta.filename,
        md5: meta.md5,
        size_bytes: meta.size,
        last_modified: meta.lastModified,
        downloaded_at: new Date().toISOString(),
        parsed_at: new Date().toISOString(),
        rows_parsed: rows.length,
        rows_ingested: 0, // updated after upsert below
        raw_header: header.join("|"),
        raw_sample: sample.slice(0, 2000),
        parse_error: null,
      });

      totalParsed += rows.length;

      // 3e. Upsert into commissions. Because we don't know the exact column
      // shape yet, we do this defensively — try to map common Amazon report
      // column names. Anything we can't map we log to parse_error rather
      // than fail the whole run.
      if (!dryRun && rows.length > 0) {
        const mapped = mapRowsToCommissions(header, rows);
        if (mapped.errors.length > 0) {
          // Don't fail the run if mapping wasn't possible — just record it.
          // We'll iterate the parser once we see a real Amazon report.
          await supa
            .from("amazon_report_runs")
            .update({
              parse_error: mapped.errors.slice(0, 5).join("; "),
            })
            .eq("filename", meta.filename)
            .eq("md5", meta.md5);
        }
        if (mapped.rows.length > 0) {
          const { error: insErr } = await supa
            .from("commissions")
            .upsert(mapped.rows, {
              onConflict: "affiliate_network,affiliate_transaction_id",
              ignoreDuplicates: false,
            });
          if (insErr) {
            runReport.commissions_error = insErr.message;
          } else {
            await supa
              .from("amazon_report_runs")
              .update({ rows_ingested: mapped.rows.length })
              .eq("filename", meta.filename)
              .eq("md5", meta.md5);
            totalIngested += mapped.rows.length;
            runReport.ingested = mapped.rows.length;
          }
        }
      } else if (dryRun) {
        runReport.dry_run = true;
      }

      runReport.status = "ok";
    } catch (e) {
      runReport.status = "failed";
      runReport.error = (e as Error).message;
      await supa.from("amazon_report_runs").upsert({
        filename: meta.filename,
        md5: meta.md5,
        size_bytes: meta.size,
        last_modified: meta.lastModified,
        parse_error: (e as Error).message.slice(0, 500),
      });
    }
    perReport.push(runReport);
  }

  return jsonRes({
    ok: true,
    new_reports: newReports.length,
    parsed_rows: totalParsed,
    ingested_rows: totalIngested,
    reports: perReport,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Column mapping — best-effort, header-name based.
//
// Amazon Associates commission CSVs typically have columns like:
//   Date Shipped, ASIN, Title, Tracking ID, Price, Items Shipped,
//   Revenue / Earnings, Bounty Events, Commission Type, etc.
//
// We don't know the exact column names until we see a real report. Until
// then, this function recognizes a permissive set of synonyms and falls
// back to logging unmapped headers via the errors[] array.
// ─────────────────────────────────────────────────────────────────────────────
function mapRowsToCommissions(
  header: string[],
  rows: string[][],
): { rows: any[]; errors: string[] } {
  const errors: string[] = [];
  const headLow = header.map((h) => h.trim().toLowerCase());
  const findCol = (...synonyms: string[]) =>
    headLow.findIndex((h) => synonyms.some((s) => h === s || h.includes(s)));

  const idxDate = findCol("date shipped", "shipped date", "date", "order date");
  const idxAsin = findCol("asin");
  const idxTitle = findCol("title");
  const idxTag = findCol("tracking id", "tracking-id", "tag", "sub-id", "subid");
  const idxPrice = findCol("price", "item price");
  const idxEarnings = findCol("earnings", "commission earned", "revenue", "commission");
  const idxQty = findCol("items shipped", "qty", "quantity");

  if (idxAsin < 0) {
    errors.push(
      `No ASIN column in header (got: ${header.join("|").slice(0, 200)}). Cannot ingest.`,
    );
    return { rows: [], errors };
  }
  if (idxEarnings < 0) {
    errors.push(
      `No earnings/commission column found (got: ${header.join("|").slice(0, 200)}). Cannot ingest.`,
    );
    return { rows: [], errors };
  }

  const out: any[] = [];
  for (const row of rows) {
    const asin = (row[idxAsin] ?? "").trim();
    if (!asin || !/^B[0-9A-Z]{9}$/i.test(asin)) continue;

    const earnings = parseFloat((row[idxEarnings] ?? "0").replace(/[$,]/g, ""));
    if (!Number.isFinite(earnings)) continue;

    const price = idxPrice >= 0
      ? parseFloat((row[idxPrice] ?? "0").replace(/[$,]/g, ""))
      : null;

    // We don't have a transaction-id column in most Amazon report formats.
    // Build a stable synthetic id from filename + row signature so re-runs
    // dedupe on the same logical row.
    const orderDate = idxDate >= 0 ? row[idxDate] : null;
    const trackingId = idxTag >= 0 ? row[idxTag] : null;
    const transactionId = `amzn-${asin}-${trackingId ?? "x"}-${orderDate ?? "x"}-${earnings}`;

    out.push({
      affiliate_network: "amazon",
      affiliate_transaction_id: transactionId,
      merchant_name: "Amazon",
      merchant_domain: "amazon.com",
      sale_amount: price,
      commission_total: earnings,
      // We don't have a creator_id mapping yet — needs the tracking ID to
      // creator slug join, which we can do once we see real data.
      creator_id: null,
      creator_share: null,
      platform_share: earnings,
      order_date: orderDate,
      status: "confirmed",
      created_at: new Date().toISOString(),
    });
  }
  return { rows: out, errors };
}

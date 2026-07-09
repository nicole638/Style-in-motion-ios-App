import { Hono } from "hono";
import { env } from "../env";
import { syncAwinFeeds } from "../lib/awinFeedSync";

const awinSyncRouter = new Hono();

/**
 * POST /api/awin-sync/run
 *
 * Triggers the Hono-side ingest of oversized Awin feeds (see
 * lib/awinFeedSync.ts). Guarded by the shared secret header `x-awin-sync-secret`.
 * The job can run for several minutes (UA is ~45k rows), so we kick it off
 * asynchronously and return 202 immediately to avoid the Vibecode proxy timeout.
 *
 * Body (all optional):
 *   { "merchant_id": "<uuid>" }   -> ingest EXACTLY that one merchant (the pg_cron contract)
 *   { "merchantIds": ["<uuid>"] } -> ingest exactly those
 *   {} / no body                  -> sweep merchants flagged `hono_full_ingest = true` (UA only)
 *
 * The sweep deliberately keys off `hono_full_ingest`, never `skip_daily_sync` —
 * several oversized feeds carry skip_daily_sync but must stay partial/deduped.
 */
awinSyncRouter.post("/run", async (c) => {
  if (!env.AWIN_SYNC_SECRET) {
    return c.json(
      { error: { message: "awin sync disabled: AWIN_SYNC_SECRET unset", code: "disabled" } },
      503
    );
  }

  const provided = c.req.header("x-awin-sync-secret");
  if (provided !== env.AWIN_SYNC_SECRET) {
    return c.json({ error: { message: "unauthorized", code: "unauthorized" } }, 401);
  }

  // Parse leniently: the sweep mode sends no body.
  let body: { merchant_id?: unknown; merchantIds?: unknown } = {};
  try {
    body = (await c.req.json()) ?? {};
  } catch {
    body = {};
  }

  let merchantIds: string[] | undefined;
  if (typeof body.merchant_id === "string" && body.merchant_id.length > 0) {
    merchantIds = [body.merchant_id];
  } else if (Array.isArray(body.merchantIds)) {
    merchantIds = body.merchantIds.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (merchantIds && merchantIds.length === 0) merchantIds = undefined;

  // Fire and forget — the multi-minute job outlives the request.
  syncAwinFeeds(merchantIds ? { merchantIds } : undefined).catch((err) =>
    console.error("[awin-sync]", err)
  );

  return c.json(
    {
      data: {
        started: true,
        target: merchantIds ?? "hono_full_ingest",
      },
    },
    202
  );
});

export { awinSyncRouter };

// Read-only diagnostic window over the share-extension hand-off.
//
// The beacons themselves are written client-side (extension via anon key, app
// via the authed session) straight into public.share_beacon — see the
// 20260709030000_share_beacon.sql migration for the full rationale + the
// discriminator table. This endpoint just lets us SEE them (and the matching
// share_device_tokens rows) from the server, since Nicole can't read device
// logs. Service-role read; never exposes a write path.
import { Hono } from "hono";
import { getSupabaseAdmin } from "../lib/supabase";

const shareBeaconRouter = new Hono();

// GET /api/share-beacon/recent?limit=30
// Returns the most recent beacons from BOTH sides plus the newest share device
// tokens, so we can line up "app wrote / extension read" against whether the
// token row's last_used_at ever went non-null.
shareBeaconRouter.get("/recent", async (c) => {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return c.json(
      { error: { message: "Supabase admin unavailable", code: "DB_UNAVAILABLE" } },
      503
    );
  }

  const limit = Math.min(Number(c.req.query("limit")) || 30, 100);

  const [beaconsRes, tokensRes] = await Promise.all([
    supabase
      .from("share_beacon")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("share_device_tokens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (beaconsRes.error) {
    return c.json(
      { error: { message: beaconsRes.error.message, code: "BEACON_READ_FAILED" } },
      500
    );
  }

  const beacons = beaconsRes.data ?? [];
  const appBeacons = beacons.filter((b) => b.side === "app");
  const extBeacons = beacons.filter((b) => b.side === "ext");

  return c.json({
    data: {
      counts: {
        total: beacons.length,
        app: appBeacons.length,
        ext: extBeacons.length,
      },
      latest_app: appBeacons[0] ?? null,
      latest_ext: extBeacons[0] ?? null,
      beacons,
      // tokens may error if the column set drifts — surface it rather than 500
      // the whole endpoint, since the beacons are the primary signal.
      device_tokens: tokensRes.error
        ? { error: tokensRes.error.message }
        : tokensRes.data ?? [],
    },
  });
});

export { shareBeaconRouter };

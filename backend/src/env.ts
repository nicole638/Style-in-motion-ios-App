import { z } from "zod";

/**
 * Environment variable schema using Zod
 * This ensures all required environment variables are present and valid
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  SCRAPINGBEE_API_KEY: z.string().optional(),
  PHOTOROOM_API_KEY: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  AMAZON_PLATFORM_ASSOCIATES_TAG: z.string().optional(),
  // Optional for now: not used by click-time Awin rewrite (the Awin URLs
  // we receive already carry awinaffid). Needed in the next phase for the
  // closet Add flow that wraps raw merchant URLs in awin1.com/cread.php
  // ourselves. Marked optional so the server boots without it; Nicole
  // will populate the value once the slot exists.
  AWIN_PUBLISHER_ID: z.string().optional(),
  // Rakuten (LinkSynergy) publisher id / SID — the `id=` in click.linksynergy.com
  // deeplinks. Canonical source is rakuten_publisher_config (shared with the
  // rakuten-events-sync job); mirror that exact value here so /api/shop can build
  // Rakuten deeplinks inline at click time. Optional so the server boots without
  // it — when unset, Rakuten-merchant clicks fall through to the affiliate-wrap-url
  // EF (prior behavior) instead of leaking a raw brand URL with no inline wrap.
  RAKUTEN_PUBLISHER_ID: z.string().optional(),
  // Shared secret guarding POST /api/awin-sync/run, which triggers the
  // Hono-side ingest of oversized Awin product feeds (see
  // lib/awinFeedSync.ts). Optional so the server boots without it — when
  // unset, the endpoint responds 503 "disabled" instead of running.
  AWIN_SYNC_SECRET: z.string().optional(),
});

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    console.log("✅ Environment variables validated successfully");
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment variable validation failed:");
      error.issues.forEach((err: any) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validated and typed environment variables
 */
export const env = validateEnv();

/**
 * Type of the validated environment variables
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Extend process.env with our environment variables
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line import/namespace
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
}

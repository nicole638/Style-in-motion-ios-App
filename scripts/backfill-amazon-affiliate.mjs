/**
 * ONE-TIME BACKFILL: Wrap existing Amazon items with Associates affiliate tag.
 * Invokes the auto-tag-amazon edge function for each matching row.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/backfill-amazon-affiliate.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rghlcnrttvlvphzahudf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const THROTTLE_MS = 200; // 5 req/sec

async function main() {
  console.log('=== Amazon Affiliate Backfill ===\n');

  // Find all Amazon items without an affiliate URL
  const { data: items, error } = await supabase
    .from('creator_items')
    .select('id, url')
    .is('affiliate_url', null)
    .or('url.ilike.%amazon.%,url.ilike.%a.co/%,url.ilike.%amzn.to/%');

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  console.log(`Found ${items.length} items to process\n`);

  if (items.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const summary = { total: items.length, wrapped: 0, skipped_not_amazon: 0, failed: 0 };
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const progress = `[${i + 1}/${items.length}]`;

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('auto-tag-amazon', {
        body: { item_id: item.id },
      });

      if (invokeError) throw invokeError;

      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (result.ok) {
        if (result.reason === 'already_wrapped') {
          summary.wrapped++;
          console.log(`${progress} ${item.id} — already wrapped`);
        } else {
          summary.wrapped++;
          console.log(`${progress} ${item.id} — ${result.affiliate_url}`);
        }
      } else {
        if (result.reason === 'not_amazon') {
          summary.skipped_not_amazon++;
          console.log(`${progress} ${item.id} — not amazon (${item.url})`);
        } else {
          summary.failed++;
          errors.push({ id: item.id, url: item.url, reason: result.reason });
          console.log(`${progress} ${item.id} — ${result.reason}`);
        }
      }
    } catch (err) {
      summary.failed++;
      errors.push({ id: item.id, url: item.url, reason: err.message });
      console.error(`${progress} ${item.id} — ERROR: ${err.message}`);
    }

    // Throttle
    if (i < items.length - 1) {
      await new Promise(r => setTimeout(r, THROTTLE_MS));
    }
  }

  console.log('\n=== BACKFILL REPORT ===');
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  - ${e.id}: ${e.reason} (${e.url})`));
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

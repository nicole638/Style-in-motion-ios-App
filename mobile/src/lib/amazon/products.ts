import { supabase } from '@/lib/supabase';

const TTL_COMPLETE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for complete rows
const TTL_FAILED_MS = 60 * 60 * 1000;              // 1 hour for failed rows

export interface AmazonProduct {
  asin: string;
  title: string | null;
  imageUrl: string | null;
  detailPageUrl: string | null;
  fetchStatus: 'pending' | 'complete' | 'failed';
  fetchError: string | null;
  lastFetchedAt: string | null;
}

/**
 * Reads amazon_product_cache for the given ASINs, then fire-and-forgets the
 * enrich-amazon-asin Edge Function for any rows that are missing, stale
 * (complete > 7 days), or recently failed (failed > 1 hour).
 *
 * Returns a Map<ASIN, AmazonProduct> for rows already in cache.
 * Callers should re-fetch on the next focus event to pick up enriched rows.
 */
export async function fetchAmazonProductsForAsins(
  asins: string[],
): Promise<Map<string, AmazonProduct>> {
  const deduped = [...new Set(asins.map((a) => a.toUpperCase()))];
  if (deduped.length === 0) return new Map();

  const { data, error } = await supabase
    .from('amazon_product_cache')
    .select('asin, title, image_url, detail_page_url, fetch_status, fetch_error, last_fetched_at')
    .in('asin', deduped);

  if (error) {
    console.warn('[amazon/products] fetch error:', error.message);
    return new Map();
  }

  const cacheMap = new Map<string, AmazonProduct>();
  const now = Date.now();

  for (const row of data ?? []) {
    cacheMap.set(row.asin, {
      asin: row.asin,
      title: row.title,
      imageUrl: row.image_url,
      detailPageUrl: row.detail_page_url,
      fetchStatus: row.fetch_status,
      fetchError: row.fetch_error,
      lastFetchedAt: row.last_fetched_at,
    });
  }

  // Determine which ASINs need enrichment.
  const toEnrich: string[] = [];
  for (const asin of deduped) {
    const cached = cacheMap.get(asin);
    if (!cached) {
      toEnrich.push(asin);
    } else if (cached.fetchStatus === 'complete' && cached.lastFetchedAt) {
      if (now - new Date(cached.lastFetchedAt).getTime() > TTL_COMPLETE_MS) {
        toEnrich.push(asin);
      }
    } else if (cached.fetchStatus === 'failed' && cached.lastFetchedAt) {
      if (now - new Date(cached.lastFetchedAt).getTime() > TTL_FAILED_MS) {
        toEnrich.push(asin);
      }
    }
  }

  if (toEnrich.length > 0) {
    const batches: string[][] = [];
    for (let i = 0; i < toEnrich.length; i += 10) {
      batches.push(toEnrich.slice(i, i + 10));
    }
    // Fire-and-forget — do NOT await.
    Promise.allSettled(
      batches.map((batch) =>
        supabase.functions.invoke('enrich-amazon-asin', { body: { asins: batch } })
      ),
    ).catch(() => {});
  }

  return cacheMap;
}

export const amazonUrlForAsin = (asin: string): string =>
  `https://www.amazon.com/dp/${asin}`;

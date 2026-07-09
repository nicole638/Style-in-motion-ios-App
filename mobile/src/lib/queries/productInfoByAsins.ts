import { useQuery } from '@tanstack/react-query';

export interface ProductInfoByAsin {
  asin: string;
  product_name: string | null;
  image_url: string | null;
  product_url: string;
  price: number | null;
}

/**
 * Resolves Amazon product metadata (name, image, price) for a set of ASINs via
 * the backend /api/product-info batch endpoint. The backend dedupes/caps at 12
 * and always returns one row per requested ASIN (unresolved ones carry null
 * name/image/price). Order is NOT guaranteed, so we key results by `asin`.
 *
 * Mirrors the raw-fetch + body.data pattern in amazonCampaigns.ts.
 */
export async function fetchProductInfoByAsins(
  asins: string[],
): Promise<Map<string, ProductInfoByAsin>> {
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  const cleaned = [...new Set(asins.map((a) => a.trim()).filter((a) => a.length > 0))];
  if (!baseUrl || cleaned.length === 0) return new Map();

  const res = await fetch(
    `${baseUrl}/api/product-info?asins=${encodeURIComponent(cleaned.join(','))}`,
  );
  if (!res.ok) {
    console.warn('[product-info] fetch failed', res.status);
    return new Map();
  }
  const body = await res.json();
  const rows: ProductInfoByAsin[] = body.data ?? [];
  const map = new Map<string, ProductInfoByAsin>();
  for (const row of rows) {
    if (row?.asin) map.set(row.asin, row);
  }
  return map;
}

export function useProductInfoByAsins(asins: string[]) {
  // React Query serializes the queryKey, so the joined string is what actually
  // discriminates the cache entry — passing `asins` too keeps the
  // exhaustive-deps lint rule happy without changing cache identity (two arrays
  // with the same contents serialize identically).
  const key = [...asins].sort().join(',');
  return useQuery({
    queryKey: ['product-info', key, asins],
    queryFn: () => fetchProductInfoByAsins(asins),
    staleTime: 30 * 60 * 1000,
    enabled: asins.length > 0,
  });
}

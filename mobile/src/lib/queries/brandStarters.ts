import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface BrandStarterPick {
  product_id_in_feed: string;
  name: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  primary_image_url: string | null;
  lifestyle_image_url: string | null;
  image_urls: string[] | null;
  product_url: string | null;
  awin_deep_link: string | null;
  tier: 'lifestyle' | 'multi_image' | 'single_image';
}

async function fetchBrandStarterPicks(merchantId: string, limit = 12): Promise<BrandStarterPick[]> {
  const { data, error } = await supabase.rpc('get_brand_starter_picks', {
    p_merchant_id: merchantId,
    p_limit: limit,
  });
  if (error) {
    console.warn('[brandStarters] rpc failed', error.message);
    return [];
  }
  return (data ?? []) as BrandStarterPick[];
}

export function useBrandStarterPicks(merchantId: string, limit = 12) {
  return useQuery({
    queryKey: ['brand-starters', merchantId, limit],
    queryFn: () => fetchBrandStarterPicks(merchantId, limit),
    enabled: !!merchantId,
    staleTime: 5 * 60 * 1000,
  });
}

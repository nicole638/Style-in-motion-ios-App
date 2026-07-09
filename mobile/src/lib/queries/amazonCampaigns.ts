import { useQuery } from '@tanstack/react-query';

export interface AmazonFeaturedProduct {
  asin: string;
  title: string | null;
  image_url: string | null;
}

export interface AmazonCampaign {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  asins: string[];
  asin_links: Record<string, string>;
  start_date: string;
  end_date: string | null;
  commission_rate_pct: number;
  campaign_type: 'affiliate_plus' | 'sponsored_products';
  campaign_url: string | null;
  kw: string | null;
  shop_url: string | null;
  featured: AmazonFeaturedProduct | null;
}

async function fetchActiveAmazonCampaigns(): Promise<{ campaigns: AmazonCampaign[]; count: number }> {
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!baseUrl) return { campaigns: [], count: 0 };
  const res = await fetch(`${baseUrl}/api/campaigns/amazon-active`);
  if (!res.ok) {
    console.warn('[amazon-campaigns] fetch failed', res.status);
    return { campaigns: [], count: 0 };
  }
  const body = await res.json();
  return body.data ?? { campaigns: [], count: 0 };
}

export function useActiveAmazonCampaigns() {
  return useQuery({
    queryKey: ['amazon-campaigns', 'active'],
    queryFn: fetchActiveAmazonCampaigns,
    staleTime: 5 * 60 * 1000,
  });
}

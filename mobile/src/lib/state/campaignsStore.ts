import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export type CampaignType = 'affiliate_plus' | 'sponsored_products';
export type CampaignSource = 'amazon_cc' | 'cj' | 'rakuten' | 'awin' | 'manual';

export interface Campaign {
  id: string;
  brandName: string;
  brandLogoUrl: string | null;
  asins: string[];
  startDate: string;
  endDate: string;
  commissionRatePct: number;
  // Server-computed category bucket: 0=clothing, 1=shoes, 2=jewelry, 3=other.
  // Recomputed nightly via infer_department() over the campaign's products, so
  // it stays consistent with the Brands tab and web. Null on the oldest rows /
  // brand-new campaigns — callers treat null as 3 (other).
  categoryPriority: number | null;
  campaignType: CampaignType;
  source: CampaignSource;
  notes: string | null;
  budgetTotalUsd: number | null;
  budgetRemainingUsd: number | null;
  campaignUrl: string | null;
  asinLinks: Record<string, string>;
}

interface CampaignsStore {
  campaigns: Campaign[];
  loaded: boolean;
  loading: boolean;
  fetchActive: () => Promise<void>;
  findByAsin: (asin: string) => Campaign | null;
}

const useCampaignsStore = create<CampaignsStore>((set, get) => ({
  campaigns: [],
  loaded: false,
  loading: false,

  fetchActive: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .lte('start_date', today)
        .gte('end_date', today)
        .is('archived_at', null)
        .order('commission_rate_pct', { ascending: false })
        .order('end_date', { ascending: true });

      if (error) {
        console.warn('[campaignsStore] fetchActive error:', error.message);
        set({ loaded: true, loading: false });
        return;
      }

      const mapped: Campaign[] = (data ?? []).map((row: any) => ({
        id: row.id,
        brandName: row.brand_name,
        brandLogoUrl: row.brand_logo_url,
        asins: row.asins ?? [],
        startDate: row.start_date,
        endDate: row.end_date,
        commissionRatePct: Number.parseFloat(String(row.commission_rate_pct)),
        categoryPriority:
          row.category_priority === null || row.category_priority === undefined
            ? null
            : Number(row.category_priority),
        campaignType: row.campaign_type,
        source: row.source,
        notes: row.notes,
        budgetTotalUsd:
          row.budget_total_usd === null ? null : Number.parseFloat(String(row.budget_total_usd)),
        budgetRemainingUsd:
          row.budget_remaining_usd === null
            ? null
            : Number.parseFloat(String(row.budget_remaining_usd)),
        campaignUrl: row.campaign_url,
        asinLinks: (row.asin_links as Record<string, string>) ?? {},
      }));

      set({ campaigns: mapped, loaded: true, loading: false });
    } catch (e) {
      console.warn('[campaignsStore] fetchActive crash:', e);
      set({ loaded: true, loading: false });
    }
  },

  findByAsin: (asin: string): Campaign | null => {
    if (!asin) return null;
    const upper = asin.toUpperCase();
    const matches = get().campaigns.filter((c) => c.asins.includes(upper));
    if (matches.length === 0) return null;
    // Highest commission rate wins — mirrors Amazon CC behavior.
    return matches.reduce((best, c) =>
      c.commissionRatePct > best.commissionRatePct ? c : best,
    );
  },
}));

export default useCampaignsStore;

const ASIN_PATTERN = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/(B[0-9A-Z]{9})(?:[\/?#]|$)/i;
const ASIN_PARAM = /[?&]asin=(B[0-9A-Z]{9})\b/i;

export function extractAsin(url: string | null | undefined): string | null {
  if (!url) return null;
  const m1 = url.match(ASIN_PATTERN);
  if (m1?.[1]) return m1[1].toUpperCase();
  const m2 = url.match(ASIN_PARAM);
  if (m2?.[1]) return m2[1].toUpperCase();
  return null;
}

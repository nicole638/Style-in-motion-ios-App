import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { normalizeHost } from '@/lib/awin/wrap';
import { getMerchantDisplayOverride } from '@/lib/brandDisplay';

export interface AwinMerchant {
  /** Supabase row PK (uuid). Used to JOIN awin_products / awin_offers (their merchant_id FKs reference this). */
  id: string;
  /** Affiliate network this merchant belongs to. */
  network: 'awin' | 'rakuten';
  /** Awin merchant id — NULL for rakuten-network rows. Kept as number for backward compat with existing callers. */
  awinmid: number | null;
  /** Rakuten merchant id — NULL for awin-network rows. */
  rakuten_mid: string | null;
  /** Generic network merchant id (awinmid or rakuten_mid as a string). Always present. */
  network_mid: string;
  name: string;
  domain: string;             // primary host, already normalized
  altDomains: string[];       // alternates from affiliate_merchants.alt_domains text[]
  commissionMinPct: number | null;
  commissionMaxPct: number | null;
  // Enriched fields (may be null for older rows)
  logoUrl: string | null;
  description: string | null;
  epc: number | null;
  conversionRate: number | null;
  awinIndex: number | null;
  validationDays: number | null;
  primarySector: string | null;
  clickThroughUrl: string | null;
  /** Client-side pin weight (higher = earlier in the Brands tab). Default 0. */
  sortPriority: number;
}

interface AwinMerchantsStore {
  merchants: AwinMerchant[];
  loaded: boolean;
  loading: boolean;
  fetchActive: () => Promise<void>;
  findByHost: (host: string) => AwinMerchant | null;
  getById: (id: string) => AwinMerchant | null;
  getByAwinmid: (awinmid: number) => AwinMerchant | null;
}

function toNumOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

const useAwinMerchantsStore = create<AwinMerchantsStore>((set, get) => ({
  merchants: [],
  loaded: false,
  loading: false,

  fetchActive: async () => {
    if (get().loading || get().loaded) return;
    set({ loading: true });
    try {
      // Reads from the affiliate_merchants view (UNION ALL of awin_merchants + rakuten_merchants).
      // Per-network performance/offers (epc, conv, awin_index, validation_days) only exist for
      // Awin rows today; we select them with COALESCE-friendly defaults so Rakuten rows just get nulls.
      const { data, error } = await supabase
        .from('affiliate_merchants')
        .select('id, network, awinmid, rakuten_mid, network_mid, merchant_name, domain, alt_domains, commission_min, commission_max, logo_url, description, primary_sector, click_through_url')
        .eq('status', 'active')
        .is('archived_at', null);

      if (error) {
        console.warn('[awinMerchantsStore] fetchActive error:', error.message);
        set({ loaded: true, loading: false });
        return;
      }

      const mapped: AwinMerchant[] = (data ?? []).map((row: any) => {
        // Cosmetic, client-side relabel/pin (see lib/brandDisplay.ts). Leaves the
        // underlying merchant row untouched — only the displayed name + order change.
        const override = getMerchantDisplayOverride(String(row.id ?? ''));
        return ({
        id: String(row.id ?? ''),
        network: (row.network === 'rakuten' ? 'rakuten' : 'awin') as 'awin' | 'rakuten',
        awinmid: toIntOrNull(row.awinmid),
        rakuten_mid: row.rakuten_mid != null ? String(row.rakuten_mid) : null,
        network_mid: String(row.network_mid ?? ''),
        name: override?.displayName ?? row.merchant_name ?? '',
        domain: normalizeHost(String(row.domain ?? '')),
        altDomains: Array.isArray(row.alt_domains)
          ? row.alt_domains.map((d: string) => normalizeHost(String(d ?? ''))).filter(Boolean)
          : [],
        commissionMinPct: toNumOrNull(row.commission_min),
        commissionMaxPct: toNumOrNull(row.commission_max),
        logoUrl: row.logo_url ?? null,
        description: row.description ?? null,
        // epc / conversion_rate / awin_index / validation_days are not exposed by the view
        // (they are Awin-network performance fields living on awin_merchants only). Until the
        // view gains them, leave as null — the Brands UI already handles the null case.
        epc: null,
        conversionRate: null,
        awinIndex: null,
        validationDays: null,
        primarySector: row.primary_sector ?? null,
        clickThroughUrl: row.click_through_url ?? null,
        sortPriority: override?.sortPriority ?? 0,
      });
      });

      set({ merchants: mapped, loaded: true, loading: false });
    } catch (e) {
      console.warn('[awinMerchantsStore] fetchActive crash:', e);
      set({ loaded: true, loading: false });
    }
  },

  findByHost: (host: string) => {
    const normalized = normalizeHost(host);
    if (!normalized) return null;
    const merchants = get().merchants;
    for (const m of merchants) {
      if (m.domain === normalized) return m;
      if (m.altDomains.includes(normalized)) return m;
    }
    return null;
  },

  getById: (id: string) => {
    if (!id) return null;
    return get().merchants.find((m) => m.id === id) ?? null;
  },

  getByAwinmid: (awinmid: number) => {
    if (!Number.isFinite(awinmid)) return null;
    return get().merchants.find((m) => m.awinmid === awinmid) ?? null;
  },
}));

export default useAwinMerchantsStore;

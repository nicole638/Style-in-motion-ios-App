import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AwinPerformanceRow {
  merchantId: string;
  awinmid: number;
  merchantName: string;
  logoUrl: string | null;
  clicks: number;
  impressions: number;
  pendingCount: number;
  pendingValue: number;
  confirmedCount: number;
  confirmedValue: number;
}

/**
 * Aggregated per-merchant performance for the last 30 days.
 * NOTE: this is platform-wide (we don't currently split per-creator).
 */
export function useAwinPerformanceLast30Days(_creatorId?: string | null) {
  return useQuery({
    queryKey: ['awin', 'performance', 'last30'],
    queryFn: async () => {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const startISO = start.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('awin_performance_daily')
        .select('merchant_id, awinmid, impressions, clicks, pending_count, pending_value, confirmed_count, confirmed_value, awin_merchants(merchant_name, logo_url)')
        .gte('window_start', startISO);

      if (error) {
        console.warn('[useAwinPerformanceLast30Days] error:', error.message);
        throw error;
      }

      // Aggregate per merchant_id
      const grouped = new Map<string, AwinPerformanceRow>();
      for (const row of (data ?? []) as any[]) {
        const merchantId = String(row.merchant_id);
        const merchantJoin: any = row.awin_merchants ?? {};
        const existing = grouped.get(merchantId);
        const next: AwinPerformanceRow = existing ?? {
          merchantId,
          awinmid: Number(row.awinmid),
          merchantName: merchantJoin.merchant_name ?? '',
          logoUrl: merchantJoin.logo_url ?? null,
          clicks: 0,
          impressions: 0,
          pendingCount: 0,
          pendingValue: 0,
          confirmedCount: 0,
          confirmedValue: 0,
        };
        next.clicks += Number(row.clicks ?? 0);
        next.impressions += Number(row.impressions ?? 0);
        next.pendingCount += Number(row.pending_count ?? 0);
        next.pendingValue += Number(row.pending_value ?? 0);
        next.confirmedCount += Number(row.confirmed_count ?? 0);
        next.confirmedValue += Number(row.confirmed_value ?? 0);
        grouped.set(merchantId, next);
      }
      const out = Array.from(grouped.values());
      out.sort((a, b) => b.clicks - a.clicks);
      return out;
    },
    staleTime: 1000 * 60 * 10,
  });
}

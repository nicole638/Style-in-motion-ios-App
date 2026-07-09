// Per-item ranking + per-network breakdown for the creator analytics screen.
//
// Both wrap SECURITY DEFINER Postgres RPCs (creator_item_performance,
// creator_clicks_by_network) which gate-check `auth.uid() = p_creator_id`
// internally — passing someone else's id returns zero rows. Server-side
// aggregation across click_events × look_items × commissions keeps the
// client cheap (single round-trip instead of multi-table fetch + reduce).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ─── Per-item performance ───────────────────────────────────────────────────

export interface CreatorItemPerf {
  itemId: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  clicks: number;
  looksCount: number;
  earnings: number;
  commissionCount: number;
}

async function fetchCreatorItemPerformance(creatorId: string): Promise<CreatorItemPerf[]> {
  const { data, error } = await supabase.rpc('creator_item_performance', {
    p_creator_id: creatorId,
  });
  if (error) {
    console.warn('[creator-perf] item performance error:', error.message);
    return [];
  }
  return ((data ?? []) as Array<{
    item_id: string;
    name: string | null;
    brand: string | null;
    category: string | null;
    photo_url: string | null;
    clicks: number;
    looks_count: number;
    earnings_usd: string | number | null;
    commission_count: number;
  }>).map((row) => ({
    itemId: row.item_id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    photoUrl: row.photo_url,
    clicks: row.clicks ?? 0,
    looksCount: row.looks_count ?? 0,
    earnings: Number(row.earnings_usd ?? 0),
    commissionCount: row.commission_count ?? 0,
  }));
}

export function useCreatorItemPerformance(creatorId: string | null) {
  return useQuery<CreatorItemPerf[]>({
    queryKey: ['creator-item-performance', creatorId],
    queryFn: () => fetchCreatorItemPerformance(creatorId as string),
    enabled: !!creatorId,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Per-network breakdown ──────────────────────────────────────────────────

export interface CreatorNetworkBreakdown {
  network: string;
  label: string;
  clicks: number;
  earnings: number;
  commissionCount: number;
}

const NETWORK_LABEL: Record<string, string> = {
  amazon: 'Amazon',
  awin: 'Awin',
  cj: 'CJ',
  unaffiliated: 'Unaffiliated',
};

async function fetchClicksByNetwork(creatorId: string): Promise<CreatorNetworkBreakdown[]> {
  const { data, error } = await supabase.rpc('creator_clicks_by_network', {
    p_creator_id: creatorId,
  });
  if (error) {
    console.warn('[creator-perf] network breakdown error:', error.message);
    return [];
  }
  return ((data ?? []) as Array<{
    network: string;
    clicks: number;
    earnings_usd: string | number | null;
    commission_count: number;
  }>).map((row) => ({
    network: row.network,
    label: NETWORK_LABEL[row.network] ?? row.network,
    clicks: row.clicks ?? 0,
    earnings: Number(row.earnings_usd ?? 0),
    commissionCount: row.commission_count ?? 0,
  }));
}

export function useCreatorClicksByNetwork(creatorId: string | null) {
  return useQuery<CreatorNetworkBreakdown[]>({
    queryKey: ['creator-network-breakdown', creatorId],
    queryFn: () => fetchClicksByNetwork(creatorId as string),
    enabled: !!creatorId,
    staleTime: 5 * 60 * 1000,
  });
}

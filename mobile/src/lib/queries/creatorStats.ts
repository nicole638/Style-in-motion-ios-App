// Lightweight read-only counts for the creator's "Your performance" hero card.
//
// React-Query-driven:
//   - publishedLookCount: published, non-archived looks
//   - clickCount: total click_events rows for this creator
//   - viewCount: SUM(looks.views) for this creator (DB-backed, cross-device)
//   - signupAge: derived from auth.users.created_at via supabase.auth.getUser()
//
// Note on viewCount: `looks.views` is incremented atomically by the SECURITY
// DEFINER RPC `increment_look_views(uuid)` whenever a shopper opens a look
// (fired from ItemListSheet useEffect + look/[id].tsx mount + feed.tsx
// LookCard onPress). Previously views came from analyticsStore (Zustand,
// per-device), which is why creator dashboards stayed at 0 — shoppers'
// views never reached the creator's device. See migration
// 20260608233500_looks_views_counter_and_rpc.sql.
//
// No spinner anywhere upstream — callers should render `null` while data is
// loading and let the card simply appear once counts resolve.
import { useQuery } from '@tanstack/react-query';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';

export interface CreatorStats {
  publishedLookCount: number;
  clickCount: number;
  viewCount: number;
  signupAge: number; // days since signup
}

async function fetchCreatorStats(creatorId: string): Promise<CreatorStats> {
  // Four reads in parallel — each is a HEAD count or single-row read, so
  // total round-trip stays well under a second on typical mobile networks.
  // viewCount uses a select on looks.views and sums client-side. At our
  // scale (a creator has tens of looks, not thousands) the round-trip is
  // smaller than the latency of an aggregate RPC.
  const [looksResult, clicksResult, viewsResult, userResult] = await Promise.all([
    supabase
      .from('looks')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creatorId)
      .not('published_at', 'is', null)
      .eq('archived', false),
    supabase
      .from('click_events')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creatorId)
      // Exclude legacy seed/test bursts from the creator-facing click count.
      // New real shopper clicks default to is_test_burst=false on insert.
      .eq('is_test_burst', false),
    supabase
      .from('looks')
      .select('views')
      .eq('creator_id', creatorId)
      .eq('archived', false),
    supabase.auth.getUser(),
  ]);

  const publishedLookCount = looksResult.count ?? 0;
  const clickCount = clicksResult.count ?? 0;
  const viewCount = (viewsResult.data ?? []).reduce(
    (sum, row) => sum + (Number((row as { views?: number }).views) || 0),
    0,
  );

  const createdAtIso = userResult.data?.user?.created_at;
  const signupAge = createdAtIso
    ? differenceInDays(new Date(), new Date(createdAtIso))
    : 0;

  return { publishedLookCount, clickCount, viewCount, signupAge };
}

/**
 * In-app follower count for a creator. Reads the trigger-maintained
 * creator_profiles.app_follower_count (real + cross-device). Replaces the
 * old per-device followMap count that under-reported because it only saw
 * follows made on the current device.
 */
export function useAppFollowerCount(creatorId: string | null) {
  return useQuery<number>({
    queryKey: ['app-follower-count', creatorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('creator_profiles')
        .select('app_follower_count')
        .eq('creator_id', creatorId as string)
        .maybeSingle();
      if (error) {
        console.warn('[useAppFollowerCount] error:', error.message);
        return 0;
      }
      return Number((data as { app_follower_count?: number } | null)?.app_follower_count ?? 0);
    },
    enabled: !!creatorId,
    staleTime: 60 * 1000,
  });
}

export function useCreatorStats(creatorId: string | null) {
  return useQuery<CreatorStats>({
    queryKey: ['creator-stats', creatorId],
    queryFn: () => fetchCreatorStats(creatorId as string),
    enabled: !!creatorId,
    // Memoize for the session — we don't want a refresh button per spec.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

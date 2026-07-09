// Per-look creator earnings — sum of `creator_share` from commissions,
// joined to click_events to recover the look_id (commissions has no look_id
// of its own; it only links via click_event_id).
//
// Matches the status filter convention used by payments-payouts.tsx
// (pending + confirmed + paid count as "earned"; cancelled/reversed don't).
//
// Read directly from the client — RLS on commissions ("creators read own")
// and click_events ("Creators can view clicks on their looks") both allow
// the signed-in creator to see their own rows. No SECURITY DEFINER needed.
//
// If commission volume grows past a few thousand rows per creator, swap this
// for a Postgres RPC `creator_look_earnings(creator_id)` that aggregates
// server-side. The hook's return shape (`Record<lookId, number>`) won't
// change, so the tile consumers will keep working.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const COUNTING_STATUSES = ['pending', 'confirmed', 'paid'];

export type EarningsByLook = Record<string, number>;

async function fetchCreatorEarnings(creatorId: string): Promise<EarningsByLook> {
  const { data, error } = await supabase
    .from('commissions')
    .select('creator_share, click_events!inner(look_id, is_test_burst)')
    .eq('creator_id', creatorId)
    .in('status', COUNTING_STATUSES);
  if (error) throw error;

  const byLook: EarningsByLook = {};
  for (const row of data ?? []) {
    // The embed shape from supabase-js is `click_events: { look_id, is_test_burst }`
    // (single object because of FK + inner join).
    const ce = (row as {
      click_events?: { look_id?: string; is_test_burst?: boolean };
    }).click_events;
    const lookId = ce?.look_id;
    if (!lookId) continue;
    // Defensive: real commissions from Amazon never trace back to synthetic
    // test bursts, but exclude them just in case any QA data slipped in.
    if (ce?.is_test_burst === true) continue;
    const share = Number((row as { creator_share?: number | null }).creator_share ?? 0);
    if (!isFinite(share) || share === 0) continue;
    byLook[lookId] = (byLook[lookId] ?? 0) + share;
  }
  return byLook;
}

export function useCreatorEarnings(creatorId: string | null) {
  return useQuery<EarningsByLook>({
    queryKey: ['creator-earnings', creatorId],
    queryFn: () => fetchCreatorEarnings(creatorId as string),
    enabled: !!creatorId,
    staleTime: 5 * 60 * 1000, // 5 min — commissions don't change minute-to-minute
  });
}

/** "$8.40" / "$1,234.50". Empty string for non-positive values so callers can render null. */
export function formatEarnings(n: number): string {
  if (!isFinite(n) || n <= 0) return '';
  return `$${n.toFixed(2)}`;
}

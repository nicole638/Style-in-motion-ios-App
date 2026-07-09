// Fetch a specific creator's published looks for the public creator-profile
// screen. Doesn't touch useLookStore (which is scoped to the signed-in
// user) — every profile a shopper opens gets its own React Query cache
// keyed by creator_id, so switching between creators is clean.
//
// Pre-2026-06-08, creator-profile.tsx filtered useLookStore.looks by
// creatorId. That returned 0 looks whenever the signed-in user was not the
// creator being viewed (the store only ever holds the signed-in user's
// looks). Resulted in "No looks yet" on every creator profile a shopper
// opened — even when the creator had a healthy catalog.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  rowToLook,
  LOOK_ITEMS_EMBED,
  type Look,
  type LooksRow,
} from '@/lib/state/lookStore';

async function fetchCreatorLooks(creatorId: string): Promise<Look[]> {
  const { data, error } = await supabase
    .from('looks')
    .select(`*, ${LOOK_ITEMS_EMBED}`)
    .eq('creator_id', creatorId)
    .eq('archived', false)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false });
  if (error) {
    console.warn('[creator-looks] fetch error:', error.message);
    return [];
  }
  // Reuse the canonical rowToLook so this list shares the same mapping
  // (items resolution, alternates, normalizeCollageLayout) as the
  // signed-in user's lookStore data — so downstream components don't
  // need to know which path loaded the Look.
  return (data ?? []).map((row) => rowToLook(row as unknown as LooksRow));
}

export function useCreatorLooks(creatorId: string | null | undefined) {
  return useQuery<Look[]>({
    queryKey: ['creator-looks', creatorId],
    queryFn: () => fetchCreatorLooks(creatorId as string),
    enabled: !!creatorId,
    staleTime: 2 * 60 * 1000,
  });
}

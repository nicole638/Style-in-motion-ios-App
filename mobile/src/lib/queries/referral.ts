// Creator referral loop — light query wrappers around the two backend RPCs
// (`ensure_referral_code` + `claim_referral`).
//
// `useReferralCode` is session-memoized via React Query (`staleTime: Infinity`)
// because the code never changes once issued. `claimReferral` is a plain async
// helper — it's called exactly once at signup, so a hook adds no value.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Lazily ensures the calling creator has a referral code and returns it.
 * Backend RPC: `ensure_referral_code(p_creator_id uuid) returns text`.
 *
 * Memoized for the session — the code is stable per-creator so we never need
 * to refetch.
 */
export function useReferralCode(creatorId: string | null) {
  return useQuery<string>({
    queryKey: ['referral-code', creatorId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ensure_referral_code', {
        p_creator_id: creatorId as string,
      });
      if (error) {
        throw new Error(error.message);
      }
      // The RPC returns the code as a plain TEXT scalar.
      return (data as string) ?? '';
    },
    enabled: !!creatorId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export interface ClaimReferralResult {
  linked: boolean;
  referrer_id: string | null;
}

/**
 * Idempotent claim — call exactly once right after signup. Returns
 * `{ linked, referrer_id }`. Safe to fire-and-forget; if the code is
 * invalid or already claimed, the RPC returns `linked: false`.
 */
export async function claimReferral(
  referredId: string,
  code: string
): Promise<ClaimReferralResult | null> {
  try {
    const { data, error } = await supabase.rpc('claim_referral', {
      p_referred_id: referredId,
      p_code: code,
    });
    if (error) {
      console.warn('[claimReferral] RPC error:', error.message);
      return null;
    }
    // Supabase returns the row directly for `returns table(...)` RPCs. Some
    // configurations wrap it in a single-element array — normalize both.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      linked: !!row.linked,
      referrer_id: row.referrer_id ?? null,
    };
  } catch (e: any) {
    console.warn('[claimReferral] threw:', e?.message ?? e);
    return null;
  }
}

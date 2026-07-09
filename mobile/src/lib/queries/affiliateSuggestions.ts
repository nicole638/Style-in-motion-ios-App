// "You'd earn" affiliate-match suggestions — client adapters over the
// already-live DB engine. We only CALL these; the matching + the per-network
// link wrapping all live server-side:
//   - suggest_affiliate_matches()      live matcher (add-time card)
//   - get_closet_money_on_table()      precomputed per-creator (Studio strip)
//   - dismiss_affiliate_suggestion()   tombstone a suggestion
//   - swap-suggestion (edge function)  builds the affiliate link + writes the
//                                      item + marks the suggestion swapped, and
//                                      returns the link. NO client link-building.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type Confidence = 'high' | 'medium' | 'low';

// One suggested merchant from the live matcher (add-time).
export interface AffiliateMatch {
  merchantName: string;
  network: string;
  productName: string | null;
  price: number | null;
  commissionMax: number | null;
  imageUrl: string | null;
  deepLink: string | null;
  productUrl: string | null;
  nameSimilarity: number | null;
  confidence: Confidence;
  score: number | null;
}

// One (item × merchant) row from the precomputed Studio feed.
export interface MoneyOnTableRow extends AffiliateMatch {
  suggestionId: string;
}

// Grouped: one closet item with its ranked candidate merchants.
export interface MoneyOnTableItem {
  creatorItemId: string;
  itemName: string | null;
  itemBrand: string | null;
  itemPhotoUrl: string | null;
  merchants: MoneyOnTableRow[];
}

export const moneyOnTableKey = (creatorId: string | null) =>
  ['money-on-table', creatorId] as const;

// "$1,299.00" → 1299 ; "" / junk → null. Matcher wants numeric price or null.
export function parsePriceToNumber(
  price: string | number | null | undefined,
): number | null {
  if (price == null) return null;
  if (typeof price === 'number') return Number.isFinite(price) ? price : null;
  const cleaned = price.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "8" → "8" ; "8.5" → "8.5" — for "[X]% back".
export function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asConfidence(v: unknown): Confidence {
  return v === 'high' || v === 'medium' ? v : 'low';
}

type RawRow = Record<string, unknown>;

function mapMatch(row: RawRow): AffiliateMatch {
  return {
    merchantName: String(row.merchant_name ?? ''),
    network: String(row.network ?? ''),
    productName: (row.product_name as string | null) ?? null,
    price: toNum(row.price),
    commissionMax: toNum(row.commission_max),
    imageUrl: (row.image_url as string | null) ?? null,
    deepLink: (row.deep_link as string | null) ?? null,
    productUrl: (row.product_url as string | null) ?? null,
    nameSimilarity: toNum(row.name_similarity),
    confidence: asConfidence(row.confidence),
    score: toNum(row.score),
  };
}

// ─── Surface 1: live matcher (add-time) ──────────────────────────────────────
export async function suggestAffiliateMatches(args: {
  brand: string | null | undefined;
  name: string | null | undefined;
  price: string | number | null | undefined;
}): Promise<AffiliateMatch[]> {
  const brand = (args.brand ?? '').trim();
  if (!brand) return []; // matcher keys on brand — no brand, no call
  const { data, error } = await supabase.rpc('suggest_affiliate_matches', {
    p_brand: brand,
    p_name: (args.name ?? '').trim() || null,
    p_price: parsePriceToNumber(args.price),
    p_department: null,
    p_exclude_merchant: null,
    p_limit: 5,
  });
  if (error) {
    console.warn('[affiliate-suggest] matcher error:', error.message);
    return [];
  }
  return ((data ?? []) as RawRow[]).map(mapMatch); // already ranked by score
}

// ─── Surface 2: precomputed Studio feed ──────────────────────────────────────
async function fetchClosetMoneyOnTable(
  creatorId: string,
): Promise<MoneyOnTableItem[]> {
  const { data, error } = await supabase.rpc('get_closet_money_on_table', {
    p_creator_id: creatorId,
  });
  if (error) {
    console.warn('[money-on-table] fetch error:', error.message);
    return [];
  }
  // Group by creator_item_id, preserving the server's row order.
  const byItem = new Map<string, MoneyOnTableItem>();
  for (const raw of (data ?? []) as RawRow[]) {
    const creatorItemId = String(raw.creator_item_id ?? '');
    if (!creatorItemId) continue;
    const merchant: MoneyOnTableRow = {
      ...mapMatch(raw),
      suggestionId: String(raw.suggestion_id ?? ''),
    };
    let group = byItem.get(creatorItemId);
    if (!group) {
      group = {
        creatorItemId,
        itemName: (raw.item_name as string | null) ?? null,
        itemBrand: (raw.item_brand as string | null) ?? null,
        itemPhotoUrl: (raw.item_photo_url as string | null) ?? null,
        merchants: [],
      };
      byItem.set(creatorItemId, group);
    }
    group.merchants.push(merchant);
  }
  return [...byItem.values()];
}

export function useClosetMoneyOnTable(creatorId: string | null) {
  return useQuery<MoneyOnTableItem[]>({
    queryKey: moneyOnTableKey(creatorId),
    queryFn: () => fetchClosetMoneyOnTable(creatorId as string),
    enabled: !!creatorId,
    staleTime: 60 * 1000,
  });
}

// ─── Dismiss ─────────────────────────────────────────────────────────────────
export async function dismissAffiliateSuggestion(
  suggestionId: string,
): Promise<boolean> {
  const { error } = await supabase.rpc('dismiss_affiliate_suggestion', {
    p_suggestion_id: suggestionId,
  });
  if (error) {
    console.warn('[affiliate-suggest] dismiss error:', error.message);
    return false;
  }
  return true;
}

// ─── Swap & earn — server owns the wrap (no client link-building) ────────────
export interface SwapResult {
  ok: boolean;
  affiliateUrl?: string;
  provider?: string;
  error?: string;
}

// Pull the JSON `error` code out of a non-2xx edge-function response.
// supabase-js puts the raw Response on FunctionsHttpError.context.
async function readFunctionErrorCode(error: unknown): Promise<string | null> {
  try {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx && typeof (ctx as Response).json === 'function') {
      const bodyUnknown: unknown = await (ctx as Response).json();
      const code = (bodyUnknown as { error?: unknown })?.error;
      if (typeof code === 'string' && code.length > 0) return code;
    }
  } catch {
    // body already consumed / not JSON — fall back to the generic message
  }
  return null;
}

// suggestionId: include for the Studio strip (precomputed row); OMIT at add-time
// (live matches have no stored suggestion row).
export async function swapSuggestion(args: {
  creatorId: string;
  creatorItemId: string;
  productUrl: string;
  suggestionId?: string | null;
}): Promise<SwapResult> {
  try {
    const body: Record<string, unknown> = {
      creator_id: args.creatorId,
      creator_item_id: args.creatorItemId,
      product_url: args.productUrl,
    };
    if (args.suggestionId) body.suggestion_id = args.suggestionId;
    const { data, error } = await supabase.functions.invoke('swap-suggestion', {
      body,
    });
    if (error) {
      // The endpoint returns its {ok:false,error} bodies with non-2xx statuses
      // (e.g. wrap_unavailable=422, not_your_item=403). supabase-js flags those
      // as an error and leaves `data` null, putting the Response on
      // error.context — read it so we surface the real code, not "non-2xx".
      const code = await readFunctionErrorCode(error);
      console.warn('[swap-suggestion] failed:', code ?? error.message);
      return { ok: false, error: code ?? error.message };
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      affiliate_url?: string;
      provider?: string;
      error?: string;
    };
    // Defensive: also honor an {ok:false} returned WITH a 2xx status.
    if (!res.ok) return { ok: false, error: res.error ?? 'swap_failed' };
    return { ok: true, affiliateUrl: res.affiliate_url, provider: res.provider };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.warn('[swap-suggestion] threw:', msg);
    return { ok: false, error: msg };
  }
}

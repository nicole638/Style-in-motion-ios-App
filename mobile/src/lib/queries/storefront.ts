// Brand storefront read helpers — the data layer for showing a brand byline,
// powering the storefront switcher's metadata, and feeding the (eventual)
// /brand/<slug> shopper landing surfaces.
//
// All reads here ride existing RLS:
//   creator_profiles SELECT = public
//   brand_storefronts SELECT = (status='active' OR member-of-brand OR admin)
// so nothing here needs SECURITY DEFINER or service-role.
//
// Counterpart writes live in admin / context-aware insert paths; this file is
// READ ONLY.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface BrandIdentity {
  // Always present:
  creatorId: string;
  isPartnerBrand: boolean;
  // When isPartnerBrand === true:
  brandName: string | null;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  // When isPartnerBrand === false: the human display fields the caller may
  // want for the @username byline rendering (so we save a second query).
  username: string | null;
  photoUrl: string | null;
}

/** Internal: shape of the joined creator_profiles + brand_storefronts row. */
type ProfileRow = {
  creator_id: string;
  account_type: 'creator' | 'partner_brand' | null;
  username: string | null;
  photo_url: string | null;
};
type StorefrontRow = {
  storefront_creator_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  is_test: boolean;
};

async function fetchBrandIdentities(creatorIds: string[]): Promise<Record<string, BrandIdentity>> {
  const ids = Array.from(new Set(creatorIds.filter(Boolean)));
  if (ids.length === 0) return {};

  // Two cheap reads (creator_profiles + brand_storefronts) instead of a
  // !inner embed because most creators are NOT partner brands and we don't
  // want to drop their rows. supabase-js can't OR-join across two foreign
  // tables in a single select, so two queries it is.
  const [{ data: profileRows, error: profileError }, { data: storefrontRows, error: storefrontError }] =
    await Promise.all([
      supabase
        .from('creator_profiles')
        .select('creator_id, account_type, username, photo_url')
        .in('creator_id', ids),
      supabase
        .from('brand_storefronts')
        .select('storefront_creator_id, name, slug, logo_url, status, is_test')
        .in('storefront_creator_id', ids),
    ]);

  if (profileError) console.warn('[storefront] profile fetch error:', profileError.message);
  if (storefrontError) console.warn('[storefront] storefront fetch error:', storefrontError.message);

  const storefrontByCreator = new Map<string, StorefrontRow>();
  for (const row of (storefrontRows ?? []) as StorefrontRow[]) {
    if (row.status === 'archived') continue;
    storefrontByCreator.set(row.storefront_creator_id, row);
  }

  const out: Record<string, BrandIdentity> = {};
  for (const row of (profileRows ?? []) as ProfileRow[]) {
    const sf = storefrontByCreator.get(row.creator_id);
    const isPartnerBrand = row.account_type === 'partner_brand' && !!sf;
    out[row.creator_id] = {
      creatorId: row.creator_id,
      isPartnerBrand,
      brandName: sf?.name ?? null,
      brandSlug: sf?.slug ?? null,
      // Prefer the storefront's logo_url, fall back to creator_profiles.photo_url
      // (they're seeded identically today but the storefront record wins).
      brandLogoUrl: sf?.logo_url ?? row.photo_url ?? null,
      username: row.username,
      photoUrl: row.photo_url,
    };
  }
  // Fill in any ids that came back from neither table (deleted accounts etc.)
  // with non-brand placeholders so callers can iterate safely.
  for (const id of ids) {
    if (!out[id]) {
      out[id] = {
        creatorId: id,
        isPartnerBrand: false,
        brandName: null,
        brandSlug: null,
        brandLogoUrl: null,
        username: null,
        photoUrl: null,
      };
    }
  }
  return out;
}

/**
 * Batch lookup: resolve a set of creator_ids to brand-aware display info.
 * React-Query cached by the sorted id-tuple so re-renders are cheap.
 */
export function useBrandIdentities(creatorIds: string[]) {
  const key = Array.from(new Set(creatorIds.filter(Boolean))).sort();
  return useQuery<Record<string, BrandIdentity>>({
    queryKey: ['brand-identities', key],
    queryFn: () => fetchBrandIdentities(key),
    enabled: key.length > 0,
    staleTime: 5 * 60 * 1000, // 5 min — brand profile changes are rare
  });
}

/** Single-id convenience wrapper for byline components. */
export function useBrandIdentity(creatorId: string | null | undefined) {
  const ids = creatorId ? [creatorId] : [];
  const q = useBrandIdentities(ids);
  const identity: BrandIdentity | undefined = creatorId ? q.data?.[creatorId] : undefined;
  return { ...q, identity };
}

// ────────────────────────────────────────────────────────────────────────────
// Shopper-facing reads — used by the public storefront landing page,
// /storefront/<slug> deep links, the Featured Brands rail, and the public
// /brands directory tab.
// ────────────────────────────────────────────────────────────────────────────

export interface PublicStorefrontSummary {
  // For card grids + the featured rail. Skinny shape so the rail query
  // doesn't pull brand_story or fulfillment when it doesn't need them.
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  storefrontCreatorId: string;
}

export interface PublicStorefrontDetail extends PublicStorefrontSummary {
  brandStory: string | null;
  promoCode: string | null;
  fulfillment: Array<{ channel: string; url: string }>;
  contactEmail: string | null;
}

/**
 * List of every active partner brand for the rail + directory. Excludes
 * test brands AND archived/paused storefronts so shoppers never see
 * not-ready content. Ordered by created_at desc — newest brands surface
 * first on the rail.
 */
async function fetchActiveStorefronts(): Promise<PublicStorefrontSummary[]> {
  const { data, error } = await supabase
    .from('brand_storefronts')
    .select('id, slug, name, logo_url, storefront_creator_id, status, is_test')
    .eq('status', 'active')
    .eq('is_test', false)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[storefront] fetchActiveStorefronts error:', error.message);
    return [];
  }
  return (data ?? [])
    .map((r): PublicStorefrontSummary | null => {
      const id = (r as { id?: string }).id;
      const slug = (r as { slug?: string }).slug;
      const name = (r as { name?: string }).name;
      const storefrontCreatorId = (r as { storefront_creator_id?: string }).storefront_creator_id;
      if (!id || !slug || !name || !storefrontCreatorId) return null;
      return {
        id,
        slug,
        name,
        logoUrl: (r as { logo_url?: string | null }).logo_url ?? null,
        storefrontCreatorId,
      };
    })
    .filter((r): r is PublicStorefrontSummary => r !== null);
}

export function useActiveStorefronts() {
  return useQuery<PublicStorefrontSummary[]>({
    queryKey: ['storefront', 'active'],
    queryFn: fetchActiveStorefronts,
    staleTime: 5 * 60 * 1000, // 5 min — brand roster changes rarely
  });
}

/**
 * Single-storefront fetch by slug — powers /storefront/[slug]. Returns
 * the full PublicStorefrontDetail shape (brand story, promo, fulfillment)
 * plus the storefront content account id needed to drive the looks query
 * below. Returns null for unknown slugs (404) or for non-active storefronts
 * (so a paused or archived brand stops accepting shopper traffic without
 * breaking deep links — the page renders a "Brand isn't open right now"
 * fallback).
 */
async function fetchStorefrontBySlug(slug: string): Promise<PublicStorefrontDetail | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from('brand_storefronts')
    .select(
      'id, slug, name, logo_url, storefront_creator_id, brand_story, promo_code, fulfillment, contact_email, status, is_test',
    )
    .eq('slug', normalized)
    .maybeSingle();
  if (error) {
    console.warn('[storefront] fetchStorefrontBySlug error:', error.message);
    return null;
  }
  if (!data) return null;
  const status = (data as { status?: string }).status;
  if (status !== 'active') return null;

  const fulfillmentRaw = (data as { fulfillment?: unknown }).fulfillment;
  const fulfillment = Array.isArray(fulfillmentRaw)
    ? (fulfillmentRaw as Array<{ channel?: string; url?: string }>)
        .filter((f) => typeof f?.channel === 'string' && typeof f?.url === 'string' && f.url.length > 0)
        .map((f) => ({ channel: f.channel as string, url: f.url as string }))
    : [];

  return {
    id: (data as { id: string }).id,
    slug: (data as { slug: string }).slug,
    name: (data as { name: string }).name,
    logoUrl: (data as { logo_url?: string | null }).logo_url ?? null,
    storefrontCreatorId: (data as { storefront_creator_id: string }).storefront_creator_id,
    brandStory: (data as { brand_story?: string | null }).brand_story ?? null,
    promoCode: (data as { promo_code?: string | null }).promo_code ?? null,
    fulfillment,
    contactEmail: (data as { contact_email?: string | null }).contact_email ?? null,
  };
}

export function useStorefrontBySlug(slug: string | null | undefined) {
  return useQuery<PublicStorefrontDetail | null>({
    queryKey: ['storefront', 'by-slug', slug ?? ''],
    queryFn: () => fetchStorefrontBySlug(slug as string),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export interface StorefrontLookSummary {
  id: string;
  coverPhotoUrl: string | null;
  publishedAt: string | null;
  likesCount: number;
  clicks: number;
}

/**
 * Storefront-scoped look fetch — used by brand dashboard surfaces and the
 * shopper-facing /storefront/[slug] landing page. Returns looks where
 * `creator_id` is the storefront's content account id.
 *
 * RLS coverage: published rows (`archived=false AND published_at IS NOT NULL`)
 * are public-readable. Draft rows additionally readable by storefront members
 * via `looks_select_storefront_members`. So stylists see drafts + published;
 * shoppers see only published.
 */
export async function fetchStorefrontLooks(args: {
  storefrontCreatorId: string;
  includeDrafts?: boolean;
  limit?: number;
}): Promise<StorefrontLookSummary[]> {
  const { storefrontCreatorId, includeDrafts = false, limit = 60 } = args;
  let q = supabase
    .from('looks')
    .select('id, cover_photo_url, published_at, archived, likes_count, clicks')
    .eq('creator_id', storefrontCreatorId)
    .eq('archived', false)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (!includeDrafts) q = q.not('published_at', 'is', null);
  const { data, error } = await q;
  if (error) {
    console.warn('[storefront] fetchStorefrontLooks error:', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: String((r as { id: string | number }).id),
    coverPhotoUrl: (r as { cover_photo_url?: string | null }).cover_photo_url ?? null,
    publishedAt: (r as { published_at?: string | null }).published_at ?? null,
    likesCount: Number((r as { likes_count?: number }).likes_count ?? 0),
    clicks: Number((r as { clicks?: number }).clicks ?? 0),
  }));
}

/** React Query wrapper around fetchStorefrontLooks for the shopper page. */
export function useStorefrontLooks(storefrontCreatorId: string | null | undefined) {
  return useQuery<StorefrontLookSummary[]>({
    queryKey: ['storefront', 'looks', storefrontCreatorId ?? ''],
    queryFn: () => fetchStorefrontLooks({ storefrontCreatorId: storefrontCreatorId as string }),
    enabled: !!storefrontCreatorId,
    staleTime: 2 * 60 * 1000,
  });
}

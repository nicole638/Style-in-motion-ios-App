// Storefront context — who am I writing AS right now?
//
// When Kerri is signed in as herself, she may be a stylist member of one or
// more partner brands (Golden Bear Garage today, plus whatever future brand
// storefronts get assigned to her). When she "switches into" a brand, every
// look / item write she performs uses the brand's storefront creator_id
// instead of her own — so Amazon clicks attribute to the brand's tag, the
// look shows the brand byline in the feed, and Billy's earnings dashboard
// captures the revenue.
//
// Normal creators (zero memberships) never see this in the UI — the
// switcher renders null when memberships.length === 0, so single-creator
// accounts get zero behavioral change.
//
// Defense in depth: the brand_* RLS policies enforce the access model at
// the DB layer too. If a non-stylist tries to write under a storefront
// creator_id the insert is rejected. The store is the UX surface, RLS is
// the gate.
//
// Sequencing note (matches CHANGES.md §6e plumb order):
//   1. authStore.initialize / login calls `loadMemberships(creatorId)`
//   2. write paths read `getWriteAsCreatorId()` for `creator_id` and
//      always set `authored_by = personalCreatorId` for credit
//   3. card byline + brand-scoped queries pull `account_type` to branch
//      brand-vs-creator rendering (see lib/queries/storefront.ts)

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export type BrandRole = 'owner' | 'stylist' | 'analyst';
export type ContextMode = 'personal' | 'storefront';

export interface BrandMembershipRow {
  // brand_storefronts.id
  brandId: string;
  // brand_storefronts.name — shown in the switcher
  brandName: string;
  // brand_storefronts.slug — used for /brand/<slug> deep links
  brandSlug: string;
  // brand_storefronts.logo_url — shown as the chip avatar
  brandLogoUrl: string | null;
  // brand_storefronts.storefront_creator_id — the creator_id used for writes
  storefrontCreatorId: string;
  // brand_storefronts.is_test — Test Brand is hidden from production analytics
  isTest: boolean;
  // brand_memberships.role — gates capabilities client-side
  role: BrandRole;
}

interface ContextState {
  // The signed-in human's auth.uid(). Mirror of authStore.creatorId.
  personalCreatorId: string | null;
  // Default 'personal' on every login — last-context-used persistence is
  // explicitly out of scope (the design doc locked Billy = owner, view only).
  mode: ContextMode;
  // brand_storefronts.id when mode === 'storefront'; null otherwise.
  activeBrandId: string | null;
  // All active brand memberships the human holds (already filtered to status='active').
  memberships: BrandMembershipRow[];
  // Loading flag for the initial membership fetch — UI can dim the switcher
  // until populated to avoid the brand list appearing after a beat.
  membershipsLoading: boolean;

  // Selectors (kept as methods so non-React callers like lookStore can read
  // them imperatively via useContextStore.getState().…())
  getWriteAsCreatorId: () => string | null;
  getActiveBrand: () => BrandMembershipRow | null;

  // Mutations
  setPersonalCreatorId: (id: string | null) => void;
  loadMemberships: (personalCreatorId: string) => Promise<void>;
  switchToBrand: (brandId: string) => void;
  switchToPersonal: () => void;
  clear: () => void;
}

const useContextStore = create<ContextState>()((set, get) => ({
  personalCreatorId: null,
  mode: 'personal',
  activeBrandId: null,
  memberships: [],
  membershipsLoading: false,

  getWriteAsCreatorId: () => {
    const s = get();
    if (s.mode === 'storefront' && s.activeBrandId) {
      const m = s.memberships.find((x) => x.brandId === s.activeBrandId);
      if (m) return m.storefrontCreatorId;
    }
    return s.personalCreatorId;
  },

  getActiveBrand: () => {
    const s = get();
    if (s.mode !== 'storefront' || !s.activeBrandId) return null;
    return s.memberships.find((x) => x.brandId === s.activeBrandId) ?? null;
  },

  setPersonalCreatorId: (id) => set({ personalCreatorId: id }),

  loadMemberships: async (personalCreatorId) => {
    set({ membershipsLoading: true });
    try {
      // RLS on brand_memberships (`select_self`) lets the signed-in user read
      // their own rows; brand_storefronts `select_members` lets them join.
      // The !inner ensures rows without a still-existing storefront row drop out.
      const { data, error } = await supabase
        .from('brand_memberships')
        .select(
          'brand_id, role, status, ' +
            'brand_storefronts!inner(id, name, slug, logo_url, storefront_creator_id, is_test, status)'
        )
        .eq('creator_id', personalCreatorId)
        .eq('status', 'active');
      if (error) {
        // Non-fatal — log and proceed with empty memberships. RLS misconfig
        // is the most likely cause; the switcher will simply not render.
        console.warn('[contextStore] loadMemberships error:', error.message);
        set({ memberships: [], membershipsLoading: false });
        return;
      }
      const rows = (data ?? [])
        .map((row): BrandMembershipRow | null => {
          // The embed shape from supabase-js is `brand_storefronts: { … }`
          // (single object because of FK + inner join).
          const bs = (row as {
            brand_storefronts?: {
              id?: string;
              name?: string;
              slug?: string;
              logo_url?: string | null;
              storefront_creator_id?: string;
              is_test?: boolean;
              status?: string;
            };
          }).brand_storefronts;
          const brandId = bs?.id;
          const name = bs?.name;
          const slug = bs?.slug;
          const storefrontCreatorId = bs?.storefront_creator_id;
          if (!brandId || !name || !slug || !storefrontCreatorId) return null;
          // Hide archived storefronts from the switcher even if the membership
          // is still 'active' — admin can re-archive without revoking memberships.
          if (bs?.status === 'archived') return null;
          const role = (row as { role?: string }).role;
          if (role !== 'owner' && role !== 'stylist' && role !== 'analyst') return null;
          return {
            brandId,
            brandName: name,
            brandSlug: slug,
            brandLogoUrl: bs?.logo_url ?? null,
            storefrontCreatorId,
            isTest: bs?.is_test ?? false,
            role,
          };
        })
        .filter((r): r is BrandMembershipRow => r !== null);
      set({ memberships: rows, membershipsLoading: false });
    } catch (e) {
      console.warn('[contextStore] loadMemberships threw:', e);
      set({ memberships: [], membershipsLoading: false });
    }
  },

  switchToBrand: (brandId) => {
    const s = get();
    const m = s.memberships.find((x) => x.brandId === brandId);
    if (!m) {
      console.warn('[contextStore] switchToBrand: unknown brandId', brandId);
      return;
    }
    set({ mode: 'storefront', activeBrandId: brandId });
  },

  switchToPersonal: () => set({ mode: 'personal', activeBrandId: null }),

  // Called on logout. Wipes the in-memory context completely so a different
  // signin doesn't inherit the prior user's memberships.
  clear: () =>
    set({
      personalCreatorId: null,
      mode: 'personal',
      activeBrandId: null,
      memberships: [],
      membershipsLoading: false,
    }),
}));

export default useContextStore;

// Convenience for non-React callers (e.g. lookStore.publishLook). Returns the
// creator_id to use for *new content writes* right now. Fall back to the raw
// auth.uid() if the store is unhydrated for any reason — better to write as
// personal than to fail the insert.
export function getActiveWriteAsCreatorId(fallbackPersonalId: string | null): string | null {
  const id = useContextStore.getState().getWriteAsCreatorId();
  return id ?? fallbackPersonalId;
}

// True only when writing on behalf of a brand. Useful for UI affordances
// ("Acting as Golden Bear Garage" banner) and analytics tagging.
export function isStorefrontContext(): boolean {
  return useContextStore.getState().mode === 'storefront';
}

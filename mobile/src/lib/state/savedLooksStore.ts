// Saved looks — DB-backed. Shoppers bookmark a whole look from the
// "Shop This Look" sheet; saves live in the `saved_looks` table so they
// persist cross-device and survive reinstall. Mirrors savedItemsStore.
//
// This is deliberately separate from "likes" (the heart, a public count).
// A save is a private collection entry, and — critically — it carries a
// denormalized snapshot (cover, title, byline) so the Saved tab can render
// the card without depending on lookStore.looks. lookStore.looks only holds
// the signed-in creator's OWN looks, which is why a shopper's saved look
// from another creator used to disappear from Saved after an app restart.
//
// Mutations are optimistic: flip the local list immediately, then write to
// the DB; on DB error, revert.

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export interface SavedLook {
  id: string; // look_id — the dedupe key
  creatorId: string | null;
  title: string | null;
  coverPhotoUri: string | null;
  itemCount: number;
  creatorName: string | null;
  creatorPhotoUrl: string | null;
  isBrand: boolean;
  brandName: string | null;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  savedAt: string;
}

// Snapshot the caller (ItemListSheet) passes in — it already has the byline
// resolved, so we persist it verbatim rather than re-deriving server-side.
export interface SaveLookInput {
  lookId: string;
  creatorId?: string | null;
  title?: string | null;
  coverPhotoUri?: string | null;
  itemCount?: number;
  creatorName?: string | null;
  creatorPhotoUrl?: string | null;
  isBrand?: boolean;
  brandName?: string | null;
  brandSlug?: string | null;
  brandLogoUrl?: string | null;
}

interface SavedLookRow {
  look_id: string;
  creator_id: string | null;
  title: string | null;
  cover_photo_url: string | null;
  item_count: number | null;
  creator_name: string | null;
  creator_photo_url: string | null;
  is_brand: boolean | null;
  brand_name: string | null;
  brand_slug: string | null;
  brand_logo_url: string | null;
  created_at: string | null;
}

function rowToSavedLook(r: SavedLookRow): SavedLook {
  return {
    id: r.look_id,
    creatorId: r.creator_id,
    title: r.title,
    coverPhotoUri: r.cover_photo_url,
    itemCount: r.item_count ?? 0,
    creatorName: r.creator_name,
    creatorPhotoUrl: r.creator_photo_url,
    isBrand: r.is_brand ?? false,
    brandName: r.brand_name,
    brandSlug: r.brand_slug,
    brandLogoUrl: r.brand_logo_url,
    savedAt: r.created_at ?? new Date().toISOString(),
  };
}

function inputToSavedLook(input: SaveLookInput): SavedLook {
  return {
    id: input.lookId,
    creatorId: input.creatorId ?? null,
    title: input.title ?? null,
    coverPhotoUri: input.coverPhotoUri ?? null,
    itemCount: input.itemCount ?? 0,
    creatorName: input.creatorName ?? null,
    creatorPhotoUrl: input.creatorPhotoUrl ?? null,
    isBrand: input.isBrand ?? false,
    brandName: input.brandName ?? null,
    brandSlug: input.brandSlug ?? null,
    brandLogoUrl: input.brandLogoUrl ?? null,
    savedAt: new Date().toISOString(),
  };
}

interface SavedLooksState {
  userId: string | null;
  savedLooks: SavedLook[];
  _hydrated: boolean;

  hydrate: (userId?: string) => Promise<void>;
  // Toggle save for a whole look. Optimistic. Returns the resulting state
  // (true = now saved).
  toggleSaveLook: (input: SaveLookInput) => Promise<boolean>;
  isLookSaved: (lookId: string) => boolean;
  removeSavedLook: (lookId: string) => Promise<void>;
  clear: () => void;
}

const useSavedLooksStore = create<SavedLooksState>()((set, get) => ({
  userId: null,
  savedLooks: [],
  _hydrated: false,

  hydrate: async (userId?: string) => {
    let uid = userId ?? null;
    if (!uid) {
      try {
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id ?? null;
      } catch {
        uid = null;
      }
    }
    if (!uid) {
      set({ userId: null, savedLooks: [], _hydrated: true });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('saved_looks')
        .select(
          'look_id, creator_id, title, cover_photo_url, item_count, creator_name, creator_photo_url, is_brand, brand_name, brand_slug, brand_logo_url, created_at',
        )
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[savedLooksStore] hydrate error:', error.message);
        set({ userId: uid, savedLooks: [], _hydrated: true });
        return;
      }
      const looks = ((data ?? []) as SavedLookRow[]).map(rowToSavedLook);
      set({ userId: uid, savedLooks: looks, _hydrated: true });
    } catch (e) {
      console.warn('[savedLooksStore] hydrate threw:', e);
      set({ userId: uid, savedLooks: [], _hydrated: true });
    }
  },

  toggleSaveLook: async (input: SaveLookInput) => {
    const { userId, savedLooks } = get();
    if (!userId) {
      console.warn('[savedLooksStore] toggleSaveLook with no userId — skipping');
      return false;
    }

    const existing = savedLooks.find((s) => s.id === input.lookId);
    const currentlySaved = !!existing;
    const nextSaved = !currentlySaved;
    const snapshot = existing ?? inputToSavedLook(input);

    // Optimistic local update.
    set({
      savedLooks: nextSaved
        ? [snapshot, ...savedLooks]
        : savedLooks.filter((s) => s.id !== input.lookId),
    });

    try {
      if (nextSaved) {
        const { error } = await supabase.from('saved_looks').insert({
          user_id: userId,
          look_id: input.lookId,
          creator_id: snapshot.creatorId,
          title: snapshot.title,
          cover_photo_url: snapshot.coverPhotoUri,
          item_count: snapshot.itemCount,
          creator_name: snapshot.creatorName,
          creator_photo_url: snapshot.creatorPhotoUrl,
          is_brand: snapshot.isBrand,
          brand_name: snapshot.brandName,
          brand_slug: snapshot.brandSlug,
          brand_logo_url: snapshot.brandLogoUrl,
        });
        if (error && (error as { code?: string }).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('saved_looks')
          .delete()
          .eq('user_id', userId)
          .eq('look_id', input.lookId);
        if (error) throw error;
      }
    } catch (e) {
      console.warn('[savedLooksStore] toggleSaveLook DB error, reverting:', e);
      const cur = get().savedLooks.filter((s) => s.id !== input.lookId);
      set({ savedLooks: currentlySaved ? [snapshot, ...cur] : cur });
      return currentlySaved;
    }
    return nextSaved;
  },

  isLookSaved: (lookId: string) => get().savedLooks.some((s) => s.id === lookId),

  removeSavedLook: async (lookId: string) => {
    const { userId, savedLooks } = get();
    const existing = savedLooks.find((s) => s.id === lookId);
    set({ savedLooks: savedLooks.filter((s) => s.id !== lookId) });
    if (!userId) return;
    const { error } = await supabase
      .from('saved_looks')
      .delete()
      .eq('user_id', userId)
      .eq('look_id', lookId);
    if (error && existing) {
      console.warn('[savedLooksStore] removeSavedLook failed, reverting:', error.message);
      set({ savedLooks: [existing, ...get().savedLooks.filter((s) => s.id !== lookId)] });
    }
  },

  clear: () => set({ userId: null, savedLooks: [], _hydrated: false }),
}));

export default useSavedLooksStore;

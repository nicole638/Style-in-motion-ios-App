// Saved items — DB-backed (was local-only Zustand + AsyncStorage prior to
// 2026-06-09). Shoppers bookmark individual shoppable pieces from the
// "Shop This Look" sheet; saves now live in the `saved_items` table so they
// persist cross-device and survive reinstall (purchase intent shouldn't
// evaporate when someone gets a new phone). Mirrors likeStore / followStore.
//
// Identity: user_id = the signed-in user's auth uid. The dedupe key is
// item.id (creator_items.id, the canonical closet item). We keep a
// denormalized snapshot on each row so the Saved tab can render + shop
// without joining back to live tables.
//
// Mutations are optimistic: flip the local list immediately, then write to
// the DB; on DB error, revert.

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { ClothingItem } from '@/lib/state/lookStore';

export interface SavedItem {
  id: string; // creator_items.id — the dedupe key
  lookId: string | null;
  lookItemId: string | null;
  creatorId: string | null;
  name: string;
  brand: string | null;
  price: string | null;
  photoUri: string | null;
  emoji: string | null;
  link: string | null;
  affiliateUrl: string | null;
  lookPhotoUri: string | null;
  savedAt: string;
}

interface SavedItemRow {
  item_id: string;
  look_id: string | null;
  look_item_id: string | null;
  creator_id: string | null;
  name: string | null;
  brand: string | null;
  price: string | null;
  photo_url: string | null;
  emoji: string | null;
  link: string | null;
  affiliate_url: string | null;
  look_photo_url: string | null;
  created_at: string | null;
}

function rowToSavedItem(r: SavedItemRow): SavedItem {
  return {
    id: r.item_id,
    lookId: r.look_id,
    lookItemId: r.look_item_id,
    creatorId: r.creator_id,
    name: r.name ?? '',
    brand: r.brand,
    price: r.price,
    photoUri: r.photo_url,
    emoji: r.emoji,
    link: r.link,
    affiliateUrl: r.affiliate_url,
    lookPhotoUri: r.look_photo_url,
    savedAt: r.created_at ?? new Date().toISOString(),
  };
}

function itemToSnapshot(
  item: ClothingItem,
  lookId: string | null,
  lookPhotoUri: string | null,
  creatorId: string | null,
): SavedItem {
  return {
    id: item.id,
    lookId: lookId ?? null,
    lookItemId: item.lookItemId ?? null,
    creatorId: creatorId ?? null,
    name: item.name,
    brand: item.brand ?? null,
    price: item.price ?? null,
    photoUri: item.photoUri ?? null,
    emoji: item.emoji ?? null,
    link: item.link ?? null,
    affiliateUrl: item.affiliate_url ?? null,
    lookPhotoUri: lookPhotoUri ?? null,
    savedAt: new Date().toISOString(),
  };
}

interface SavedItemsState {
  userId: string | null;
  savedItems: SavedItem[];
  _hydrated: boolean;

  // Load the current user's saved items. authStore calls this on init/login
  // with the known uid; falls back to supabase.auth.getUser() if not given.
  hydrate: (userId?: string) => Promise<void>;

  // Toggle save for an item. Optimistic. Returns the resulting state
  // (true = now saved) so callers can react (e.g. haptics/toast).
  toggleSaveItem: (
    item: ClothingItem,
    lookId?: string | null,
    lookPhotoUri?: string | null,
    creatorId?: string | null,
  ) => Promise<boolean>;

  isItemSaved: (itemId: string) => boolean;
  // Explicit remove (used by the Saved tab's unsave control).
  removeSavedItem: (itemId: string) => Promise<void>;
  clear: () => void;
}

const useSavedItemsStore = create<SavedItemsState>()((set, get) => ({
  userId: null,
  savedItems: [],
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
      set({ userId: null, savedItems: [], _hydrated: true });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('saved_items')
        .select(
          'item_id, look_id, look_item_id, creator_id, name, brand, price, photo_url, emoji, link, affiliate_url, look_photo_url, created_at',
        )
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[savedItemsStore] hydrate error:', error.message);
        set({ userId: uid, savedItems: [], _hydrated: true });
        return;
      }
      const items = ((data ?? []) as SavedItemRow[]).map(rowToSavedItem);
      set({ userId: uid, savedItems: items, _hydrated: true });
    } catch (e) {
      console.warn('[savedItemsStore] hydrate threw:', e);
      set({ userId: uid, savedItems: [], _hydrated: true });
    }
  },

  toggleSaveItem: async (item, lookId, lookPhotoUri, creatorId) => {
    const { userId, savedItems } = get();
    if (!userId) {
      // Not signed in (guest) — can't persist. Caller gates this with a
      // sign-up nudge, so this is just a safety net.
      console.warn('[savedItemsStore] toggleSaveItem with no userId — skipping');
      return false;
    }

    const existing = savedItems.find((s) => s.id === item.id);
    const currentlySaved = !!existing;
    const nextSaved = !currentlySaved;
    const snapshot =
      existing ?? itemToSnapshot(item, lookId ?? null, lookPhotoUri ?? null, creatorId ?? null);

    // Optimistic local update.
    set({
      savedItems: nextSaved
        ? [snapshot, ...savedItems]
        : savedItems.filter((s) => s.id !== item.id),
    });

    try {
      if (nextSaved) {
        const { error } = await supabase.from('saved_items').insert({
          user_id: userId,
          item_id: item.id,
          look_id: snapshot.lookId,
          look_item_id: snapshot.lookItemId,
          creator_id: snapshot.creatorId,
          name: snapshot.name,
          brand: snapshot.brand,
          price: snapshot.price,
          photo_url: snapshot.photoUri,
          emoji: snapshot.emoji,
          link: snapshot.link,
          affiliate_url: snapshot.affiliateUrl,
          look_photo_url: snapshot.lookPhotoUri,
        });
        // 23505 = already saved (raced); treat as success.
        if (error && (error as { code?: string }).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('saved_items')
          .delete()
          .eq('user_id', userId)
          .eq('item_id', item.id);
        if (error) throw error;
      }
    } catch (e) {
      // Revert on failure.
      console.warn('[savedItemsStore] toggleSaveItem DB error, reverting:', e);
      const cur = get().savedItems.filter((s) => s.id !== item.id);
      set({ savedItems: currentlySaved ? [snapshot, ...cur] : cur });
      return currentlySaved;
    }
    return nextSaved;
  },

  isItemSaved: (itemId: string) => get().savedItems.some((s) => s.id === itemId),

  removeSavedItem: async (itemId: string) => {
    const { userId, savedItems } = get();
    const existing = savedItems.find((s) => s.id === itemId);
    // Optimistic remove.
    set({ savedItems: savedItems.filter((s) => s.id !== itemId) });
    if (!userId) return;
    const { error } = await supabase
      .from('saved_items')
      .delete()
      .eq('user_id', userId)
      .eq('item_id', itemId);
    if (error && existing) {
      console.warn('[savedItemsStore] removeSavedItem failed, reverting:', error.message);
      set({ savedItems: [existing, ...get().savedItems.filter((s) => s.id !== itemId)] });
    }
  },

  clear: () => set({ userId: null, savedItems: [], _hydrated: false }),
}));

export default useSavedItemsStore;

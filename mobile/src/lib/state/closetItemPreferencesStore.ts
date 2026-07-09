import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'styled_closet_item_prefs_v1';

interface ItemPrefs {
  /** Whether to automatically append the item's brand voucher code to a look's share caption. */
  autoIncludeOfferInCaption?: boolean;
}

interface ClosetItemPreferencesStore {
  prefs: Record<string, ItemPrefs>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setAutoIncludeOffer: (itemId: string, value: boolean) => void;
  getAutoIncludeOffer: (itemId: string) => boolean;
}

const useClosetItemPreferencesStore = create<ClosetItemPreferencesStore>((set, get) => ({
  prefs: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const safe: Record<string, ItemPrefs> =
        typeof parsed === 'object' && parsed ? parsed : {};
      set({ prefs: safe, hydrated: true });
    } catch (e) {
      console.warn('[closetItemPreferencesStore] hydrate failed:', e);
      set({ hydrated: true });
    }
  },

  setAutoIncludeOffer: (itemId, value) => {
    set((state) => {
      const next = {
        ...state.prefs,
        [itemId]: { ...(state.prefs[itemId] ?? {}), autoIncludeOfferInCaption: value },
      };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return { prefs: next };
    });
  },

  getAutoIncludeOffer: (itemId) => {
    return get().prefs[itemId]?.autoIncludeOfferInCaption ?? false;
  },
}));

export default useClosetItemPreferencesStore;

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ViewSource = 'following' | 'discover' | 'profile' | 'search';

export interface LookViewEvent {
  look_id: string;
  creator_id: string;
  source: ViewSource;
  viewed_at: string;
}

export interface ItemClickEvent {
  look_id: string;
  creator_id: string;
  item_name: string;
  item_index: number;
  clicked_at: string;
}

interface AnalyticsStore {
  lookViews: LookViewEvent[];
  itemClicks: ItemClickEvent[];
  trackView: (look_id: string, creator_id: string, source: ViewSource) => void;
  trackItemClick: (look_id: string, creator_id: string, item_name: string, item_index: number) => void;
  getViewsForCreator: (creator_id: string) => LookViewEvent[];
  getClicksForCreator: (creator_id: string) => ItemClickEvent[];
}

const useAnalyticsStore = create<AnalyticsStore>()(
  persist(
    (set, get) => ({
      lookViews: [],
      itemClicks: [],

      trackView: (look_id: string, creator_id: string, source: ViewSource) => {
        const event: LookViewEvent = {
          look_id,
          creator_id,
          source,
          viewed_at: new Date().toISOString(),
        };
        set((state) => ({ lookViews: [...state.lookViews, event] }));
      },

      trackItemClick: (look_id: string, creator_id: string, item_name: string, item_index: number) => {
        const event: ItemClickEvent = {
          look_id,
          creator_id,
          item_name,
          item_index,
          clicked_at: new Date().toISOString(),
        };
        set((state) => ({ itemClicks: [...state.itemClicks, event] }));
      },

      getViewsForCreator: (creator_id: string) => {
        return get().lookViews.filter((e) => e.creator_id === creator_id);
      },

      getClicksForCreator: (creator_id: string) => {
        return get().itemClicks.filter((e) => e.creator_id === creator_id);
      },
    }),
    {
      name: 'analytics-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        lookViews: state.lookViews,
        itemClicks: state.itemClicks,
      }),
    }
  )
);

export default useAnalyticsStore;

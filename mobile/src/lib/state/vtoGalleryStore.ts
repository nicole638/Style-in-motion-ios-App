import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedVtoRender {
  render_id: string;
  output_url: string;
  look_id: string | null;
  created_at: string;
  saved_at: string;
}

interface VtoGalleryState {
  savedByUser: Record<string, SavedVtoRender[]>;
  saveRender: (userId: string, render: Omit<SavedVtoRender, 'saved_at'>) => void;
  removeRender: (userId: string, renderId: string) => void;
  getSaved: (userId: string) => SavedVtoRender[];
}

const useVtoGalleryStore = create<VtoGalleryState>()(
  persist(
    (set, get) => ({
      savedByUser: {},

      saveRender: (userId, render) => {
        if (!userId) return;
        set((state) => {
          const existing = state.savedByUser[userId] ?? [];
          if (existing.some((r) => r.render_id === render.render_id)) return state;
          const next: SavedVtoRender = { ...render, saved_at: new Date().toISOString() };
          return {
            savedByUser: {
              ...state.savedByUser,
              [userId]: [next, ...existing],
            },
          };
        });
      },

      removeRender: (userId, renderId) => {
        if (!userId) return;
        set((state) => {
          const existing = state.savedByUser[userId] ?? [];
          return {
            savedByUser: {
              ...state.savedByUser,
              [userId]: existing.filter((r) => r.render_id !== renderId),
            },
          };
        });
      },

      getSaved: (userId) => {
        if (!userId) return [];
        return get().savedByUser[userId] ?? [];
      },
    }),
    {
      name: 'vto-gallery-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ savedByUser: state.savedByUser }),
    },
  ),
);

export default useVtoGalleryStore;

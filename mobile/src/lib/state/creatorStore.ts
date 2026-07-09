import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export interface PlatformHandle {
  id: string;
  platform: string;
  handle: string;
  connected: boolean;
  followers: string;
  color: string;
  icon: string;
  urlPrefix: string;
}

interface CreatorStore {
  handlesPerCreator: Record<string, PlatformHandle[]>;
  activeCreatorId: string | null;
  handles: PlatformHandle[];
  primaryPlatform: 'instagram' | 'tiktok';
  switchCreator: (creatorId: string) => void;
  fetchFromSupabase: (creatorId: string) => Promise<void>;
  updateHandle: (id: string, handle: string) => void;
  toggleConnected: (id: string) => void;
  setFollowers: (id: string, followers: string) => void;
  setPrimaryPlatform: (platform: 'instagram' | 'tiktok') => void;
  saveSocialsToSupabase: (creatorId: string, handles: PlatformHandle[]) => Promise<void>;
}

// Map platform IDs to Supabase column names
const SUPABASE_HANDLE_COLS: Record<string, string> = {
  instagram: 'instagram_handle',
  tiktok: 'tiktok_handle',
  youtube: 'youtube_handle',
  pinterest: 'pinterest_handle',
};

const SUPABASE_ENABLED_COLS: Record<string, string> = {
  instagram: 'instagram_enabled',
  tiktok: 'tiktok_enabled',
  youtube: 'youtube_enabled',
  pinterest: 'pinterest_enabled',
};

export const defaultHandles = (): PlatformHandle[] => [
  { id: 'instagram', platform: 'Instagram', handle: '', connected: false, followers: '0', color: '#E1306C', icon: 'logo-instagram', urlPrefix: 'https://instagram.com/' },
  { id: 'tiktok', platform: 'TikTok', handle: '', connected: false, followers: '0', color: '#010101', icon: 'logo-tiktok', urlPrefix: 'https://tiktok.com/@' },
  { id: 'youtube', platform: 'YouTube', handle: '', connected: false, followers: '0', color: '#FF0000', icon: 'logo-youtube', urlPrefix: 'https://youtube.com/@' },
  { id: 'pinterest', platform: 'Pinterest', handle: '', connected: false, followers: '0', color: '#E60023', icon: 'logo-pinterest', urlPrefix: 'https://pinterest.com/' },
];

const useCreatorStore = create<CreatorStore>()(
  persist(
    (set, get) => ({
      handlesPerCreator: {},
      activeCreatorId: null,
      handles: defaultHandles(),
      primaryPlatform: 'instagram' as const,

      setPrimaryPlatform: (platform: 'instagram' | 'tiktok') => {
        set({ primaryPlatform: platform });
      },

      switchCreator: (creatorId: string) => {
        const { handlesPerCreator } = get();
        const handles = handlesPerCreator[creatorId] ?? defaultHandles();
        if (!handlesPerCreator[creatorId]) {
          set({
            activeCreatorId: creatorId,
            handles,
            handlesPerCreator: { ...handlesPerCreator, [creatorId]: handles },
          });
        } else {
          set({ activeCreatorId: creatorId, handles });
        }
        // Fetch fresh from Supabase
        get().fetchFromSupabase(creatorId);
      },

      fetchFromSupabase: async (creatorId: string) => {
        try {
          const { data, error } = await supabase
            .from('creator_profiles')
            .select('instagram_handle, tiktok_handle, youtube_handle, pinterest_handle, instagram_enabled, tiktok_enabled, youtube_enabled, pinterest_enabled')
            .eq('creator_id', creatorId)
            .single();
          if (error || !data) return;

          const base = defaultHandles();
          const updated = base.map((h) => {
            const handleCol = SUPABASE_HANDLE_COLS[h.id];
            const enabledCol = SUPABASE_ENABLED_COLS[h.id];
            return {
              ...h,
              handle: (data as any)[handleCol] ?? '',
              connected: (data as any)[enabledCol] ?? false,
            };
          });

          const { handlesPerCreator, activeCreatorId } = get();
          set({
            handlesPerCreator: { ...handlesPerCreator, [creatorId]: updated },
            ...(activeCreatorId === creatorId ? { handles: updated } : {}),
          });
        } catch (e) {
          console.warn('fetchFromSupabase error:', e);
        }
      },

      updateHandle: (id: string, handle: string) => {
        const { activeCreatorId, handlesPerCreator } = get();
        if (!activeCreatorId) return;
        const updated = (handlesPerCreator[activeCreatorId] ?? defaultHandles()).map(
          (h) => h.id === id ? { ...h, handle } : h
        );
        set({
          handles: updated,
          handlesPerCreator: { ...handlesPerCreator, [activeCreatorId]: updated },
        });
        // Sync to Supabase
        get().saveSocialsToSupabase(activeCreatorId, updated);
      },

      toggleConnected: (id: string) => {
        const { activeCreatorId, handlesPerCreator } = get();
        if (!activeCreatorId) return;
        const updated = (handlesPerCreator[activeCreatorId] ?? defaultHandles()).map(
          (h) => h.id === id ? { ...h, connected: !h.connected } : h
        );
        set({
          handles: updated,
          handlesPerCreator: { ...handlesPerCreator, [activeCreatorId]: updated },
        });
        // Sync to Supabase
        get().saveSocialsToSupabase(activeCreatorId, updated);
      },

      setFollowers: (id: string, followers: string) => {
        const { activeCreatorId, handlesPerCreator } = get();
        if (!activeCreatorId) return;
        const updated = (handlesPerCreator[activeCreatorId] ?? defaultHandles()).map(
          (h) => h.id === id ? { ...h, followers } : h
        );
        set({
          handles: updated,
          handlesPerCreator: { ...handlesPerCreator, [activeCreatorId]: updated },
        });
      },

      saveSocialsToSupabase: async (creatorId: string, handles: PlatformHandle[]) => {
        try {
          const updateObj: Record<string, any> = {};
          for (const h of handles) {
            const handleCol = SUPABASE_HANDLE_COLS[h.id];
            const enabledCol = SUPABASE_ENABLED_COLS[h.id];
            if (handleCol) updateObj[handleCol] = h.handle;
            if (enabledCol) updateObj[enabledCol] = h.connected;
          }
          const { error } = await supabase
            .from('creator_profiles')
            .update(updateObj)
            .eq('creator_id', creatorId);
          if (error) console.warn('saveSocialsToSupabase error:', error);
        } catch (e) {
          console.warn('saveSocialsToSupabase error:', e);
        }
      },
    }),
    {
      name: 'creator-storage-v3',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export default useCreatorStore;

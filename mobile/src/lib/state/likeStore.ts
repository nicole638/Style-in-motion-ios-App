import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import * as Burnt from 'burnt';

interface LikeStore {
  likedLookIds: string[];
  likeCounts: Record<string, number>;
  toggleLike: (lookId: string) => Promise<void>;
  isLiked: (lookId: string) => boolean;
  getLikeCount: (lookId: string) => number;
  syncLikedIds: (userId: string) => Promise<void>;
  initCounts: (counts: Record<string, number>) => void;
}

const useLikeStore = create<LikeStore>()(
  persist(
    (set, get) => ({
      likedLookIds: [],
      likeCounts: {},

      toggleLike: async (lookId: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          Burnt.toast({
            title: 'Sign in to like',
            message: 'Save looks you love to your profile.',
            preset: 'none',
            duration: 2.5,
          });
          return;
        }

        const { likedLookIds, likeCounts } = get();
        const alreadyLiked = likedLookIds.includes(lookId);
        const currentCount = likeCounts[lookId] ?? 0;

        if (alreadyLiked) {
          // Optimistic remove
          set({
            likedLookIds: likedLookIds.filter((id) => id !== lookId),
            likeCounts: { ...likeCounts, [lookId]: Math.max(0, currentCount - 1) },
          });
          const { error } = await supabase
            .from('likes')
            .delete()
            .eq('user_id', user.id)
            .eq('look_id', lookId);
          if (error) {
            // Revert
            const s = get();
            set({
              likedLookIds: [...s.likedLookIds, lookId],
              likeCounts: { ...s.likeCounts, [lookId]: currentCount },
            });
            console.warn('[likeStore] unlike failed:', error.message);
          }
        } else {
          // Optimistic add
          set({
            likedLookIds: [...likedLookIds, lookId],
            likeCounts: { ...likeCounts, [lookId]: currentCount + 1 },
          });
          const { error } = await supabase
            .from('likes')
            .insert({ user_id: user.id, look_id: lookId });
          if (error) {
            // Only revert on non-duplicate errors (duplicate = already liked in DB, state is correct)
            const isDuplicate = error.message.includes('duplicate') || error.message.includes('unique') || error.code === '23505';
            if (!isDuplicate) {
              const s = get();
              set({
                likedLookIds: s.likedLookIds.filter((id) => id !== lookId),
                likeCounts: { ...s.likeCounts, [lookId]: currentCount },
              });
              console.warn('[likeStore] like failed:', error.message);
            }
          }
        }
      },

      isLiked: (lookId: string) => {
        return get().likedLookIds.includes(lookId);
      },

      getLikeCount: (lookId: string) => {
        return get().likeCounts[lookId] ?? 0;
      },

      syncLikedIds: async (userId: string) => {
        const { data, error } = await supabase
          .from('likes')
          .select('look_id')
          .eq('user_id', userId);
        if (error) {
          console.warn('[likeStore] syncLikedIds error:', error.message);
          return;
        }
        const ids = (data ?? []).map((r: { look_id: string }) => r.look_id);
        set({ likedLookIds: ids });
      },

      initCounts: (counts: Record<string, number>) => {
        const current = get().likeCounts;
        // DB counts are authoritative base; preserve any local optimistic delta (+/-1)
        const merged: Record<string, number> = { ...counts };
        Object.keys(current).forEach((id) => {
          const dbCount = counts[id];
          if (dbCount === undefined) {
            merged[id] = current[id];
          } else if (Math.abs(current[id] - dbCount) <= 1) {
            // Small delta — likely an optimistic update in-flight, keep it
            merged[id] = current[id];
          }
          // Otherwise DB wins (stale local cache)
        });
        set({ likeCounts: merged });
      },
    }),
    {
      name: 'like-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        likedLookIds: state.likedLookIds,
        likeCounts: state.likeCounts,
      }),
    }
  )
);

export default useLikeStore;

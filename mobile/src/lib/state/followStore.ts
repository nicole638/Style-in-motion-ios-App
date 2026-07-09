// In-app follows — DB-backed (was local-only Zustand + AsyncStorage prior to
// 2026-06-09). Follows now live in the `follows` table so they persist
// cross-device, drive the "Following" feed, and feed a correct
// creator_profiles.app_follower_count.
//
// Identity: follower_id = the signed-in user's auth uid (resolved via
// supabase.auth.getUser on hydrate, or passed in by authStore which already
// has the session). Works for both audience shoppers and creators
// browsing-as-shopper.
//
// The store keeps an in-memory list of followed creator_ids for the current
// user so isFollowing() stays synchronous (UI reads it on every render).
// Mutations are optimistic: flip the local list immediately, then write to
// the DB; on DB error, revert.

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';

interface FollowState {
  followerId: string | null;       // current user's auth uid
  followedIds: string[];           // creator_ids the current user follows
  _hydrated: boolean;

  // Load the current user's follows. authStore calls this on init/login with
  // the known uid; falls back to supabase.auth.getUser() if not provided.
  hydrate: (followerId?: string) => Promise<void>;

  // Toggle follow for a creator. Optimistic. Returns the resulting state
  // (true = now following) so callers can decide whether to show the
  // cross-social follow prompt (only on a fresh follow).
  toggleFollow: (creatorId: string) => Promise<boolean>;

  isFollowing: (creatorId: string) => boolean;
  getFollowedCreators: () => string[];
  clear: () => void;
}

const useFollowStore = create<FollowState>()((set, get) => ({
  followerId: null,
  followedIds: [],
  _hydrated: false,

  hydrate: async (followerId?: string) => {
    let uid = followerId ?? null;
    if (!uid) {
      try {
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id ?? null;
      } catch {
        uid = null;
      }
    }
    if (!uid) {
      set({ followerId: null, followedIds: [], _hydrated: true });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('follows')
        .select('creator_id')
        .eq('follower_id', uid);
      if (error) {
        console.warn('[followStore] hydrate error:', error.message);
        set({ followerId: uid, followedIds: [], _hydrated: true });
        return;
      }
      const ids = (data ?? [])
        .map((r) => (r as { creator_id?: string }).creator_id)
        .filter((id): id is string => !!id);
      set({ followerId: uid, followedIds: ids, _hydrated: true });
    } catch (e) {
      console.warn('[followStore] hydrate threw:', e);
      set({ followerId: uid, followedIds: [], _hydrated: true });
    }
  },

  toggleFollow: async (creatorId: string) => {
    const { followerId, followedIds } = get();
    if (!followerId) {
      // Not signed in (e.g. guest) — can't persist a follow. No-op.
      console.warn('[followStore] toggleFollow with no followerId — skipping');
      return false;
    }
    // Never let a user "follow" themselves.
    if (creatorId === followerId) return false;

    const currentlyFollowing = followedIds.includes(creatorId);
    const nextFollowing = !currentlyFollowing;

    // Optimistic local update.
    set({
      followedIds: nextFollowing
        ? [...followedIds, creatorId]
        : followedIds.filter((id) => id !== creatorId),
    });

    try {
      if (nextFollowing) {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: followerId, creator_id: creatorId });
        // 23505 = already following (raced); treat as success.
        if (error && (error as { code?: string }).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', followerId)
          .eq('creator_id', creatorId);
        if (error) throw error;
      }
    } catch (e) {
      // Revert on failure.
      console.warn('[followStore] toggleFollow DB error, reverting:', e);
      set({
        followedIds: currentlyFollowing
          ? Array.from(new Set([...get().followedIds, creatorId]))
          : get().followedIds.filter((id) => id !== creatorId),
      });
      return currentlyFollowing;
    }

    // The write committed — refresh the Following feed so it reflects the new
    // follow set. Done here (after the await) rather than reacting to the
    // optimistic followedIds change so the refetch can't race the DB insert
    // and read a stale, empty follow set. If the user is currently on the
    // Following tab the query is active and refetches immediately; if not,
    // it's marked stale and refetches the next time that tab is shown.
    queryClient.invalidateQueries({ queryKey: ['following-feed'] });

    return nextFollowing;
  },

  isFollowing: (creatorId: string) => get().followedIds.includes(creatorId),

  getFollowedCreators: () => get().followedIds,

  clear: () => set({ followerId: null, followedIds: [], _hydrated: false }),
}));

export default useFollowStore;

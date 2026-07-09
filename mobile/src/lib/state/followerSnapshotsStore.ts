import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export type SnapshotPlatform = 'instagram' | 'tiktok' | 'youtube' | 'pinterest';

export interface FollowerSnapshot {
  id: string;
  creator_id: string;
  platform: SnapshotPlatform;
  follower_count: number;
  snapshot_date: string;
}

interface FollowerSnapshotsState {
  snapshots: FollowerSnapshot[];
  loading: boolean;
  error: string | null;

  fetchSnapshots: (creatorId: string) => Promise<void>;
  takeSnapshotIfNeeded: (creatorId: string) => Promise<void>;
}

function todayISODate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const useFollowerSnapshotsStore = create<FollowerSnapshotsState>((set, get) => ({
  snapshots: [],
  loading: false,
  error: null,

  fetchSnapshots: async (creatorId: string) => {
    if (!creatorId) return;
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('follower_snapshots')
        .select('*')
        .eq('creator_id', creatorId)
        .order('snapshot_date', { ascending: true });
      if (error) throw error;
      set({ snapshots: (data ?? []) as FollowerSnapshot[], loading: false });
    } catch (e: any) {
      console.warn('fetchSnapshots error:', e);
      set({ loading: false, error: e?.message ?? 'Failed to fetch snapshots' });
    }
  },

  takeSnapshotIfNeeded: async (creatorId: string) => {
    if (!creatorId) return;
    try {
      const today = todayISODate();

      // 1. Which platforms already have a snapshot today?
      const { data: existingRows, error: existingError } = await supabase
        .from('follower_snapshots')
        .select('platform')
        .eq('creator_id', creatorId)
        .eq('snapshot_date', today);
      if (existingError) throw existingError;
      const existingPlatforms = new Set<string>((existingRows ?? []).map((r: any) => r.platform));

      // 2. Load creator profile to see which platforms are enabled
      const { data: profile, error: profileError } = await supabase
        .from('creator_profiles')
        .select('instagram_handle, instagram_enabled, tiktok_handle, tiktok_enabled')
        .eq('creator_id', creatorId)
        .single();
      if (profileError) throw profileError;
      if (!profile) return;

      const targets: { platform: SnapshotPlatform; handle: string }[] = [];
      if (profile.instagram_enabled && profile.instagram_handle && !existingPlatforms.has('instagram')) {
        targets.push({ platform: 'instagram', handle: profile.instagram_handle });
      }
      if (profile.tiktok_enabled && profile.tiktok_handle && !existingPlatforms.has('tiktok')) {
        targets.push({ platform: 'tiktok', handle: profile.tiktok_handle });
      }
      if (targets.length === 0) return;

      // 3. Fetch counts from the backend scraper, mirroring profile.tsx
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      let insertedAny = false;
      for (const target of targets) {
        try {
          const res = await fetch(
            `${baseUrl}/api/social-followers?handle=${encodeURIComponent(target.handle)}&platform=${target.platform}`
          );
          const json = await res.json();
          const count = json?.data?.count;
          if (typeof count === 'number' && count > 0) {
            const { error: insertError } = await supabase
              .from('follower_snapshots')
              .insert({
                creator_id: creatorId,
                platform: target.platform,
                follower_count: count,
                snapshot_date: today,
              });
            if (insertError) {
              console.warn(`snapshot insert (${target.platform}) failed:`, insertError);
            } else {
              insertedAny = true;
            }
          }
        } catch (e) {
          console.warn(`snapshot fetch (${target.platform}) failed:`, e);
        }
      }

      if (insertedAny) {
        await get().fetchSnapshots(creatorId);
      }
    } catch (e: any) {
      console.warn('takeSnapshotIfNeeded error:', e);
      set({ error: e?.message ?? 'Failed to take snapshot' });
    }
  },
}));

export default useFollowerSnapshotsStore;

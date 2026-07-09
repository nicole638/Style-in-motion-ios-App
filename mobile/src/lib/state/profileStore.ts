import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { withTransientRetry } from '@/lib/supabaseRetry';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as base64Decode } from 'base64-arraybuffer';

export interface SocialHandle {
  platform: string;
  handle: string;
  enabled: boolean;
  icon: string;
  urlPrefix: string;
}

export interface BrandSizeExample {
  brand: string;
  category: string;
  size: string;
}

export type MeasurementUnit = 'us' | 'metric';

export interface MeasurementUpdate {
  firstName?: string | null;
  lastName?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  measurementUnit?: MeasurementUnit;
  topSize?: string | null;
  bottomSize?: string | null;
  dressSize?: string | null;
  shoeSize?: string | null;
  braSize?: string | null;
  brandSizeExamples?: BrandSizeExample[];
  bodyTypeSelfTags?: string[];
  markCompleted?: boolean;
}

interface CreatorProfile {
  username: string;
  bio: string;
  location: string | null;
  photoUri: string;
  captionStyle: 'Casual' | 'Professional' | 'Minimal';
  includeHashtags: boolean;
  includePrices: boolean;
  socialFollowerCount: number;
  // In-app follower count (creator_profiles.app_follower_count, trigger-
  // maintained from the `follows` table). Distinct from socialFollowerCount
  // (their IG/TikTok follower count used for tiering).
  appFollowerCount: number;
  socials: SocialHandle[];
  isFoundingCreator: boolean;
  firstName: string | null;
  lastName: string | null;
  heightCm: number | null;
  weightKg: number | null;
  measurementUnit: MeasurementUnit;
  topSize: string | null;
  bottomSize: string | null;
  dressSize: string | null;
  shoeSize: string | null;
  braSize: string | null;
  brandSizeExamples: BrandSizeExample[];
  bodyTypeSelfTags: string[];
  profileCompletedAt: string | null;
}

export interface ProfileState {
  profiles: Record<string, CreatorProfile>;
  activeCreatorId: string | null;
  // Derived from active profile — kept flat for backwards compat
  username: string;
  bio: string;
  location: string | null;
  photoUri: string;
  captionStyle: 'Casual' | 'Professional' | 'Minimal';
  includeHashtags: boolean;
  includePrices: boolean;
  socialFollowerCount: number;
  isFoundingCreator: boolean;
  firstName: string | null;
  lastName: string | null;
  heightCm: number | null;
  weightKg: number | null;
  measurementUnit: MeasurementUnit;
  topSize: string | null;
  bottomSize: string | null;
  dressSize: string | null;
  shoeSize: string | null;
  braSize: string | null;
  brandSizeExamples: BrandSizeExample[];
  bodyTypeSelfTags: string[];
  profileCompletedAt: string | null;
  switchCreator: (creatorId: string) => void;
  fetchProfile: (creatorId: string) => Promise<void>;
  fetchProfilesForCreators: (creatorIds: string[]) => Promise<void>;
  setUsername: (username: string) => Promise<void>;
  setBio: (bio: string) => void;
  setLocation: (location: string | null) => void;
  setPhotoUri: (uri: string) => Promise<void>;
  setCaptionStyle: (style: 'Casual' | 'Professional' | 'Minimal') => void;
  setIncludeHashtags: (v: boolean) => void;
  setIncludePrices: (v: boolean) => void;
  setSocialFollowerCount: (count: number) => void;
  setMeasurements: (update: MeasurementUpdate) => Promise<void>;
}

const BLANK_PROFILE: CreatorProfile = {
  username: '',
  bio: '',
  location: null,
  photoUri: '',
  captionStyle: 'Casual',
  includeHashtags: true,
  includePrices: true,
  socialFollowerCount: 0,
  appFollowerCount: 0,
  socials: [],
  isFoundingCreator: false,
  firstName: null,
  lastName: null,
  heightCm: null,
  weightKg: null,
  measurementUnit: 'us',
  topSize: null,
  bottomSize: null,
  dressSize: null,
  shoeSize: null,
  braSize: null,
  brandSizeExamples: [],
  bodyTypeSelfTags: [],
  profileCompletedAt: null,
};

// Map a row from `creator_profiles` (snake_case DB columns) into a CreatorProfile.
function rowToProfile(data: any): CreatorProfile {
  const socials: SocialHandle[] = [
    { platform: 'Instagram', handle: data.instagram_handle ?? '', enabled: data.instagram_enabled ?? false, icon: 'logo-instagram', urlPrefix: 'https://instagram.com/' },
    { platform: 'TikTok', handle: data.tiktok_handle ?? '', enabled: data.tiktok_enabled ?? false, icon: 'logo-tiktok', urlPrefix: 'https://tiktok.com/@' },
    { platform: 'YouTube', handle: data.youtube_handle ?? '', enabled: data.youtube_enabled ?? false, icon: 'logo-youtube', urlPrefix: 'https://youtube.com/@' },
    { platform: 'Pinterest', handle: data.pinterest_handle ?? '', enabled: data.pinterest_enabled ?? false, icon: 'logo-pinterest', urlPrefix: 'https://pinterest.com/' },
  ];
  const rawExamples = data.brand_size_examples;
  let brandSizeExamples: BrandSizeExample[] = [];
  if (Array.isArray(rawExamples)) {
    brandSizeExamples = rawExamples
      .filter((e: any) => e && typeof e === 'object')
      .map((e: any) => ({
        brand: typeof e.brand === 'string' ? e.brand : '',
        category: typeof e.category === 'string' ? e.category : '',
        size: typeof e.size === 'string' ? e.size : '',
      }));
  }
  const rawTags = data.body_type_self_tags;
  const bodyTypeSelfTags: string[] = Array.isArray(rawTags)
    ? rawTags.filter((t: any) => typeof t === 'string')
    : [];
  const measurementUnit: MeasurementUnit = data.measurement_unit === 'metric' ? 'metric' : 'us';
  return {
    username: data.username ?? '',
    bio: data.bio ?? '',
    location: data.location ?? null,
    photoUri: data.photo_url ?? '',
    captionStyle: (data.caption_style as CreatorProfile['captionStyle']) ?? 'Casual',
    includeHashtags: data.include_hashtags ?? true,
    includePrices: data.include_prices ?? true,
    socialFollowerCount: data.follower_count ?? 0,
    appFollowerCount: data.app_follower_count ?? 0,
    socials,
    isFoundingCreator: data.is_founding_creator ?? false,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    heightCm: data.height_cm ?? null,
    weightKg: data.weight_kg ?? null,
    measurementUnit,
    topSize: data.top_size ?? null,
    bottomSize: data.bottom_size ?? null,
    dressSize: data.dress_size ?? null,
    shoeSize: data.shoe_size ?? null,
    braSize: data.bra_size ?? null,
    brandSizeExamples,
    bodyTypeSelfTags,
    profileCompletedAt: data.profile_completed_at ?? null,
  };
}

const useProfileStore = create<ProfileState>()((set, get) => ({
  profiles: {},
  activeCreatorId: null,
  username: '',
  bio: '',
  location: null,
  photoUri: '',
  captionStyle: 'Casual',
  includeHashtags: true,
  includePrices: true,
  socialFollowerCount: 0,
  isFoundingCreator: false,
  firstName: null,
  lastName: null,
  heightCm: null,
  weightKg: null,
  measurementUnit: 'us',
  topSize: null,
  bottomSize: null,
  dressSize: null,
  shoeSize: null,
  braSize: null,
  brandSizeExamples: [],
  bodyTypeSelfTags: [],
  profileCompletedAt: null,

  switchCreator: (creatorId: string) => {
    const { profiles } = get();
    const stored = profiles[creatorId];
    const profile: CreatorProfile = stored ? { ...BLANK_PROFILE, ...stored } : { ...BLANK_PROFILE };
    set({
      activeCreatorId: creatorId,
      username: profile.username,
      bio: profile.bio,
      location: profile.location,
      photoUri: profile.photoUri,
      captionStyle: profile.captionStyle,
      includeHashtags: profile.includeHashtags,
      includePrices: profile.includePrices,
      socialFollowerCount: profile.socialFollowerCount,
      isFoundingCreator: profile.isFoundingCreator,
      firstName: profile.firstName,
      lastName: profile.lastName,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      measurementUnit: profile.measurementUnit,
      topSize: profile.topSize,
      bottomSize: profile.bottomSize,
      dressSize: profile.dressSize,
      shoeSize: profile.shoeSize,
      braSize: profile.braSize,
      brandSizeExamples: profile.brandSizeExamples,
      bodyTypeSelfTags: profile.bodyTypeSelfTags,
      profileCompletedAt: profile.profileCompletedAt,
    });
    // Fetch fresh from Supabase in background
    get().fetchProfile(creatorId);
  },

  fetchProfile: async (creatorId: string) => {
    try {
      const { data, error } = await supabase
        .from('creator_profiles')
        .select('*')
        .eq('creator_id', creatorId)
        .single();
      if (error || !data) return;
      const profile = rowToProfile(data);
      const { profiles, activeCreatorId } = get();
      set({
        profiles: { ...profiles, [creatorId]: profile },
        ...(activeCreatorId === creatorId ? {
          username: profile.username,
          bio: profile.bio,
          location: profile.location,
          photoUri: profile.photoUri,
          captionStyle: profile.captionStyle,
          includeHashtags: profile.includeHashtags,
          includePrices: profile.includePrices,
          socialFollowerCount: profile.socialFollowerCount,
          isFoundingCreator: profile.isFoundingCreator,
          firstName: profile.firstName,
          lastName: profile.lastName,
          heightCm: profile.heightCm,
          weightKg: profile.weightKg,
          measurementUnit: profile.measurementUnit,
          topSize: profile.topSize,
          bottomSize: profile.bottomSize,
          dressSize: profile.dressSize,
          shoeSize: profile.shoeSize,
          braSize: profile.braSize,
          brandSizeExamples: profile.brandSizeExamples,
          bodyTypeSelfTags: profile.bodyTypeSelfTags,
          profileCompletedAt: profile.profileCompletedAt,
        } : {}),
      });
    } catch (e) {
      console.warn('fetchProfile error:', e);
    }
  },

  fetchProfilesForCreators: async (creatorIds: string[]) => {
    const { profiles } = get();
    const missing = creatorIds.filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('creator_profiles')
        .select('*')
        .in('creator_id', missing);
      if (error || !data) return;
      const newProfiles: Record<string, CreatorProfile> = {};
      for (const row of data) {
        newProfiles[row.creator_id] = rowToProfile(row);
      }
      set({ profiles: { ...get().profiles, ...newProfiles } });
    } catch (e) {
      console.warn('fetchProfilesForCreators error:', e);
    }
  },

  setUsername: async (username: string) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    const prevUsername = profiles[activeCreatorId]?.username ?? '';
    set({
      username,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), username },
      },
    });
    const { error } = await withTransientRetry(() =>
      supabase.from('creator_profiles').update({ username }).eq('creator_id', activeCreatorId),
    );
    if (error) {
      if (error.code === '23505') {
        const current = get().profiles;
        set({
          username: prevUsername,
          profiles: {
            ...current,
            [activeCreatorId]: { ...(current[activeCreatorId] ?? BLANK_PROFILE), username: prevUsername },
          },
        });
        throw new Error('USERNAME_TAKEN');
      }
      console.warn('setUsername DB error:', error);
    }
  },

  setBio: (bio: string) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    set({
      bio,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), bio },
      },
    });
    withTransientRetry(() => supabase.from('creator_profiles').update({ bio }).eq('creator_id', activeCreatorId))
      .then(({ error }) => { if (error) console.warn('setBio DB error:', error); });
  },

  setLocation: (location: string | null) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    set({
      location,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), location },
      },
    });
    withTransientRetry(() => supabase.from('creator_profiles').update({ location }).eq('creator_id', activeCreatorId))
      .then(({ error }) => { if (error) console.warn('setLocation DB error:', error); });
  },

  setPhotoUri: async (photoUri: string) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) {
      throw new Error('No active creator profile — cannot save avatar');
    }
    // Optimistically update local state with local URI for instant UI feedback
    set({
      photoUri,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), photoUri },
      },
    });
    // Upload to Supabase Storage, then save the public URL to the DB
    const path = `${activeCreatorId}/profile.jpg`;
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64 || base64.length === 0) {
      throw new Error('Image file is empty or unreadable');
    }
    const arrayBuffer = base64Decode(base64);
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) {
      console.error('[setPhotoUri] storage upload failed:', uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }
    const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
    // Update state with the public URL
    const { profiles: currentProfiles, activeCreatorId: currentId } = get();
    if (currentId === activeCreatorId) {
      set({
        photoUri: publicUrl,
        profiles: {
          ...currentProfiles,
          [activeCreatorId]: { ...(currentProfiles[activeCreatorId] ?? BLANK_PROFILE), photoUri: publicUrl },
        },
      });
    }
    const { error: dbError } = await withTransientRetry(() =>
      supabase
        .from('creator_profiles')
        .upsert({ creator_id: activeCreatorId, photo_url: publicUrl }, { onConflict: 'creator_id' }),
    );
    if (dbError) {
      console.error('[setPhotoUri] db update failed:', dbError);
      throw new Error(`Failed to save avatar to profile: ${dbError.message}`);
    }
    // Verify round-trip: refetch profile to confirm persistence
    await get().fetchProfile(activeCreatorId);
    const refetched = get().profiles[activeCreatorId];
    if (!refetched?.photoUri || !refetched.photoUri.startsWith('http')) {
      throw new Error('Avatar save did not persist — photo_url missing after refetch');
    }
  },

  setCaptionStyle: (captionStyle: 'Casual' | 'Professional' | 'Minimal') => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    set({
      captionStyle,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), captionStyle },
      },
    });
    withTransientRetry(() => supabase.from('creator_profiles').update({ caption_style: captionStyle }).eq('creator_id', activeCreatorId))
      .then(({ error }) => { if (error) console.warn('setCaptionStyle DB error:', error); });
  },

  setIncludeHashtags: (includeHashtags: boolean) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    set({
      includeHashtags,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), includeHashtags },
      },
    });
    withTransientRetry(() => supabase.from('creator_profiles').update({ include_hashtags: includeHashtags }).eq('creator_id', activeCreatorId))
      .then(({ error }) => { if (error) console.warn('setIncludeHashtags DB error:', error); });
  },

  setIncludePrices: (includePrices: boolean) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    set({
      includePrices,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), includePrices },
      },
    });
    withTransientRetry(() => supabase.from('creator_profiles').update({ include_prices: includePrices }).eq('creator_id', activeCreatorId))
      .then(({ error }) => { if (error) console.warn('setIncludePrices DB error:', error); });
  },

  setSocialFollowerCount: (socialFollowerCount: number) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    set({
      socialFollowerCount,
      profiles: {
        ...profiles,
        [activeCreatorId]: { ...(profiles[activeCreatorId] ?? BLANK_PROFILE), socialFollowerCount },
      },
    });
    withTransientRetry(() => supabase.from('creator_profiles').update({ follower_count: socialFollowerCount }).eq('creator_id', activeCreatorId))
      .then(({ error }) => { if (error) console.warn('setSocialFollowerCount DB error:', error); });
  },

  // Atomic update for the profile-completion screen. Only the fields present
  // in `update` are written. When `markCompleted` is true, we also stamp
  // `profile_completed_at = now()` in the same UPDATE.
  setMeasurements: async (update: MeasurementUpdate) => {
    const { activeCreatorId, profiles } = get();
    if (!activeCreatorId) return;
    const current = profiles[activeCreatorId] ?? BLANK_PROFILE;

    // Build the local (camelCase) patch and the DB (snake_case) patch in parallel.
    const localPatch: Partial<CreatorProfile> = {};
    const dbPatch: Record<string, any> = {};

    if (update.firstName !== undefined) {
      localPatch.firstName = update.firstName;
      dbPatch.first_name = update.firstName;
    }
    if (update.lastName !== undefined) {
      localPatch.lastName = update.lastName;
      dbPatch.last_name = update.lastName;
    }
    if (update.heightCm !== undefined) {
      localPatch.heightCm = update.heightCm;
      dbPatch.height_cm = update.heightCm;
    }
    if (update.weightKg !== undefined) {
      localPatch.weightKg = update.weightKg;
      dbPatch.weight_kg = update.weightKg;
    }
    if (update.measurementUnit !== undefined) {
      localPatch.measurementUnit = update.measurementUnit;
      dbPatch.measurement_unit = update.measurementUnit;
    }
    if (update.topSize !== undefined) {
      localPatch.topSize = update.topSize;
      dbPatch.top_size = update.topSize;
    }
    if (update.bottomSize !== undefined) {
      localPatch.bottomSize = update.bottomSize;
      dbPatch.bottom_size = update.bottomSize;
    }
    if (update.dressSize !== undefined) {
      localPatch.dressSize = update.dressSize;
      dbPatch.dress_size = update.dressSize;
    }
    if (update.shoeSize !== undefined) {
      localPatch.shoeSize = update.shoeSize;
      dbPatch.shoe_size = update.shoeSize;
    }
    if (update.braSize !== undefined) {
      localPatch.braSize = update.braSize;
      dbPatch.bra_size = update.braSize;
    }
    if (update.brandSizeExamples !== undefined) {
      localPatch.brandSizeExamples = update.brandSizeExamples;
      dbPatch.brand_size_examples = update.brandSizeExamples;
    }
    if (update.bodyTypeSelfTags !== undefined) {
      localPatch.bodyTypeSelfTags = update.bodyTypeSelfTags;
      dbPatch.body_type_self_tags = update.bodyTypeSelfTags;
    }

    let completedAtIso: string | null = null;
    if (update.markCompleted) {
      completedAtIso = new Date().toISOString();
      localPatch.profileCompletedAt = completedAtIso;
      dbPatch.profile_completed_at = completedAtIso;
    }

    // Optimistic local update for both flat state and the per-creator store.
    const nextProfile: CreatorProfile = { ...current, ...localPatch };
    set({
      profiles: { ...profiles, [activeCreatorId]: nextProfile },
      ...(localPatch.firstName !== undefined ? { firstName: nextProfile.firstName } : {}),
      ...(localPatch.lastName !== undefined ? { lastName: nextProfile.lastName } : {}),
      ...(localPatch.heightCm !== undefined ? { heightCm: nextProfile.heightCm } : {}),
      ...(localPatch.weightKg !== undefined ? { weightKg: nextProfile.weightKg } : {}),
      ...(localPatch.measurementUnit !== undefined ? { measurementUnit: nextProfile.measurementUnit } : {}),
      ...(localPatch.topSize !== undefined ? { topSize: nextProfile.topSize } : {}),
      ...(localPatch.bottomSize !== undefined ? { bottomSize: nextProfile.bottomSize } : {}),
      ...(localPatch.dressSize !== undefined ? { dressSize: nextProfile.dressSize } : {}),
      ...(localPatch.shoeSize !== undefined ? { shoeSize: nextProfile.shoeSize } : {}),
      ...(localPatch.braSize !== undefined ? { braSize: nextProfile.braSize } : {}),
      ...(localPatch.brandSizeExamples !== undefined ? { brandSizeExamples: nextProfile.brandSizeExamples } : {}),
      ...(localPatch.bodyTypeSelfTags !== undefined ? { bodyTypeSelfTags: nextProfile.bodyTypeSelfTags } : {}),
      ...(localPatch.profileCompletedAt !== undefined ? { profileCompletedAt: nextProfile.profileCompletedAt } : {}),
    });

    if (Object.keys(dbPatch).length === 0) return;

    const { error } = await withTransientRetry(() =>
      supabase.from('creator_profiles').update(dbPatch).eq('creator_id', activeCreatorId),
    );
    if (error) {
      console.warn('setMeasurements DB error:', error);
      throw new Error(error.message);
    }
  },
}));

export default useProfileStore;

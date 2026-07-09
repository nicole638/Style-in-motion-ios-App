import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as base64Decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import useAuthStore from '@/lib/state/authStore';

export interface ShopperProfile {
  id: string;
  email: string;
  name: string;
  profile_photo_url: string | null;
  location: string | null;
}

export interface ShopperProfilePatch {
  name?: string;
  location?: string | null;
  profile_photo_url?: string | null;
}

async function fetchShopperProfile(): Promise<ShopperProfile | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('audience_accounts')
    .select('id, email, name, profile_photo_url, location')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[useShopperProfile] fetch error:', error);
    throw new Error(error.message);
  }
  return (data as ShopperProfile | null) ?? null;
}

async function uploadAvatar(userId: string, photoUri: string): Promise<string> {
  const path = `${userId}/profile.jpg`;
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
    throw new Error(`Upload failed: ${uploadError.message}`);
  }
  const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export function useShopperProfile() {
  const queryClient = useQueryClient();
  const publicUser = useAuthStore((s) => s.publicUser);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const userType = useAuthStore((s) => s.userType);

  const enabled = isLoggedIn && userType === 'audience';

  const query = useQuery({
    queryKey: ['shopper-profile', publicUser?.email ?? 'anon'],
    queryFn: fetchShopperProfile,
    enabled,
    staleTime: 1000 * 60,
  });

  const savePatch = useMutation({
    mutationFn: async (patch: ShopperProfilePatch) => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('audience_accounts')
        .update(patch)
        .eq('id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopper-profile'] });
    },
  });

  const uploadPhoto = useMutation({
    mutationFn: async (photoUri: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not signed in');
      const publicUrl = await uploadAvatar(userId, photoUri);
      const { error } = await supabase
        .from('audience_accounts')
        .update({ profile_photo_url: publicUrl })
        .eq('id', userId);
      if (error) throw new Error(error.message);
      return publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopper-profile'] });
    },
  });

  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    save: savePatch.mutateAsync,
    saving: savePatch.isPending,
    uploadPhoto: uploadPhoto.mutateAsync,
    uploadingPhoto: uploadPhoto.isPending,
    refetch: query.refetch,
  };
}

export default useShopperProfile;

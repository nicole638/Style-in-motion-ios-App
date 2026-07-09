import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface AppMetadataStore {
  currentVersion: string | null;
  minSupportedVersion: string | null;
  loaded: boolean;
  fetchAppMetadata: () => Promise<void>;
}

const useAppMetadataStore = create<AppMetadataStore>((set) => ({
  currentVersion: null,
  minSupportedVersion: null,
  loaded: false,

  fetchAppMetadata: async () => {
    const { data, error } = await supabase
      .from('app_metadata')
      .select('current_version, min_supported_version')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) {
      set({ loaded: true });
      return;
    }

    set({
      currentVersion: data.current_version ?? null,
      minSupportedVersion: data.min_supported_version ?? null,
      loaded: true,
    });
  },
}));

export default useAppMetadataStore;

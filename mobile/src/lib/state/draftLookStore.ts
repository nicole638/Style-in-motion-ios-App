import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClothingItem, TextLayerItem } from './lookStore';

type LayoutId = 'clean-grid' | 'minimal-luxury' | 'cozy-neutral' | 'bold-influencer';

export interface DraftLookState {
  currentStep: number;
  photoUri: string;
  items: ClothingItem[];
  selectedLayout: LayoutId;
  caption: string;
  selectedHashtags: string[];
  lookTitle: string;
  lookCategory: string;
  lookTags: string;
  editingLookId: string | null;
  // Style-a-Look movable text blocks layered over the hero photo (canvas-space).
  textLayers: TextLayerItem[];
  // Hero photo aspect ratio (width/height); set by Try-on-Model output or upload.
  heroAspectRatio: number | null;
  // True when the hero is a transparent PNG (e.g. a "No background" virtual
  // model). Drives the checkerboard/contain-fit rendering so transparency shows.
  heroTransparent: boolean;

  setCurrentStep: (step: number) => void;
  setPhotoUri: (uri: string) => void;
  setItems: (items: ClothingItem[] | ((prev: ClothingItem[]) => ClothingItem[])) => void;
  setTextLayers: (layers: TextLayerItem[] | ((prev: TextLayerItem[]) => TextLayerItem[])) => void;
  setHeroAspectRatio: (ratio: number | null) => void;
  setHeroTransparent: (transparent: boolean) => void;
  setSelectedLayout: (layout: LayoutId) => void;
  setCaption: (caption: string) => void;
  setSelectedHashtags: (hashtags: string[]) => void;
  setLookTitle: (title: string) => void;
  setLookCategory: (category: string) => void;
  setLookTags: (tags: string) => void;
  setEditingLookId: (id: string | null) => void;
  clearEditingLookId: () => void;
  clearDraft: () => void;
  hasDraft: () => boolean;
}

const INITIAL_STATE = {
  currentStep: 0,
  photoUri: '',
  items: [] as ClothingItem[],
  selectedLayout: 'clean-grid' as LayoutId,
  caption: '',
  selectedHashtags: [] as string[],
  lookTitle: '',
  lookCategory: '',
  lookTags: '',
  editingLookId: null as string | null,
  textLayers: [] as TextLayerItem[],
  heroAspectRatio: null as number | null,
  heroTransparent: false,
};

const useDraftLookStore = create<DraftLookState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      setCurrentStep: (step: number) => set({ currentStep: step }),
      setPhotoUri: (uri: string) => set({ photoUri: uri }),
      setItems: (items: ClothingItem[] | ((prev: ClothingItem[]) => ClothingItem[])) => {
        if (typeof items === 'function') {
          set((state) => ({ items: items(state.items) }));
        } else {
          set({ items });
        }
      },
      setTextLayers: (layers: TextLayerItem[] | ((prev: TextLayerItem[]) => TextLayerItem[])) => {
        if (typeof layers === 'function') {
          set((state) => ({ textLayers: layers(state.textLayers) }));
        } else {
          set({ textLayers: layers });
        }
      },
      setHeroAspectRatio: (ratio: number | null) => set({ heroAspectRatio: ratio }),
      setHeroTransparent: (transparent: boolean) => set({ heroTransparent: transparent }),
      setSelectedLayout: (layout: LayoutId) => set({ selectedLayout: layout }),
      setCaption: (caption: string) => set({ caption }),
      setSelectedHashtags: (hashtags: string[]) => set({ selectedHashtags: hashtags }),
      setLookTitle: (title: string) => set({ lookTitle: title }),
      setLookCategory: (category: string) => set({ lookCategory: category }),
      setLookTags: (tags: string) => set({ lookTags: tags }),
      setEditingLookId: (id: string | null) => set({ editingLookId: id }),
      clearEditingLookId: () => set({ editingLookId: null }),
      clearDraft: () => set(INITIAL_STATE),
      hasDraft: () => {
        const s = get();
        return s.photoUri !== '' || s.items.length > 0 || s.caption !== '';
      },
    }),
    {
      name: 'draft-look-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        photoUri: state.photoUri,
        items: state.items,
        selectedLayout: state.selectedLayout,
        caption: state.caption,
        selectedHashtags: state.selectedHashtags,
        lookTitle: state.lookTitle,
        lookCategory: state.lookCategory,
        lookTags: state.lookTags,
        textLayers: state.textLayers,
        heroAspectRatio: state.heroAspectRatio,
        heroTransparent: state.heroTransparent,
        // currentStep intentionally excluded — always starts at 0
      }),
    }
  )
);

export default useDraftLookStore;

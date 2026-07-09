import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface HashtagStore {
  savedHashtags: string[];
  addHashtag: (tag: string) => void;
  removeHashtag: (tag: string) => void;
  reorderHashtags: (from: number, to: number) => void;
}

const INITIAL_HASHTAGS: string[] = [
  '#ootd',
  '#fashion',
  '#shopthislook',
  '#outfitoftheday',
  '#styleinspo',
  '#fashionblogger',
  '#whatiwore',
  '#todaysoutfit',
  '#lookbook',
  '#momstyle',
  '#fitnessfashion',
  '#activewear',
  '#casualstyle',
  '#datenight',
  '#workwear',
  '#streetstyle',
  '#neutrals',
  '#classicstyle',
  '#minimalfashion',
  '#sustainablefashion',
];

const useHashtagStore = create<HashtagStore>()(
  persist(
    (set) => ({
      savedHashtags: INITIAL_HASHTAGS,

      addHashtag: (tag: string) =>
        set((state) => {
          const normalized = normalizeTag(tag);
          if (!normalized || normalized === '#') return state;
          const exists = state.savedHashtags.some(
            (t) => t.toLowerCase() === normalized.toLowerCase()
          );
          if (exists) return state;
          return { savedHashtags: [...state.savedHashtags, normalized] };
        }),

      removeHashtag: (tag: string) =>
        set((state) => ({
          savedHashtags: state.savedHashtags.filter((t) => t !== tag),
        })),

      reorderHashtags: (from: number, to: number) =>
        set((state) => {
          const arr = [...state.savedHashtags];
          if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) {
            return state;
          }
          const [item] = arr.splice(from, 1);
          arr.splice(to, 0, item);
          return { savedHashtags: arr };
        }),
    }),
    {
      name: 'hashtag-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

function normalizeTag(tag: string): string {
  let normalized = tag.trim().toLowerCase().replace(/\s+/g, '');
  if (normalized.length === 0) return '';
  if (!normalized.startsWith('#')) {
    normalized = '#' + normalized;
  }
  return normalized;
}

export default useHashtagStore;

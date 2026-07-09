import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BrandStore {
  brands: string[];
  customBrands: string[];
  addCustomBrand: (brand: string) => void;
  removeCustomBrand: (brand: string) => void;
  getAllBrands: () => string[];
}

const BUILT_IN_BRANDS: string[] = [
  'Abercrombie & Fitch',
  'Alo Yoga',
  'Amazon',
  'American Eagle',
  'Anthropologie',
  'ASOS',
  'Banana Republic',
  'Bloomingdales',
  'Cotton On',
  'Express',
  'Forever 21',
  'Free People',
  'Gap',
  'Good American',
  'H&M',
  'J.Crew',
  "Levi's",
  'Lou & Grey',
  'Lululemon',
  'Madewell',
  'Marshalls',
  'Nike',
  'Nordstrom',
  'Nordstrom Rack',
  'Old Navy',
  'On Running',
  'Princess Polly',
  'PrettyLittleThing',
  'Quay',
  'Reformation',
  'Revolve',
  'Shein',
  'Steve Madden',
  'Target',
  'TJ Maxx',
  'Urban Outfitters',
  'Walmart',
  'Zara',
];

const useBrandStore = create<BrandStore>()(
  persist(
    (set, get) => ({
      brands: BUILT_IN_BRANDS,
      customBrands: [],

      addCustomBrand: (brand: string) =>
        set((state) => {
          const trimmed = brand.trim();
          if (!trimmed) return state;
          const allBrands = [...state.brands, ...state.customBrands];
          const exists = allBrands.some(
            (b) => b.toLowerCase() === trimmed.toLowerCase()
          );
          if (exists) return state;
          return { customBrands: [...state.customBrands, trimmed] };
        }),

      removeCustomBrand: (brand: string) =>
        set((state) => ({
          customBrands: state.customBrands.filter((b) => b !== brand),
        })),

      getAllBrands: () => {
        const state = get();
        const all = [...state.brands, ...state.customBrands];
        return all.sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
      },
    }),
    {
      name: 'brand-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ customBrands: state.customBrands }),
      merge: (persisted, current) => ({
        ...current,
        customBrands:
          (persisted as Partial<BrandStore>)?.customBrands ??
          current.customBrands,
      }),
    }
  )
);

export default useBrandStore;

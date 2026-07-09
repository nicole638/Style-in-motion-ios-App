import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
}

interface CategoryStore {
  categories: Category[];
  isLoading: boolean;
  fetchCategories: () => Promise<void>;
}

const useCategoryStore = create<CategoryStore>()((set, get) => ({
  categories: [],
  isLoading: false,

  fetchCategories: async () => {
    if (get().categories.length > 0) return; // already loaded
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      set({ categories: data ?? [], isLoading: false });
    } catch (e) {
      console.warn('fetchCategories error:', e);
      set({ isLoading: false });
    }
  },
}));

export default useCategoryStore;

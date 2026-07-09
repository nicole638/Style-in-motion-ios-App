import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';

export interface CollageBackdrop {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  thumbnailUrl: string;
  sortOrder: number;
}

function rowToBackdrop(row: any): CollageBackdrop | null {
  const id = row?.id ? String(row.id) : null;
  const imageUrl = row?.image_url ? String(row.image_url) : null;
  if (!id || !imageUrl) return null;
  return {
    id,
    name: String(row.name ?? ''),
    category: String(row.category ?? ''),
    imageUrl,
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : imageUrl,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
  };
}

/**
 * Fetches the canonical collage backdrop library from get_collage_backdrops.
 * Server sorts: color → gradient → texture → pattern → studio → lifestyle → outdoor.
 * 30-min staleTime — backdrops change rarely.
 */
export function useCollageBackdrops() {
  return useQuery({
    queryKey: ['collageBackdrops'],
    queryFn: async (): Promise<CollageBackdrop[]> => {
      const { data, error } = await supabase.rpc('get_collage_backdrops');
      if (error) {
        console.warn('[useCollageBackdrops] rpc error:', error.message);
        throw error;
      }
      return (data ?? [])
        .map(rowToBackdrop)
        .filter((b: CollageBackdrop | null): b is CollageBackdrop => b !== null);
    },
    staleTime: 1000 * 60 * 30,
  });
}

/**
 * Best-effort prefetch of the next N thumbnails + full images in a category
 * so taps feel instant. Called on category change.
 */
export function prefetchBackdrops(items: CollageBackdrop[], count = 3): void {
  const slice = items.slice(0, count);
  for (const b of slice) {
    Image.prefetch(b.thumbnailUrl).catch(() => {});
    Image.prefetch(b.imageUrl).catch(() => {});
  }
}

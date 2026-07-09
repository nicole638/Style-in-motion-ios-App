import type { ClothingItem, ItemCategory } from '@/lib/state/lookStore';

/**
 * Normalize a closet search term the same way for the Closet tab and the
 * collage picker: trim, lowercase, and strip the characters that are special
 * to a Postgres `ilike` pattern (`%` and `,`). Stripping keeps a server-side
 * refetch with the same term safe even though we filter in memory today.
 */
export function normalizeClosetSearch(term: string): string {
  return term.replace(/[%,]/g, '').trim().toLowerCase();
}

/**
 * Client-side mirror of the server filter: an item matches when its
 * name / brand / category contains the (normalized) term, AND — when a chip is
 * selected — its category exactly equals that value. Search + chip AND together.
 */
export function filterClosetItems(
  items: ClothingItem[],
  term: string,
  category: ItemCategory | null,
): ClothingItem[] {
  const q = normalizeClosetSearch(term);
  if (!q && !category) return items;
  return items.filter((item) => {
    if (category && item.category !== category) return false;
    if (!q) return true;
    return (
      !!item.name?.toLowerCase().includes(q) ||
      !!item.brand?.toLowerCase().includes(q) ||
      !!item.category?.toLowerCase().includes(q)
    );
  });
}

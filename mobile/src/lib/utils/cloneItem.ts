import type { ClothingItem } from '@/lib/state/lookStore';

// Clone a creator's canonical closet item into a draft look.
// We keep the canonical `id` so the save path in lookStore can resolve it back
// to the same creator_items row (vs. duplicating a canonical that already
// exists). The look_items link fields (lookItemId, sortOrder) are cleared so
// the save path inserts a fresh join row for the new look.
export function cloneItemsToDraft(items: ClothingItem[]): ClothingItem[] {
  return items.map(cloneItemToDraft);
}

export function cloneItemToDraft(item: ClothingItem): ClothingItem {
  const cloned: ClothingItem = {
    ...item,
    archived: false,
  };
  delete cloned.lookItemId;
  delete cloned.sortOrder;
  return cloned;
}

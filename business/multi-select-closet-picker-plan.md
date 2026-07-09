# Plan: Multi-Select Closet Picker for Look Creator (Pattern B)

## Context

The create-a-look flow currently only supports adding items one-at-a-time via a manual form (Step 1). Creators who already have closet items want to batch-select them into a new look. The eval doc (`business/multi-select-look-eval.md`) recommends Pattern B: an "Add from Closet" button on Step 1 that opens a multi-select picker sheet.

## Layout Audit Findings

- **Create tab (Step 1)** is a regular tab screen — NOT a modal. Opening a `<Modal>` from inside it is safe (no stacking issue).
- **LookPickerSheet** is the closest analog: RN `<Modal visible transparent animationType="slide">`, `maxHeight: SCREEN_HEIGHT * 0.65`, drag-handle + pan-to-dismiss gesture, FlatList body, backdrop press to close. We mirror this pattern byte-for-byte.
- **ItemDetailSheet** proves that nested Modals work fine in this app (it stacks 3: main sheet, confirmation, LookPickerSheet).
- No "Rule 115" or "Rule 411" files exist — the user prompt referenced hypothetical rules. The real patterns are in `LookPickerSheet.tsx` and `ItemDetailSheet.tsx`.

## Implementation

### File 1: `mobile/src/lib/utils/cloneItem.ts` — add batch helper

Add `cloneItemsToDraft` that maps over `cloneItemToDraft`:

```ts
export function cloneItemsToDraft(items: ClothingItem[]): ClothingItem[] {
  return items.map(cloneItemToDraft);
}
```

### File 2: `mobile/src/components/ClosetPickerSheet.tsx` — NEW

Mirror `LookPickerSheet.tsx` structure exactly:
- `<Modal visible={visible} transparent animationType="slide">`
- Backdrop press + pan-to-dismiss gesture (same spring physics: damping 20, stiffness 200)
- Drag handle (40×4, #E8E0D8, centered)
- `maxHeight: SCREEN_HEIGHT * 0.80` (taller than LookPickerSheet because grid needs more room)
- Header: "Add from Closet" title + subtitle
- Search bar: `TextInput` filtering by name/brand/category (same logic as `shop.tsx:143-151`)
- 2-column `FlatList` with `numColumns={2}` rendering closet item cards
- Card style mirrors `shop.tsx` `itemGridCard` styles but adds a checkbox overlay (top-right corner, circular, with checkmark icon from lucide)
- Tap toggles selection via local `Set<string>` state
- Haptic feedback on selection toggle
- Items already in draft get a subtle "Already added" pill and are non-selectable
- Sticky footer: "Add N Items" button (disabled when N=0, accent color when N>0)
- Cancel/close button at very bottom (same pattern as LookPickerSheet)
- Empty state when closet has 0 non-archived items
- First-time tip banner (AsyncStorage key `closet-picker-tip-seen`)

Data source: `useLookStore(s => s.closetItems)` — same store the Closet tab reads. Already filtered to `archived=false` at fetch time (`lookStore.ts:108`).

Props interface:
```ts
interface ClosetPickerSheetProps {
  visible: boolean;
  existingItemIds: string[];  // ids already in draft, for dedup UI
  onClose: () => void;
  onItemsSelected: (items: ClothingItem[]) => void;
}
```

On confirm flow:
1. Filter closetItems by selectedIds
2. Call `onItemsSelected(selectedItems)` — parent handles cloning + dedup + store injection
3. Close sheet

### File 3: `mobile/src/app/(tabs)/create.tsx` — wire into StepAddItems

**In the parent `CreateScreen` component:**
- Add state: `const [showClosetPicker, setShowClosetPicker] = useState(false);`
- Add handler: `handleClosetItemsSelected(selectedItems)` that:
  - Calls `cloneItemsToDraft(selectedItems)`
  - Deduplicates against existing `items` by `id`
  - Calls `setItems(prev => [...prev, ...newOnly])`
  - Shows toast if any duplicates were skipped
- Render `<ClosetPickerSheet>` at the component root level (not inside StepAddItems)
- Pass `onOpenClosetPicker={() => setShowClosetPicker(true)}` as new prop to StepAddItems

**In StepAddItems:**
- Add prop: `onOpenClosetPicker: () => void`
- Add new button below "Add Another Piece" (line 1845):
  - Same dashed-border style but with a different icon (Shirt from lucide or similar)
  - Text: "Add from Closet"
  - testID: `"add-from-closet-btn"`
  - Only shown when `!showForm` (same condition as "Add Another Piece")

## Files Changed

| File | Change |
|---|---|
| `mobile/src/lib/utils/cloneItem.ts` | Add `cloneItemsToDraft` batch helper (3 lines) |
| `mobile/src/components/ClosetPickerSheet.tsx` | **NEW** — multi-select closet picker modal |
| `mobile/src/app/(tabs)/create.tsx` | Add picker state/handler in CreateScreen, add "Add from Closet" button + prop in StepAddItems |

## Files NOT Changed

- `draftLookStore.ts` — `setItems` updater already sufficient
- `shop.tsx` — no closet-tab selection mode (Pattern A, deferred)
- `ItemDetailSheet.tsx` — single-item "Use in New Look" stays
- `LookPickerSheet.tsx` — "Add to Existing Look" stays
- `_layout.tsx` — no new routes needed (it's a Modal component, not a route)

## Verification

1. `bunx tsc --noEmit` — exit 0
2. Open create flow → Step 1 → tap "Add from Closet" → picker sheet slides up
3. Grid shows all non-archived closet items; search filters correctly
4. Tap items to select (checkbox appears, haptic fires); tap again to deselect
5. "Add N Items" button shows correct count and is tappable
6. Confirm → items appear in Step 1 piece grid
7. Re-open picker → items already in draft show "Already added" and can't be re-selected
8. Empty closet → empty state message appears
9. First-time tip shows on first open, dismiss persists via AsyncStorage

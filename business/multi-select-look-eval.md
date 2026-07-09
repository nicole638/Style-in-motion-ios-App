# Multi-Select Closet Items → New Look — Design Evaluation

**Date:** 2026-04-28  
**Status:** READ-ONLY evaluation — no production code changes  
**Scope:** Evaluate adding a multi-select flow that lets creators batch-pick closet items and funnel them into a new look draft

---

## 1. Current State

### How items enter a look today

| Entry point | Location | Behavior |
|---|---|---|
| **Manual form (Step 1)** | `create.tsx` → `StepAddItems` | Creator fills out name/category/price/link/photo one item at a time, hits "Add Another Piece" to repeat |
| **"Use in New Look"** | `ItemDetailSheet.tsx` line 103–109 | Single-item action: clones item via `cloneItemToDraft`, pushes to `/(tabs)/create` |
| **"Add to Existing Look"** | `ItemDetailSheet.tsx` line 191–197 | Opens `LookPickerSheet`, adds one item to a chosen look |

### Closet browsing

- **Closet tab** in `shop.tsx`: 2-column `FlatList` of `ClothingItem` cards, tap opens `ItemDetailSheet`.
- No multi-select UI exists — no checkboxes, no selection bar, no batch actions.
- Search/filter is text-based only (`searchQuery`).

### Draft store capability

`draftLookStore.ts` already supports bulk item injection:

```ts
setItems: (items: ClothingItem[] | ((prev: ClothingItem[]) => ClothingItem[])) => void
// Updater form: setItems((prev) => [...prev, ...newItems])
```

`cloneItemToDraft(item)` in `cloneItem.ts` strips `lookItemId` and `sortOrder`, preserving canonical `id`.

### Create flow steps

| Step | Component | Purpose |
|---|---|---|
| 0 | `StepUploadPhoto` | Upload/edit the look's hero photo + title |
| 1 | `StepAddItems` | Add items one-by-one via form |
| 2 | `StepChooseLayout` | Pick layout template |
| 3 | `StepPreview` | Preview + caption/hashtags |
| 4 | Post confirmation | Published / share flows |

---

## 2. Three Proposed Patterns

### Pattern A — Closet-Initiated Multi-Select

**Entry:** Long-press or "Select" button on the Closet tab activates selection mode.

**Flow:**
1. Creator enters Closet tab, taps "Select" (or long-presses any item)
2. Grid cards gain checkbox overlays; tapping toggles selection
3. Floating action bar appears at bottom: **"Create Look with N items"**
4. Tap FAB → clones selected items into `draftLookStore` → navigates to `/(tabs)/create` at Step 0
5. Creator uploads photo, then sees pre-populated items at Step 1

**Key UI elements:**
- Selection mode toggle (header button or long-press gesture)
- Checkbox overlay on each grid card
- Floating selection bar with count + "Create Look" CTA
- Exit selection mode (X or back)

**Files changed:**
- `shop.tsx` — selection state, checkbox overlays, floating bar, mode toggle
- `cloneItem.ts` — batch variant `cloneItemsToDraft(items[])`
- Possibly extract closet grid into dedicated component for cleanliness

**Files unchanged:** `create.tsx`, `draftLookStore.ts`, `ItemDetailSheet.tsx`

---

### Pattern B — Look-Creator-Initiated Multi-Select

**Entry:** New "Add from Closet" button on Step 1 of the create flow.

**Flow:**
1. Creator starts a new look normally (Step 0 → Step 1)
2. On Step 1, alongside "Add Another Piece", they see **"Add from Closet"**
3. Tapping opens a full-screen or sheet-style closet picker with checkboxes
4. Creator multi-selects items, hits "Add N Items"
5. Selected items are cloned and appended to the draft; form returns to Step 1

**Key UI elements:**
- New `ClosetPickerSheet` component (modal or form sheet)
- Same 2-column grid as Closet tab but with checkboxes
- Search/filter within the picker
- "Add N Items" confirm button
- Badge showing count

**Files changed:**
- `create.tsx` — "Add from Closet" button on Step 1
- New component: `ClosetPickerSheet.tsx`
- `cloneItem.ts` — batch variant

**Files unchanged:** `shop.tsx`, `draftLookStore.ts`

---

### Pattern C — Hybrid (Both Entry Points)

Implements both A and B. Creator can start from the closet ("I know what I want to wear") or from the create flow ("I'm already building a look and want to pull in existing items").

**Files changed:** Everything from A + B.

---

## 3. Comparison

| Criterion | A: Closet-Initiated | B: Creator-Initiated | C: Hybrid |
|---|---|---|---|
| **Discoverability** | High — visible in the closet where items live | Medium — only visible during look creation | Highest — both paths |
| **Disruption to existing UX** | Medium — adds selection mode to a browsing surface | Low — additive button on existing step | Medium — both surfaces change |
| **Implementation effort** | ~3–4 days | ~2–3 days | ~5–6 days |
| **Edge cases** | Draft-in-progress conflict, empty selection, 20+ items | Same as A minus the selection mode complexity | Union of both |
| **Draft conflict risk** | Higher — creator may not expect to land on create tab with items pre-loaded | Lower — they're already in the create flow | Moderate |
| **Natural mental model** | "I'm shopping my closet" → build a look | "I'm building a look" → pull from closet | Both mental models supported |

---

## 4. Recommendation

**Pattern B (Look-Creator-Initiated)** is the strongest first move.

**Why:**

1. **Lower risk.** The create flow already expects items to be added at Step 1. Adding a "pull from closet" button fits the existing mental model perfectly — creator is already in "build mode."

2. **No draft-conflict problem.** Pattern A has to handle the case where the creator already has an in-progress draft. Do we discard it? Merge items? Prompt? Pattern B sidesteps this entirely because the creator is already in their draft.

3. **Smaller blast radius.** `shop.tsx` is the most complex screen in the app (~3400 lines). Adding selection mode to it requires careful state management and risks regressions on the browsing/search/archive flows. Pattern B isolates the new UI to a self-contained picker component.

4. **Natural upgrade path.** If Pattern B proves popular, Pattern A can be added later (yielding Pattern C) with confidence that the picker component and batch-clone utility already work.

**Pattern A can be Phase 2** if analytics show creators frequently browse the closet *before* starting a new look.

---

## 5. Implementation Outline (Pattern B)

### New files

| File | Purpose |
|---|---|
| `src/components/ClosetPickerSheet.tsx` | Multi-select closet grid in a modal/form sheet |

### Modified files

| File | Change |
|---|---|
| `src/app/(tabs)/create.tsx` | Add "Add from Closet" button in `StepAddItems`, wire up picker open/close and item injection |
| `src/lib/utils/cloneItem.ts` | Add `cloneItemsToDraft(items: ClothingItem[]): ClothingItem[]` batch helper |

### Unchanged files

| File | Why |
|---|---|
| `draftLookStore.ts` | `setItems` updater already supports `(prev) => [...prev, ...newBatch]` — no changes needed |
| `shop.tsx` | Closet tab is not modified in Pattern B |
| `ItemDetailSheet.tsx` | Single-item "Use in New Look" stays as-is |
| `LookPickerSheet.tsx` | "Add to Existing Look" stays as-is |

### State management

```
ClosetPickerSheet (local state)
├── selectedIds: Set<string>        ← toggle on tap
├── searchQuery: string             ← filter within picker
└── on confirm:
    ├── map selectedIds → ClothingItem[]
    ├── cloneItemsToDraft(items)
    ├── draftLookStore.setItems((prev) => [...prev, ...cloned])
    └── close sheet
```

No new Zustand stores. No new persisted state. Selection is ephemeral within the picker modal.

### ClosetPickerSheet design sketch

```
┌─────────────────────────────────────────┐
│  ─── (drag handle) ───                  │
│                                         │
│  Add from your Closet                   │
│  Select items to include in this look   │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  🔍 Search closet...            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌──────────┐  ┌──────────┐             │
│  │  ☑ img   │  │  ☐ img   │             │
│  │  Name    │  │  Name    │             │
│  │  Brand   │  │  Brand   │             │
│  └──────────┘  └──────────┘             │
│  ┌──────────┐  ┌──────────┐             │
│  │  ☐ img   │  │  ☑ img   │             │
│  │  Name    │  │  Name    │             │
│  │  Brand   │  │  Brand   │             │
│  └──────────┘  └──────────┘             │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │    Add 2 Items to Look          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Cancel                                 │
└─────────────────────────────────────────┘
```

### Edge cases to handle

| Edge case | Resolution |
|---|---|
| **Item already in draft** | Check by `id` before cloning; skip duplicates, show toast "N items already in this look" |
| **Empty closet** | Show empty state: "Your closet is empty. Add items first." |
| **Archived items** | Exclude from picker (filter `!item.archived`) |
| **20+ items selected** | Allow it — `StepAddItems` already renders a scrollable list. Consider a soft cap toast at 15 ("looks with fewer items perform better") |
| **Closet loads while picker is open** | `useLookStore(s => s.closetItems)` is reactive — grid auto-updates |
| **Selection then cancel** | Ephemeral state — nothing persists, no side effects |

### Effort estimate

| Task | Estimate |
|---|---|
| `ClosetPickerSheet` component (grid, checkboxes, search, confirm) | 1–1.5 days |
| `cloneItemsToDraft` batch helper + dedup logic | 0.5 day |
| Wire into `StepAddItems` with "Add from Closet" button | 0.5 day |
| Polish (haptics, animations, empty states, already-in-draft handling) | 0.5 day |
| **Total** | **~2.5–3 days** |

---

## 6. What NOT to build (yet)

- **Drag-to-reorder after multi-add.** Step 1 doesn't support reordering today — don't scope-creep.
- **Category filters in picker.** Search covers this. Filters can come later if the closet grows large.
- **Cross-look duplicate warning** ("This item is already in 3 other looks"). Useful but adds complexity for marginal value.
- **Closet-tab selection mode (Pattern A).** Defer to Phase 2.

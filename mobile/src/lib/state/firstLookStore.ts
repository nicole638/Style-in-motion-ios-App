import { create } from 'zustand';

/**
 * Ephemeral, in-memory store backing the "First 5 Minutes" creator activation
 * flow. Holds the aesthetic tags the creator picked on /onboarding/aesthetic
 * and the three closet items they picked on /onboarding/pick-three.
 *
 * Intentionally NOT persisted — this is a one-time flow per creator and we
 * don't want stale picks leaking into a future session. State is reset by
 * `reset()` after the celebration screen.
 */
export interface FirstLookState {
  aestheticTags: string[];
  pickedItemIds: string[];
  setAestheticTags: (tags: string[]) => void;
  setPickedItemIds: (ids: string[]) => void;
  reset: () => void;
}

const useFirstLookStore = create<FirstLookState>((set) => ({
  aestheticTags: [],
  pickedItemIds: [],
  setAestheticTags: (tags: string[]) => set({ aestheticTags: tags }),
  setPickedItemIds: (ids: string[]) => set({ pickedItemIds: ids }),
  reset: () => set({ aestheticTags: [], pickedItemIds: [] }),
}));

export default useFirstLookStore;

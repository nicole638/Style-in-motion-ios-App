// Computes what percentage of the creator profile has been filled in.
// Each criterion below contributes equally so the user sees steady progress.

import type { ProfileState } from '@/lib/state/profileStore';

interface CompletionInputs {
  photoUri?: string | null;
  bio?: string | null;
  location?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  // at least one of these social handles filled in
  socialHandles?: Array<string | null | undefined>;
  heightCm?: number | null;
  topSize?: string | null;
  dressSize?: string | null;
  shoeSize?: string | null;
  bodyTypeSelfTagsCount?: number;
  brandSizeExamplesCount?: number;
}

const has = (v?: string | null): boolean => !!v && String(v).trim().length > 0;

export function computeCompletionPct(inputs: CompletionInputs): number {
  const buckets: boolean[] = [
    has(inputs.photoUri),
    has(inputs.bio),
    has(inputs.location),
    has(inputs.firstName) && has(inputs.lastName),
    (inputs.socialHandles ?? []).some((h) => has(h)),
    typeof inputs.heightCm === 'number' && inputs.heightCm > 0,
    has(inputs.topSize) || has(inputs.dressSize),
    has(inputs.shoeSize),
    (inputs.bodyTypeSelfTagsCount ?? 0) > 0,
    (inputs.brandSizeExamplesCount ?? 0) > 0,
  ];
  const filled = buckets.filter(Boolean).length;
  return Math.round((filled / buckets.length) * 100);
}

// Convenience selector that pulls everything from the flat profile state.
export function completionPctFromState(s: ProfileState): number {
  return computeCompletionPct({
    photoUri: s.photoUri,
    bio: s.bio,
    location: s.location,
    firstName: s.firstName,
    lastName: s.lastName,
    socialHandles: [],
    heightCm: s.heightCm,
    topSize: s.topSize,
    dressSize: s.dressSize,
    shoeSize: s.shoeSize,
    bodyTypeSelfTagsCount: s.bodyTypeSelfTags.length,
    brandSizeExamplesCount: s.brandSizeExamples.length,
  });
}

// Auto-derived body type tags. Mirrors the SQL function logic exactly so the
// public view and the local UI agree.
export interface AutoTagInputs {
  heightCm?: number | null;
  topSize?: string | null;
  dressSize?: string | null;
}

const PLUS_TOP_SIZES = new Set(['XL', 'XXL', '1X', '2X', '3X', '4X', '5X']);
const STRAIGHT_TOP_SIZES = new Set(['XS', 'S', 'M', 'L']);

function parseDressSize(v?: string | null): number | null {
  if (!v) return null;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizeTopSize(v?: string | null): string | null {
  if (!v) return null;
  return String(v).trim().toUpperCase();
}

export function deriveAutoTags(inputs: AutoTagInputs): string[] {
  const tags: string[] = [];
  const h = inputs.heightCm ?? null;
  if (typeof h === 'number' && h > 0) {
    if (h <= 160) tags.push('petite');
    else if (h >= 175) tags.push('tall');
    else tags.push('average-height');
  }
  const top = normalizeTopSize(inputs.topSize);
  const dress = parseDressSize(inputs.dressSize);
  const isPlus = (top && PLUS_TOP_SIZES.has(top)) || (dress !== null && dress >= 14);
  const isStraight = (top && STRAIGHT_TOP_SIZES.has(top)) || (dress !== null && dress >= 0 && dress <= 6);
  const isMidsize = dress !== null && dress >= 8 && dress <= 12;
  if (isPlus) tags.push('plus');
  if (isStraight && !isPlus) tags.push('straight');
  if (isMidsize && !isPlus) tags.push('midsize');
  return tags;
}

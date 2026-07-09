import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { decode as base64Decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { withTransientRetry } from '@/lib/supabaseRetry';
import { stripTrackingParams } from '@/lib/utils/stripTrackingParams';
import { type AlternateItem, MAX_ALTERNATES } from '@/lib/types/alternate';
import useDraftLookStore from './draftLookStore';
import useLikeStore from './likeStore';
import useContextStore from './contextStore';

export { type AlternateItem, MAX_ALTERNATES };

export type ItemCategory = 'Top' | 'Pants' | 'Dress' | 'Shoes' | 'Bag' | 'Jewelry' | 'Accessory' | 'Outerwear' | 'Intimates' | 'Swimwear' | 'Other';

export interface ClothingItem {
  id: string;                 // creator_items.id (canonical closet id)
  lookItemId?: string;        // look_items.id — present when loaded from a look
  sortOrder?: number;         // look_items.sort_order — present when loaded from a look
  wornSize?: string | null;   // look_items.worn_size — per-look size override (free text)
  defaultWornSize?: string | null; // creator_items.default_worn_size — creator's usual size for this piece
  category: ItemCategory;
  name: string;
  price: string;
  link: string;               // maps to creator_items.url
  canonicalUrl?: string;      // clean URL from <link rel="canonical"> — preferred for dedupe
  emoji: string;
  photoUri?: string;          // maps to creator_items.photo_url (our cached Supabase URL when backend cached)
  originalPhotoUri?: string;  // maps to creator_items.original_photo_url (the merchant URL we fetched from)
  cutout_photo_url?: string;  // maps to creator_items.cutout_photo_url (Photoroom result, cached per item)
  candidatePhotoUrls?: string[]; // maps to creator_items.candidate_photo_urls (up to 6 alt merchant images for the picker)
  candidateCutoutUrls?: (string | null)[]; // maps to creator_items.candidate_cutout_urls (Photoroom cutouts parallel to candidatePhotoUrls; entries may be null while pending)
  brand?: string | null;
  alternates: AlternateItem[]; // maps to creator_items.alternates jsonb (up to MAX_ALTERNATES)
  primaryNote?: string;       // maps to creator_items.primary_note
  // Affiliate link fields — populated by Skimlinks (or future providers)
  affiliate_url?: string;
  affiliate_provider?: string;
  affiliate_wrapped_at?: string;
  archived?: boolean;
  createdAt?: string;
  fromStarterPack?: boolean;  // maps to creator_items.from_starter_pack — rendered as a small pill in the closet grid
  trrEligible?: boolean;      // maps to creator_items.trr_eligible — server-computed (TheRealReal-accepted brand)
  fetchStatus?: 'pending' | 'complete' | 'partial' | 'failed';
  fetchError?: string | null;
  fetchStartedAt?: string | null;
  fetchCompletedAt?: string | null;
  // Deprecated — kept for backward compat reads until Part B migrates display code
  alternateLink?: string;
  alternateLabel?: string;
}

export interface Look {
  id: string;
  title?: string;
  photoUri: string;    // maps to cover_photo_url in DB
  items: ClothingItem[];
  layout: 'clean-grid' | 'minimal-luxury' | 'cozy-neutral' | 'bold-influencer';
  caption: string;
  hashtags: string[];
  createdAt: string;   // maps to created_at in DB
  clicks: number;
  views?: number;      // maps to looks.views (atomic counter; SECURITY DEFINER RPC)
  creatorId?: string;  // maps to creator_id in DB
  category?: string;   // maps to category in DB
  tags?: string[];     // maps to tags in DB
  occasion?: string[];
  season?: string[];
  style_vibe?: string[];
  color_palette?: string[];
  clothing_type?: string[];
  creator_tags?: string[];
  archived: boolean;   // maps to archived in DB
  shortCode?: string;  // maps to short_code in DB — 6 hex chars used for app.styledinmotion.app/n/{code}
  /**
   * NULL = draft (not yet published). Non-null timestamp = published at that time.
   * Public feeds filter `published_at IS NOT NULL`; draft list filters `published_at IS NULL`.
   */
  publishedAt?: string | null; // maps to published_at in DB
  updatedAt?: string;          // maps to updated_at in DB — used to sort the drafts list
  /**
   * Phase 2 freeform-within-template layout. NULL on a row means
   * "Phase 1 auto-template, not editable in builder" — pre-Phase-2 saves
   * (and any non-collage look) leave this column NULL, which is why the
   * edit button is hidden for collage-tagged looks without a layout.
   */
  collageLayout?: CollageLayout | null;
  /**
   * Style-a-Look editor layout — movable/resizable/recolorable text blocks over
   * the hero photo, plus hero meta. SEPARATE from collageLayout so the look-type
   * router (tags.includes('collage') && collageLayout) keeps routing these to the
   * Style-a-Look editor. NULL = non-style-look or legacy save (no text blocks).
   * The hero is flattened into cover_photo_url at save, so feeds need no change;
   * styleLayout is re-hydrated only when reopening for edit.
   */
  styleLayout?: StyleLayout | null;
  likesCount?: number;  // maps to likes_count in DB (trigger-maintained)
}

export interface StyleLayout {
  text: TextLayerItem[];
  /** Width/height of the hero photo (model = PORTRAIT_HD_3_2 ≈ 0.667; uploads ≈ 0.75). */
  heroAspectRatio?: number;
  /** Canvas-space reference dims the text x/y/fontSize were authored in (e.g. 1080×1440). */
  canvasWidth: number;
  canvasHeight: number;
}

export interface CollageLayoutItem {
  itemId: string;
  x: number;        // canvas-space center X (0–1080)
  y: number;        // canvas-space center Y (0–1080)
  scale: number;    // 0.3–2.5
  rotation: number; // degrees; pre-Phase-3 saves default to 0 at the load boundary
  zIndex: number;   // higher = front
}

export interface TextLayerItem {
  id: string;
  text: string;
  fontSize: number;      // canvas-space (96 = default)
  color: string;         // hex
  fontFamily: string;    // "display" | "body"
  x: number;             // canvas-space center X (0–1080)
  y: number;             // canvas-space center Y (0–1080)
  scale: number;
  rotation: number;
  zIndex: number;
  /** Optional canvas-space letter tracking (e.g. tracked editorial labels). */
  letterSpacing?: number;
  /** Optional pill background behind the text (e.g. price chips). */
  backgroundColor?: string;
  /** Optional text opacity 0–1 (e.g. faded footers). */
  opacity?: number;
  /**
   * Dupe Drop price bubbles: when set, this bubble is bound to a specific placed
   * item (creator_items.id). One bubble is generated per placed item, auto-fills
   * from that item's price, and is positioned relative to it. Persisted so that
   * on save→reopen each bubble re-attaches to its item by itemId (verbatim), not
   * by screen position. Cleared the moment the creator edits the bubble, which
   * turns it into a fixed manual override.
   */
  priceForItemId?: string;
}

export interface PhotoLayerItem {
  id: string;
  url: string;           // Supabase storage https URL
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
  /**
   * Width/height ratio of the source photo. Photoroom's Virtual Model EF
   * returns this so portrait outputs (default 0.667 ≈ 2:3) don't get clipped
   * into the square 600×600 bounding box. Older layers omit this and stay square.
   */
  aspectRatio?: number;
}

export interface CollageLayout {
  template: 'style-journal' | 'editorial' | 'grid' | 'editorial-cover' | 'dupe-drop' | 'whats-in-my-bag';
  background?: string;           // hex override for canvas bg (solid color)
  backgroundImage?: string;      // full image_url of selected backdrop (cover-fits canvas)
  backdropId?: string;           // get_collage_backdrops.id — for re-selection across edits
  items: CollageLayoutItem[];
  photos?: PhotoLayerItem[];     // free-floating photo layers
  text?: TextLayerItem[];        // free-floating text layers
  /**
   * Per-decoration text overrides for templates that include editable
   * decorations. Keyed by the decoration's index in the template's
   * `decorations` array. Missing/empty falls back to the template default.
   */
  textOverrides?: Record<string, string>;
  /**
   * For templates with a `lookCover` slot — the full-body photo source.
   * May be a local file URI during compose; cloud URL after upload.
   */
  lookCoverPhotoUri?: string | null;
}

export type LookFetchOptions = {
  includeArchived?: boolean;
  archivedOnly?: boolean;
  /**
   * If non-empty, restrict the public feed to looks whose creator's
   * `creator_profiles_public.body_type_tags` array overlaps these tags.
   * Only honored on the non-archived public path inside `fetchLooks` —
   * ignored for archivedOnly and creator-own queries.
   */
  bodyTypeFilter?: string[];
};

// Module-scoped set tracking in-flight publishes by creator id.
// Belt-and-suspenders defense (component already has a useRef gate) so two
// concurrent addLook calls from the same creator can't both reach the network.
const inFlightPublishes = new Set<string>();

interface LookStore {
  looks: Look[];
  archivedLooksByCreator: Record<string, Look[]>;
  draftLooksByCreator: Record<string, Look[]>;
  closetItems: ClothingItem[];
  archivedClosetItems: ClothingItem[];
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  fetchLooks: (options?: LookFetchOptions) => Promise<void>;
  fetchLooksByCreator: (creatorId: string, options?: LookFetchOptions) => Promise<void>;
  fetchArchivedLooksByCreator: (creatorId: string) => Promise<void>;
  fetchDraftLooksByCreator: (creatorId: string) => Promise<void>;
  // Single-look fetcher. Used by surfaces that deep-link into a specific look
  // (e.g. /collage-builder?lookId=…) when that look may not yet be in any
  // local slice — typically a server-seeded draft created outside the
  // addLook flow. Hydrates the result into `looks` if published, or into
  // `draftLooksByCreator[creator_id]` if it's an unpublished draft. Returns
  // the Look on success, null if the id doesn't resolve (deleted, archived,
  // or no RLS access).
  fetchLookById: (lookId: string) => Promise<Look | null>;
  loadClosetItems: (creatorId: string) => Promise<void>;
  loadArchivedClosetItems: (creatorId: string) => Promise<void>;
  addLook: (look: Omit<Look, 'id' | 'createdAt' | 'clicks'>, opts?: { idempotencyKey?: string; asDraft?: boolean }) => Promise<Look | null>;
  updateLook: (updatedLook: Look) => Promise<void>;
  deleteLook: (id: string) => Promise<void>;
  archiveLook: (id: string) => Promise<void>;
  unarchiveLook: (id: string) => Promise<void>;
  updateItem: (itemId: string, patch: Partial<ClothingItem>) => Promise<void>;
  archiveItem: (itemId: string) => Promise<void>;
  unarchiveItem: (itemId: string) => Promise<void>;
  removeItemFromLook: (lookId: string, itemId: string) => Promise<number>;
  // Returns how many looks reference this closet item (pre-delete check). Does NOT delete.
  getClosetItemUsage: (itemId: string) => Promise<{ usageCount: number }>;
  // True if this closet item appears in at least one PUBLISHED look (published_at
  // IS NOT NULL = posted/shared to the creator's feed). Used to gate Consign Now:
  // a piece must be styled + shared before it can be consigned. Fails open (true)
  // on a query error so a backend hiccup never blocks an otherwise-eligible creator.
  isItemInPublishedLook: (itemId: string) => Promise<boolean>;
  deleteItemPermanently: (itemId: string) => Promise<void>;
  incrementClicks: (lookId: string) => Promise<void>;
  addItemToLook: (lookId: string, itemId: string) => Promise<'added' | 'already_in_look' | 'error'>;
  addStandaloneClosetItem: (creatorId: string, item: ClothingItem) => Promise<string | null>;
  quickAddClosetItemPending: (creatorId: string, url: string, name: string, category: ItemCategory) => Promise<string | null>;
  realtimeUpsertClosetItem: (item: ClothingItem) => void;
  realtimeRemoveClosetItem: (itemId: string) => void;
}

// --- Supabase row shapes (snake_case). Only the columns this store reads are
// listed; replaces `any` in the row mappers. Not generated — keep in sync with
// the DB if columns are renamed (or switch to `supabase gen types`). ---
interface CreatorItemRow {
  id: string;
  creator_id?: string;
  category: ItemCategory;
  name: string;
  price: string;
  url: string;
  photo_url?: string | null;
  original_photo_url?: string | null;
  cutout_photo_url?: string | null;
  candidate_photo_urls?: string[] | null;
  candidate_cutout_urls?: (string | null)[] | null;
  brand?: string | null;
  alternates?: AlternateItem[] | null;
  primary_note?: string | null;
  archived?: boolean | null;
  created_at?: string;
  default_worn_size?: string | null;
  affiliate_url?: string | null;
  affiliate_provider?: string | null;
  affiliate_wrapped_at?: string | null;
  fetch_status?: ClothingItem['fetchStatus'];
  fetch_error?: string | null;
  fetch_started_at?: string | null;
  fetch_completed_at?: string | null;
  from_starter_pack?: boolean | null;
  trr_eligible?: boolean | null;
  // Legacy pre-jsonb alternate_* columns (kept for backward-compat reads).
  alternate_link?: string | null;
  alternate_brand?: string | null;
  alternate_category?: string | null;
  alternate_label?: string | null;
  alternate_name?: string | null;
  alternate_photo_url?: string | null;
  alternate_price?: string | null;
}

interface LookItemJoinRow {
  id: string;
  sort_order?: number | null;
  worn_size?: string | null;
  creator_items?: CreatorItemRow | null;
}

export interface LooksRow {
  id: string;
  title?: string;
  cover_photo_url: string;
  layout: Look['layout'];
  caption: string;
  hashtags?: string[] | null;
  created_at: string;
  clicks?: number | null;
  creator_id?: string;
  category?: string | null;
  tags?: string[] | null;
  occasion?: string[] | null;
  season?: string[] | null;
  style_vibe?: string[] | null;
  color_palette?: string[] | null;
  clothing_type?: string[] | null;
  creator_tags?: string[] | null;
  archived?: boolean | null;
  short_code?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  collage_layout?: unknown; // jsonb — parsed by normalizeCollageLayout
  style_layout?: unknown; // jsonb — parsed by normalizeStyleLayout (Style-a-Look text blocks)
  likes_count?: number | null;
  views?: number | null;
  look_items?: LookItemJoinRow[] | null;
}

// Partial look_items row used when diffing joins during updateLook.
type ExistingLookItemJoin = {
  id: string;
  creator_item_id: string;
  sort_order: number | null;
  worn_size: string | null;
};

// Maps a creator_items DB row to a client ClothingItem (canonical closet item, no look join fields).
function rowToClothingItem(row: CreatorItemRow): ClothingItem {
  return itemRowToClothingItem(row, {});
}

export async function fetchClosetItems(creatorId: string): Promise<ClothingItem[]> {
  const { data, error } = await supabase
    .from('creator_items')
    .select('*')
    .eq('creator_id', creatorId)
    .eq('archived', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToClothingItem);
}

export async function fetchArchivedClosetItems(creatorId: string): Promise<ClothingItem[]> {
  const { data, error } = await supabase
    .from('creator_items')
    .select('*')
    .eq('creator_id', creatorId)
    .eq('archived', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToClothingItem);
}

export const LOOK_ITEMS_EMBED = 'look_items(id, sort_order, worn_size, creator_items(*))';

function mapItemPatchToDb(patch: Partial<ClothingItem>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('name' in patch) out.name = patch.name;
  if ('category' in patch) out.category = patch.category;
  if ('brand' in patch) out.brand = patch.brand ?? null;
  if ('price' in patch) out.price = patch.price;
  if ('link' in patch) out.url = patch.link;
  if ('photoUri' in patch) out.photo_url = patch.photoUri ?? null;
  if ('originalPhotoUri' in patch) out.original_photo_url = patch.originalPhotoUri ?? null;
  if ('cutout_photo_url' in patch) out.cutout_photo_url = patch.cutout_photo_url ?? null;
  if ('candidatePhotoUrls' in patch) out.candidate_photo_urls = patch.candidatePhotoUrls ?? null;
  if ('primaryNote' in patch) out.primary_note = patch.primaryNote ?? null;
  if ('archived' in patch) out.archived = patch.archived ?? false;
  if ('defaultWornSize' in patch) out.default_worn_size = patch.defaultWornSize ?? null;
  if ('fetchStatus' in patch) out.fetch_status = patch.fetchStatus ?? null;
  if ('fetchStartedAt' in patch) out.fetch_started_at = patch.fetchStartedAt ?? null;
  if ('fetchCompletedAt' in patch) out.fetch_completed_at = patch.fetchCompletedAt ?? null;
  if ('fetchError' in patch) out.fetch_error = patch.fetchError ?? null;
  return out;
}

const CATEGORY_EMOJI: Record<string, string> = {
  Top: '👕',
  Pants: '👖',
  Dress: '👗',
  Shoes: '👟',
  Bag: '👜',
  Jewelry: '💎',
  Accessory: '🧣',
  Outerwear: '🧥',
  Intimates: '🩲',
  Swimwear: '👙',
  Other: '🛍️',
};

function emojiForCategory(category: string): string {
  return CATEGORY_EMOJI[category] ?? '🛍️';
}

function itemRowToClothingItem(
  item: CreatorItemRow,
  joinFields: { lookItemId?: string; sortOrder?: number; wornSize?: string | null } = {}
): ClothingItem {
  // Read alternates from the new jsonb array column. If empty AND legacy
  // alternate_link is set (older row not yet backfilled or written by
  // an older client build), fall back to a one-element array built from
  // the legacy columns. This keeps backward compat through the transition.
  const alternates: AlternateItem[] = Array.isArray(item.alternates) ? [...item.alternates] : [];
  if (alternates.length === 0 && item.alternate_link) {
    alternates.push({
      brand: item.alternate_brand ?? null,
      category: item.alternate_category ?? null,
      label: item.alternate_label ?? null,
      link: item.alternate_link,
      name: item.alternate_name ?? null,
      photo_url: item.alternate_photo_url ?? null,
      price: item.alternate_price ?? null,
    });
  }
  return {
    id: item.id,
    lookItemId: joinFields.lookItemId,
    sortOrder: joinFields.sortOrder,
    wornSize: joinFields.wornSize ?? null,
    defaultWornSize: item.default_worn_size ?? null,
    category: item.category,
    name: item.name,
    price: item.price,
    link: item.url,
    emoji: emojiForCategory(item.category),
    photoUri: item.photo_url || undefined,
    originalPhotoUri: item.original_photo_url || undefined,
    cutout_photo_url: item.cutout_photo_url || undefined,
    candidatePhotoUrls: Array.isArray(item.candidate_photo_urls) ? item.candidate_photo_urls : undefined,
    candidateCutoutUrls: Array.isArray(item.candidate_cutout_urls) ? item.candidate_cutout_urls : undefined,
    brand: item.brand,
    alternates,
    primaryNote: item.primary_note || undefined,
    archived: item.archived ?? false,
    createdAt: item.created_at,
    fromStarterPack: item.from_starter_pack === true,
    trrEligible: item.trr_eligible === true,
    alternateLink: item.alternate_link || undefined,
    alternateLabel: item.alternate_label || undefined,
    affiliate_url: item.affiliate_url || undefined,
    affiliate_provider: item.affiliate_provider || undefined,
    affiliate_wrapped_at: item.affiliate_wrapped_at || undefined,
    fetchStatus: item.fetch_status ?? 'complete',
    fetchError: item.fetch_error ?? null,
    fetchStartedAt: item.fetch_started_at ?? null,
    fetchCompletedAt: item.fetch_completed_at ?? null,
  };
}

export function closetRowToItem(row: CreatorItemRow): ClothingItem {
  return itemRowToClothingItem(row, {});
}

// Pre-rotation Phase 2 saves stored items without `rotation`. Default missing
// values to 0 at the load boundary so consumers see a fully-typed shape.
function normalizeCollageLayout(raw: any): CollageLayout | null {
  if (!raw || !Array.isArray(raw.items)) return null;
  const overrides = raw.text_overrides ?? raw.textOverrides;
  const lookCover = raw.look_cover_photo_uri ?? raw.lookCoverPhotoUri;
  return {
    template: raw.template,
    background: typeof raw.background === 'string' ? raw.background : undefined,
    backgroundImage:
      typeof raw.backgroundImage === 'string'
        ? raw.backgroundImage
        : typeof raw.background_image === 'string'
          ? raw.background_image
          : undefined,
    backdropId:
      typeof raw.backdropId === 'string'
        ? raw.backdropId
        : typeof raw.backdrop_id === 'string'
          ? raw.backdrop_id
          : undefined,
    items: raw.items.map((it: any) => ({
      itemId: it.itemId,
      x: it.x,
      y: it.y,
      scale: it.scale,
      rotation: typeof it.rotation === 'number' ? it.rotation : 0,
      zIndex: it.zIndex,
    })),
    photos: Array.isArray(raw.photos) ? raw.photos.map((p: any) => ({
      id: p.id,
      url: p.url,
      x: p.x,
      y: p.y,
      scale: p.scale,
      rotation: typeof p.rotation === 'number' ? p.rotation : 0,
      zIndex: p.zIndex,
    })) : undefined,
    text: Array.isArray(raw.text) ? raw.text.map((t: any) => ({
      id: t.id,
      text: t.text,
      fontSize: t.fontSize,
      color: t.color,
      fontFamily: t.fontFamily,
      x: t.x,
      y: t.y,
      scale: t.scale,
      rotation: typeof t.rotation === 'number' ? t.rotation : 0,
      zIndex: t.zIndex,
      // Optional styling (Dupe Drop price chips, tracked labels, faded footers).
      // Must be carried through or the baked-in text loses its look on reopen.
      letterSpacing: typeof t.letterSpacing === 'number' ? t.letterSpacing : undefined,
      backgroundColor: typeof t.backgroundColor === 'string' ? t.backgroundColor : undefined,
      opacity: typeof t.opacity === 'number' ? t.opacity : undefined,
      // Per-item price-bubble binding survives reopen so each bubble re-attaches
      // to its item by itemId (verbatim); creator-overridden bubbles (binding
      // cleared on edit) persist as fixed text.
      priceForItemId: typeof t.priceForItemId === 'string' ? t.priceForItemId : undefined,
    })) : undefined,
    textOverrides: overrides && typeof overrides === 'object' ? { ...overrides } : undefined,
    lookCoverPhotoUri: typeof lookCover === 'string' ? lookCover : null,
  };
}

// jsonb -> StyleLayout. Tolerant of missing rotation (pre-rotation saves) and
// missing canvas dims (defaults to the canonical 1080×1440 portrait space).
// Returns null when there are no text blocks, so legacy looks load as "no text".
function normalizeStyleLayout(raw: any): StyleLayout | null {
  if (!raw || !Array.isArray(raw.text) || raw.text.length === 0) return null;
  const heroAspect = raw.heroAspectRatio ?? raw.hero_aspect_ratio;
  return {
    text: raw.text.map((t: any) => ({
      id: t.id,
      text: t.text,
      fontSize: t.fontSize,
      color: t.color,
      fontFamily: t.fontFamily,
      x: t.x,
      y: t.y,
      scale: typeof t.scale === 'number' ? t.scale : 1,
      rotation: typeof t.rotation === 'number' ? t.rotation : 0,
      zIndex: t.zIndex,
    })),
    heroAspectRatio: typeof heroAspect === 'number' ? heroAspect : undefined,
    canvasWidth: typeof raw.canvasWidth === 'number' ? raw.canvasWidth : 1080,
    canvasHeight: typeof raw.canvasHeight === 'number' ? raw.canvasHeight : 1440,
  };
}

// DB row -> Look (snake_case to camelCase). Expects look_items(id, sort_order, creator_items(*)) embed.
export function rowToLook(row: LooksRow): Look {
  const joins: LookItemJoinRow[] = Array.isArray(row.look_items) ? row.look_items : [];
  return {
    id: row.id,
    title: row.title,
    photoUri: row.cover_photo_url,
    layout: row.layout,
    caption: row.caption,
    hashtags: row.hashtags ?? [],
    createdAt: row.created_at,
    clicks: row.clicks ?? 0,
    views: row.views ?? 0,
    creatorId: row.creator_id,
    category: row.category ?? undefined,
    tags: row.tags ?? [],
    occasion: row.occasion ?? [],
    season: row.season ?? [],
    style_vibe: row.style_vibe ?? [],
    color_palette: row.color_palette ?? [],
    clothing_type: row.clothing_type ?? [],
    creator_tags: row.creator_tags ?? [],
    archived: row.archived ?? false,
    shortCode: row.short_code ?? undefined,
    publishedAt: row.published_at ?? null,
    updatedAt: row.updated_at ?? undefined,
    // NULL collage_layout = Phase 1 auto-template (not editable in builder).
    // Only Phase 2+ collage saves populate this column.
    collageLayout: normalizeCollageLayout(row.collage_layout),
    styleLayout: normalizeStyleLayout(row.style_layout),
    likesCount: row.likes_count ?? 0,
    items: joins
      .filter((li) => li.creator_items && !(li.creator_items.archived ?? false))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((li) =>
        itemRowToClothingItem(li.creator_items!, {
          lookItemId: li.id,
          sortOrder: li.sort_order ?? 0,
          wornSize: li.worn_size ?? null,
        })
      ),
  };
}

export async function uploadPhoto(localUri: string, bucket: string, path: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists) {
    throw new Error(`File no longer exists on device: ${localUri}. Please re-pick the photo and try again.`);
  }
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const arrayBuffer = base64Decode(base64);
  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    console.error(`[uploadPhoto] ${bucket}/${path} failed:`, error.message);
    throw error;
  }
  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (!signedError && signedData?.signedUrl) {
    return signedData.signedUrl;
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// Resolve a canonical creator_items row for this (creator, item) pair.
// - If an existing row matches by (creator_id, LOWER(TRIM(url))), update its metadata and return its id.
// - Otherwise insert a new row and return the new id.
// - On a 23505 unique-index race, re-look-up and return the winning row's id.
//
// Writes to the new `alternates` jsonb array. The legacy alternate_* columns
// are intentionally NOT written here — they stay frozen at whatever the last
// write was. They'll be dropped in a follow-up migration once on-device
// builds have rolled forward (see 20260428_convert_alternate_columns_to_jsonb_array.sql).
async function upsertCreatorItem(
  creatorId: string,
  item: ClothingItem,
  resolvedPhotoUrl: string | undefined,
  resolvedAlternates: AlternateItem[],
  // When true, an UPDATE to an already-owned row also bumps created_at to now,
  // so re-adding a piece resurfaces it to the top of the closet/picker (which
  // sort by created_at desc). Only the explicit user "add to closet" action
  // passes true — the look-publish resolve path leaves it false so publishing
  // never reshuffles the closet. NEVER move this into a DB trigger (a blanket
  // bump would reorder closets on every background write — cutout, re-wrap…).
  bumpRecency: boolean = false
): Promise<string | null> {
  const rawUrl = stripTrackingParams((item.canonicalUrl ?? item.link ?? '').trim());
  const payload: Record<string, unknown> = {
    creator_id: creatorId,
    category: item.category,
    name: item.name,
    price: item.price,
    url: rawUrl || item.link,
    photo_url: resolvedPhotoUrl ?? null,
    original_photo_url: item.originalPhotoUri ?? null,
    brand: item.brand ?? null,
    primary_note: item.primaryNote || null,
    archived: item.archived ?? false,
    alternates: resolvedAlternates.slice(0, MAX_ALTERNATES),
  };
  if (item.defaultWornSize !== undefined) {
    payload.default_worn_size = item.defaultWornSize ?? null;
  }
  if (item.fetchStatus !== undefined) {
    payload.fetch_status = item.fetchStatus;
  }

  const findByUrl = async (): Promise<string | null> => {
    if (!rawUrl) return null;
    const { data } = await withTransientRetry(() =>
      supabase
        .from('creator_items')
        .select('id, url')
        .eq('creator_id', creatorId)
        .ilike('url', rawUrl),
    );
    if (!data || data.length === 0) return null;
    const target = rawUrl.toLowerCase();
    const match = data.find((r: { id: string; url: string | null }) => (r.url ?? '').trim().toLowerCase() === target);
    return match?.id ?? data[0]?.id ?? null;
  };

  // A bumped copy of the payload for the re-add UPDATE path only — surfaces the
  // re-added piece to the top. Insert leaves created_at to the DB default.
  const updatePayload = bumpRecency
    ? { ...payload, created_at: new Date().toISOString() }
    : payload;

  // 1. Existing canonical?
  const existingId = await findByUrl();
  if (existingId) {
    const { error: updateError } = await withTransientRetry(() =>
      supabase.from('creator_items').update(updatePayload).eq('id', existingId),
    );
    if (updateError) {
      console.warn('upsertCreatorItem update error:', updateError);
    }
    return existingId;
  }

  // 2. Insert new canonical
  const { data: inserted, error: insertError } = await withTransientRetry(() =>
    supabase.from('creator_items').insert(payload).select('id').single(),
  );

  if (insertError) {
    if ((insertError as any).code === '23505') {
      const racedId = await findByUrl();
      if (racedId) {
        await supabase.from('creator_items').update(updatePayload).eq('id', racedId);
        return racedId;
      }
    }
    console.error('upsertCreatorItem insert error:', insertError);
    return null;
  }
  const newId = inserted?.id ?? null;
  if (newId && rawUrl) {
    supabase.functions.invoke('auto-tag-amazon', { body: { item_id: newId } })
      .catch((err) => console.warn('auto-tag-amazon failed (non-blocking):', err));
  }
  // Feature C: every new closet item gets a Photoroom cutout, not just Amazon.
  // The Edge Function handles its own concurrency + dedupe, so fire-and-forget
  // is safe even if scrape-product fires a parallel invocation.
  if (newId && resolvedPhotoUrl) {
    supabase.functions.invoke('cutout-item-photo', { body: { item_id: newId } })
      .catch((err) => console.warn('cutout-item-photo failed (non-blocking):', err));
  }
  return newId;
}

async function resolveItemPhotos(
  lookId: string,
  item: ClothingItem
): Promise<{ photoUrl: string | undefined; alternates: AlternateItem[] }> {
  let photoUrl: string | undefined = item.photoUri?.startsWith('http') ? item.photoUri : undefined;
  if (item.photoUri && !item.photoUri.startsWith('http')) {
    const itemPath = `items/${lookId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    photoUrl = await uploadPhoto(item.photoUri, 'item-photos', itemPath);
  }

  const sourceAlternates = (item.alternates ?? []).slice(0, MAX_ALTERNATES);
  const alternates: AlternateItem[] = [];
  for (let i = 0; i < sourceAlternates.length; i++) {
    const alt = sourceAlternates[i];
    let resolvedAltPhoto: string | null = null;
    if (alt.photo_url) {
      if (alt.photo_url.startsWith('http')) {
        resolvedAltPhoto = alt.photo_url;
      } else {
        try {
          const altPath = `items/${lookId}/alt-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          resolvedAltPhoto = await uploadPhoto(alt.photo_url, 'item-photos', altPath);
        } catch {
          resolvedAltPhoto = alt.photo_url;
        }
      }
    }
    alternates.push({ ...alt, photo_url: resolvedAltPhoto });
  }

  return { photoUrl, alternates };
}

type ResolvedLookItemJoin = { creator_item_id: string; sort_order: number; worn_size: string | null };

// Resolves each draft item to a canonical creator_items id (uploading photos +
// upserting as needed), then dedupes by canonical id (first occurrence wins,
// keeping the lowest sort_order). Shared by addLook and updateLook.
async function resolveLookItemJoins(
  creatorId: string,
  lookId: string,
  items: ClothingItem[]
): Promise<ResolvedLookItemJoin[]> {
  const resolved: { canonicalId: string; sortOrder: number; wornSize: string | null }[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const { photoUrl, alternates } = await resolveItemPhotos(lookId, item);
    const canonicalId = await upsertCreatorItem(creatorId, item, photoUrl, alternates);
    if (!canonicalId) continue;
    resolved.push({ canonicalId, sortOrder: idx, wornSize: item.wornSize ?? null });
  }
  const seen = new Set<string>();
  const deduped: ResolvedLookItemJoin[] = resolved
    .filter((r) => {
      if (seen.has(r.canonicalId)) return false;
      seen.add(r.canonicalId);
      return true;
    })
    .map((r) => ({ creator_item_id: r.canonicalId, sort_order: r.sortOrder, worn_size: r.wornSize }));
  if (resolved.length !== deduped.length) {
    console.warn('[resolveLookItemJoins] dropped duplicate canonical item(s)', {
      resolvedCount: resolved.length,
      dedupedCount: deduped.length,
    });
  }
  return deduped;
}

export const useLookStore = create<LookStore>()((set, get) => ({
  looks: [],
  archivedLooksByCreator: {},
  draftLooksByCreator: {},
  closetItems: [],
  archivedClosetItems: [],
  _hasHydrated: false,
  setHasHydrated: (v: boolean) => set({ _hasHydrated: v }),

  loadClosetItems: async (creatorId: string) => {
    try {
      const items = await fetchClosetItems(creatorId);
      set({ closetItems: items });
    } catch (e) {
      console.warn('loadClosetItems error:', e);
    }
  },

  loadArchivedClosetItems: async (creatorId: string) => {
    try {
      const items = await fetchArchivedClosetItems(creatorId);
      set({ archivedClosetItems: items });
    } catch (e) {
      console.warn('loadArchivedClosetItems error:', e);
    }
  },

  fetchLooks: async (options?: LookFetchOptions) => {
    const safety = setTimeout(() => {
      if (!get()._hasHydrated) {
        console.warn('fetchLooks: 8s safety timeout, flipping hydration');
        set({ _hasHydrated: true });
      }
    }, 8000);
    try {
      // Body-type filter is only applied to the non-archived public path.
      // archivedOnly and creator-own queries (handled elsewhere) intentionally skip it.
      const bodyTypeFilter = (options?.bodyTypeFilter ?? []).filter(Boolean);
      const useBodyTypeFilter =
        !options?.archivedOnly && bodyTypeFilter.length > 0;
      let creatorIdsForFilter: string[] | null = null;
      if (useBodyTypeFilter) {
        const { data: profileRows, error: profileError } = await supabase
          .from('creator_profiles_public')
          .select('creator_id')
          .overlaps('body_type_tags', bodyTypeFilter);
        if (profileError) throw profileError;
        creatorIdsForFilter = (profileRows ?? [])
          .map((r: { creator_id: string | null }) => r.creator_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (creatorIdsForFilter.length === 0) {
          set({ looks: [], _hasHydrated: true });
          return;
        }
      }

      let query = supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .not('published_at', 'is', null)
        .order('created_at', { ascending: false });
      if (options?.archivedOnly) {
        query = query.eq('archived', true);
      } else if (!options?.includeArchived) {
        query = query.eq('archived', false);
      }
      if (creatorIdsForFilter && creatorIdsForFilter.length > 0) {
        query = query.in('creator_id', creatorIdsForFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      const mapped = (data ?? []).map(rowToLook);
      set({ looks: mapped, _hasHydrated: true });
      const counts: Record<string, number> = {};
      mapped.forEach((l) => { counts[l.id] = l.likesCount ?? 0; });
      useLikeStore.getState().initCounts(counts);
    } catch (e) {
      console.warn('fetchLooks error:', e);
      set({ _hasHydrated: true });
    } finally {
      clearTimeout(safety);
    }
  },

  fetchLooksByCreator: async (creatorId: string, options?: LookFetchOptions) => {
    try {
      let query = supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false });
      if (options?.archivedOnly) {
        query = query.eq('archived', true);
      } else if (!options?.includeArchived) {
        query = query.eq('archived', false).not('published_at', 'is', null);
      }
      const { data, error } = await query;
      if (error) throw error;
      const mapped = (data ?? []).map(rowToLook);
      set({ looks: mapped, _hasHydrated: true });
      const counts: Record<string, number> = {};
      mapped.forEach((l) => { counts[l.id] = l.likesCount ?? 0; });
      useLikeStore.getState().initCounts(counts);
    } catch (e) {
      console.warn('fetchLooksByCreator error:', e);
      set({ _hasHydrated: true });
    }
  },

  fetchDraftLooksByCreator: async (creatorId: string) => {
    try {
      const { data, error } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('creator_id', creatorId)
        .eq('archived', false)
        .is('published_at', null)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const drafts = (data ?? []).map(rowToLook);
      set((state) => ({
        draftLooksByCreator: { ...state.draftLooksByCreator, [creatorId]: drafts },
      }));
    } catch (e) {
      console.warn('fetchDraftLooksByCreator error:', e);
    }
  },

  fetchLookById: async (lookId: string) => {
    // Single-row read. .maybeSingle() returns null on miss instead of erroring,
    // which is what collage-builder wants — a deleted/inaccessible look should
    // resolve to null cleanly so the stale-param redirect can run.
    try {
      const { data, error } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('id', lookId)
        .maybeSingle();
      if (error) {
        console.warn('fetchLookById error:', error.message);
        return null;
      }
      if (!data) return null;
      const look = rowToLook(data as LooksRow);

      // Hydrate the right slice so subsequent reads via Zustand selectors
      // resolve without an extra round-trip:
      //   - published (publishedAt is set) → upsert into `state.looks`
      //   - draft (publishedAt is null AND not archived) → upsert into
      //     `state.draftLooksByCreator[creator_id]`
      //   - archived → not hydrated (callers should use fetchArchivedLooksByCreator)
      if (look.archived) {
        // Don't hydrate archived rows into the active slices, but still
        // return the Look so a caller can render it if needed.
      } else if (look.publishedAt) {
        set((state) => {
          const idx = state.looks.findIndex((l) => l.id === look.id);
          if (idx >= 0) {
            const copy = state.looks.slice();
            copy[idx] = look;
            return { looks: copy };
          }
          return { looks: [look, ...state.looks] };
        });
        // Seed like store so the heart pill starts from the real count.
        useLikeStore.getState().initCounts({ [look.id]: look.likesCount ?? 0 });
      } else {
        // Draft. Hydrate under the look's own creator_id (which may be a
        // brand storefront's id when posting-as-brand). Caller can read
        // via `draftLooksByCreator[<creator_id>]`.
        const creatorIdKey = look.creatorId;
        if (creatorIdKey) {
          set((state) => {
            const list = state.draftLooksByCreator[creatorIdKey] ?? [];
            const idx = list.findIndex((l) => l.id === look.id);
            const next = idx >= 0
              ? list.slice().map((l, i) => (i === idx ? look : l))
              : [look, ...list];
            return {
              draftLooksByCreator: { ...state.draftLooksByCreator, [creatorIdKey]: next },
            };
          });
        }
      }
      return look;
    } catch (e) {
      console.warn('fetchLookById exception:', e);
      return null;
    }
  },

  fetchArchivedLooksByCreator: async (creatorId: string) => {
    try {
      const { data, error } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('creator_id', creatorId)
        .eq('archived', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const archived = (data ?? []).map(rowToLook);
      set((state) => ({
        archivedLooksByCreator: { ...state.archivedLooksByCreator, [creatorId]: archived },
      }));
    } catch (e) {
      console.warn('fetchArchivedLooksByCreator error:', e);
    }
  },

  addLook: async (look: Omit<Look, 'id' | 'createdAt' | 'clicks'>, opts?: { idempotencyKey?: string; asDraft?: boolean }) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('Supabase getUser error:', userError);
      return null;
    }
    if (!user) {
      console.error('addLook error: no authenticated user');
      return null;
    }

    const lockKey = opts?.idempotencyKey ?? user.id;
    if (inFlightPublishes.has(lockKey)) {
      console.warn('[addLook] publish already in flight for', lockKey, '— rejecting duplicate');
      throw new Error('publish_already_in_flight');
    }
    inFlightPublishes.add(lockKey);

    // Storefront context resolution:
    //   writeAs = the creator_id this look should belong to (storefront's id
    //             when posting as a brand, otherwise the human's auth uid).
    //   authoredBy = the human who actually built this look (always user.id),
    //                so per-stylist analytics stays correct even when
    //                creator_id is a brand.
    // The RLS policy on `looks` accepts the write when the signed-in user is
    // an active 'stylist' member of the brand whose creator_id we're writing
    // under. If contextStore is unhydrated for any reason we fall through to
    // user.id (writes as personal, which is the safe default).
    const writeAs = useContextStore.getState().getWriteAsCreatorId() ?? user.id;
    const authoredBy = user.id;

    try {

      // Ensure the user has a creators row (FK requirement). This is for the
      // HUMAN's creators row — the brand storefront's row was seeded once at
      // admin-time and never needs an upsert from the client.
      const { error: upsertError } = await withTransientRetry(() =>
        supabase
          .from('creators')
          .upsert(
            {
              id: user.id,
              email: user.email ?? '',
              name: user.user_metadata?.name ?? '',
            },
            { onConflict: 'id' }
          ),
      );
      if (upsertError) {
        console.error('Supabase creators upsert error:', upsertError);
        return null;
      }

      // 1. Upload cover photo
      let coverUrl: string;
      if (look.photoUri.startsWith('http')) {
        coverUrl = look.photoUri;
      } else {
        const coverPath = `covers/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        coverUrl = await uploadPhoto(look.photoUri, 'look-photos', coverPath);
      }

      // 2. Insert look row. When asDraft=true, force published_at to NULL.
      // Otherwise omit the column so the DB default (now()) fires.
      //
      // Use a client-generated stable id + UPSERT (not a plain insert) so the
      // write is idempotent: withTransientRetry may re-issue it after a lost ack
      // (PGRST002 reload), and onConflict:'id' makes the retry a no-op update of
      // the same row instead of creating a duplicate look. The in-flight lock
      // above only guards concurrent publishes in one JS runtime — it does not
      // cover the lost-ack case, so the stable id is what actually prevents dupes.
      const lookId = Crypto.randomUUID();
      const insertPayload: Record<string, unknown> = {
        id: lookId,
        creator_id: writeAs,         // brand storefront when posting as brand
        authored_by: authoredBy,     // always the human stylist
        title: look.title ?? look.caption ?? 'Untitled Look',
        cover_photo_url: coverUrl,
        layout: look.layout,
        caption: look.caption,
        hashtags: look.hashtags,
        category: look.category ?? null,
        tags: look.tags ?? [],
        collage_layout: look.collageLayout ?? null,
        style_layout: look.styleLayout ?? null,
      };
      if (opts?.asDraft) {
        insertPayload.published_at = null;
      }
      const { data: lookRow, error: lookError } = await withTransientRetry(() =>
        supabase
          .from('looks')
          .upsert(insertPayload, { onConflict: 'id' })
          .select()
          .single(),
      );
      if (lookError) {
        console.error('Supabase insert error:', lookError);
        throw lookError;
      }

      // 2b. Fire-and-forget AI auto-tagging (skip for drafts — runs again on publish)
      if (!opts?.asDraft) {
        supabase.functions.invoke('auto-tag-look', {
          body: { look_id: lookRow.id },
        }).catch((err) => console.warn('Auto-tag failed (non-blocking):', err));
      }

      // 3. Resolve items to canonical ids (deduped), then insert look_items joins.
      // Pass writeAs so new closet items created during this publish save under
      // the same creator_id as the look itself (brand mode → brand's closet).
      const desired = await resolveLookItemJoins(writeAs, lookRow.id, look.items);
      const joinPayloads = desired.map((d) => ({ look_id: lookRow.id, ...d }));

      if (joinPayloads.length > 0) {
        const { error: joinError } = await withTransientRetry(() =>
          supabase
            .from('look_items')
            .upsert(joinPayloads, { onConflict: 'look_id,creator_item_id', ignoreDuplicates: true }),
        );
        if (joinError) {
          const msg = (joinError as any).code === '23505'
            ? 'This look contains a duplicate item. Try removing duplicates and publishing again.'
            : `Could not publish your look. Error: ${joinError.message}`;
          console.error('Supabase look_items insert error:', joinError);
          throw new Error(msg);
        }
      }

      // 4. Re-fetch to get final shape with DB-generated join IDs
      const { data: refreshed } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('id', lookRow.id)
        .single();

      const newLook = refreshed
        ? rowToLook(refreshed)
        : {
            id: lookRow.id,
            title: lookRow.title,
            photoUri: coverUrl,
            layout: lookRow.layout,
            caption: lookRow.caption,
            hashtags: lookRow.hashtags ?? [],
            createdAt: lookRow.created_at,
            clicks: 0,
            creatorId: lookRow.creator_id,
            category: lookRow.category ?? undefined,
            tags: lookRow.tags ?? [],
            archived: lookRow.archived ?? false,
            collageLayout: lookRow.collage_layout ?? null,
            styleLayout: look.styleLayout ?? null,
            items: [],
          } as Look;

      // Drafts stay out of the public `looks` slice; they live in draftLooksByCreator.
      if (opts?.asDraft) {
        set(state => {
          const existing = state.draftLooksByCreator[user.id] ?? [];
          return {
            draftLooksByCreator: {
              ...state.draftLooksByCreator,
              [user.id]: [newLook, ...existing.filter(l => l.id !== newLook.id)],
            },
          };
        });
      } else {
        set(state => ({ looks: [newLook, ...state.looks] }));
      }
      return newLook;
    } catch (e) {
      console.error('addLook error:', e);
      throw e;
    } finally {
      inFlightPublishes.delete(lockKey);
    }
  },

  updateLook: async (updatedLook: Look) => {
    // Detect new-item add for auto-tag retrigger (fingerprint by name|brand|category)
    const previousLook =
      get().looks.find(l => l.id === updatedLook.id)
      ?? Object.values(get().draftLooksByCreator).flat().find(l => l.id === updatedLook.id);
    const fingerprint = (i: { name?: string; brand?: string | null; category: ItemCategory }): string | null => {
      const name = (i?.name ?? '').trim().toLowerCase();
      const brand = (i?.brand ?? '').trim().toLowerCase();
      const category = (i?.category ?? '').toString().trim().toLowerCase();
      if (!name && !brand) return null;
      return `${name}|${brand}|${category}`;
    };
    const prevKeys = new Set(
      (previousLook?.items ?? []).map(fingerprint).filter((k): k is string => !!k)
    );
    const newKeys = (updatedLook?.items ?? [])
      .map(fingerprint)
      .filter((k): k is string => !!k);
    const newItemWasAdded = newKeys.some(k => !prevKeys.has(k));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('updateLook: no authenticated user');
        throw new Error('Not signed in. Please sign back in and try again.');
      }

      // Resolve cover URL FIRST so we never write file:// into local state or DB.
      let coverUrl: string;
      if (updatedLook.photoUri.startsWith('http')) {
        coverUrl = updatedLook.photoUri;
      } else {
        const coverPath = `covers/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        try {
          coverUrl = await uploadPhoto(updatedLook.photoUri, 'look-photos', coverPath);
        } catch (uploadErr: any) {
          console.error('[updateLook] cover upload failed', uploadErr?.message ?? uploadErr);
          throw new Error(`Photo upload failed: ${uploadErr?.message ?? 'unknown error'}`);
        }
      }

      // Detect publish-from-draft and stay-as-draft transitions
      const wasDraft = previousLook?.publishedAt === null;
      const desiredAsDraft = updatedLook.publishedAt === null;
      const publishingFromDraft = wasDraft && !desiredAsDraft;

      // Optimistic local state update with resolved URL (not file://).
      // Drafts stay out of the public `looks` slice — they live in draftLooksByCreator.
      set(state => {
        const optimistic: Look = { ...updatedLook, photoUri: coverUrl };
        if (desiredAsDraft) {
          // Still a draft: keep out of looks, refresh draft entry under this creator.
          const creatorId = optimistic.creatorId;
          const nextDraftMap = { ...state.draftLooksByCreator };
          if (creatorId) {
            const arr = nextDraftMap[creatorId] ?? [];
            const filtered = arr.filter(l => l.id !== optimistic.id);
            nextDraftMap[creatorId] = [optimistic, ...filtered];
          }
          return {
            looks: state.looks.filter(l => l.id !== optimistic.id),
            draftLooksByCreator: nextDraftMap,
          };
        }
        // Published or publishing-from-draft: drop from any draft list, ensure presence in looks.
        const nextDraftMap: Record<string, Look[]> = {};
        for (const [cid, arr] of Object.entries(state.draftLooksByCreator)) {
          nextDraftMap[cid] = arr.filter(l => l.id !== optimistic.id);
        }
        const exists = state.looks.some(l => l.id === optimistic.id);
        return {
          looks: exists
            ? state.looks.map(l => (l.id === optimistic.id ? optimistic : l))
            : [optimistic, ...state.looks],
          draftLooksByCreator: nextDraftMap,
        };
      });

      const lookPatch: Record<string, unknown> = {
        title: updatedLook.title,
        cover_photo_url: coverUrl,
        layout: updatedLook.layout,
        caption: updatedLook.caption,
        hashtags: updatedLook.hashtags,
        category: updatedLook.category ?? null,
        tags: updatedLook.tags ?? [],
        collage_layout: updatedLook.collageLayout ?? null,
        style_layout: updatedLook.styleLayout ?? null,
      };
      if (publishingFromDraft) {
        lookPatch.published_at = updatedLook.publishedAt ?? new Date().toISOString();
      } else if (desiredAsDraft) {
        lookPatch.published_at = null;
      }
      const { error: lookUpdateError } = await withTransientRetry(() =>
        supabase.from('looks').update(lookPatch).eq('id', updatedLook.id),
      );
      if (lookUpdateError) {
        console.error('[updateLook] DB update failed', lookUpdateError);
        throw lookUpdateError;
      }

      // Re-run auto-tag when an item was added OR when publishing a draft for the first time.
      if (newItemWasAdded || publishingFromDraft) {
        supabase.functions.invoke('auto-tag-look', {
          body: { look_id: updatedLook.id },
        }).catch((err) => console.warn('Auto-tag failed (non-blocking):', err));
      }

      // 1. Resolve each desired item to a canonical id (upsert + upload), deduped.
      // Edits use the look's existing creator_id so items written under a brand
      // storefront stay in the brand's closet even if the editor is currently
      // in personal mode (e.g. opens an old draft after switching back).
      const editScopeCreatorId = updatedLook.creatorId ?? user.id;
      const desired = await resolveLookItemJoins(editScopeCreatorId, updatedLook.id, updatedLook.items);

      // 2. Diff against existing look_items rows for this look
      const { data: existingJoins, error: existingError } = await supabase
        .from('look_items')
        .select('id, creator_item_id, sort_order, worn_size')
        .eq('look_id', updatedLook.id);
      if (existingError) throw existingError;

      const desiredByCanonical = new Map(desired.map(d => [d.creator_item_id, d]));
      const existingByCanonical = new Map(
        (existingJoins ?? []).map((j: ExistingLookItemJoin) => [j.creator_item_id, j])
      );

      // 2a. Delete join rows whose canonical is no longer in the look
      const idsToDelete = (existingJoins ?? [])
        .filter((j: ExistingLookItemJoin) => !desiredByCanonical.has(j.creator_item_id))
        .map((j: ExistingLookItemJoin) => j.id);
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('look_items')
          .delete()
          .in('id', idsToDelete);
        if (deleteError) throw deleteError;
      }

      // 2b. Insert join rows for canonicals that weren't previously linked
      const inserts = desired
        .filter(d => !existingByCanonical.has(d.creator_item_id))
        .map(d => ({
          look_id: updatedLook.id,
          creator_item_id: d.creator_item_id,
          sort_order: d.sort_order,
          worn_size: d.worn_size,
        }));
      if (inserts.length > 0) {
        const { error: insertError } = await withTransientRetry(() =>
          supabase
            .from('look_items')
            .upsert(inserts, { onConflict: 'look_id,creator_item_id', ignoreDuplicates: true }),
        );
        if (insertError) throw insertError;
      }

      // 2c. Update sort_order or worn_size for common joins if either changed
      for (const d of desired) {
        const existing = existingByCanonical.get(d.creator_item_id) as any;
        if (!existing) continue;
        const sortChanged = existing.sort_order !== d.sort_order;
        const sizeChanged = (existing.worn_size ?? null) !== (d.worn_size ?? null);
        if (sortChanged || sizeChanged) {
          const patch: Record<string, unknown> = {};
          if (sortChanged) patch.sort_order = d.sort_order;
          if (sizeChanged) patch.worn_size = d.worn_size;
          const { error: orderError } = await supabase
            .from('look_items')
            .update(patch)
            .eq('id', existing.id);
          if (orderError) throw orderError;
        }
      }

      // 3. Re-fetch to get authoritative shape
      const { data: refreshed } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('id', updatedLook.id)
        .single();

      if (refreshed) {
        const refreshedLook = rowToLook(refreshed);
        set((state) => {
          const isDraft = refreshedLook.publishedAt === null;
          if (isDraft) {
            const creatorId = refreshedLook.creatorId;
            const nextDraftMap = { ...state.draftLooksByCreator };
            if (creatorId) {
              const arr = nextDraftMap[creatorId] ?? [];
              nextDraftMap[creatorId] = [
                refreshedLook,
                ...arr.filter((l) => l.id !== refreshedLook.id),
              ];
            }
            return {
              looks: state.looks.filter((l) => l.id !== refreshedLook.id),
              draftLooksByCreator: nextDraftMap,
            };
          }
          // Published — drop from drafts everywhere, refresh in looks.
          const nextDraftMap: Record<string, Look[]> = {};
          for (const [cid, arr] of Object.entries(state.draftLooksByCreator)) {
            nextDraftMap[cid] = arr.filter((l) => l.id !== refreshedLook.id);
          }
          const exists = state.looks.some((l) => l.id === refreshedLook.id);
          return {
            looks: exists
              ? state.looks.map((l) => (l.id === refreshedLook.id ? refreshedLook : l))
              : [refreshedLook, ...state.looks],
            draftLooksByCreator: nextDraftMap,
          };
        });
      }
    } catch (e) {
      console.warn('updateLook error:', e);
      throw e;
    }
  },

  deleteLook: async (id: string) => {
    // Snapshot for rollback — a failed DB delete must not leave the look
    // missing from the UI while it still exists server-side.
    const prevLooks = get().looks;
    const prevDraftMap = get().draftLooksByCreator;
    set(state => {
      const nextDraftMap: Record<string, Look[]> = {};
      for (const [cid, arr] of Object.entries(state.draftLooksByCreator)) {
        nextDraftMap[cid] = arr.filter(l => l.id !== id);
      }
      return {
        looks: state.looks.filter(l => l.id !== id),
        draftLooksByCreator: nextDraftMap,
      };
    });
    if (useDraftLookStore.getState().editingLookId === id) {
      useDraftLookStore.getState().clearDraft();
    }
    try {
      const { error } = await supabase.from('looks').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('deleteLook error — reverting optimistic removal:', e);
      set({ looks: prevLooks, draftLooksByCreator: prevDraftMap });
    }
  },

  archiveLook: async (id: string) => {
    const prev = get().looks;
    const prevArchivedMap = get().archivedLooksByCreator;
    const target = prev.find((l) => l.id === id);
    set((state) => {
      const next: Record<string, Look[]> = { ...state.archivedLooksByCreator };
      if (target?.creatorId) {
        const current = next[target.creatorId] ?? [];
        const archivedCopy: Look = { ...target, archived: true };
        next[target.creatorId] = [archivedCopy, ...current.filter((l) => l.id !== id)];
      }
      return {
        looks: state.looks.filter((l) => l.id !== id),
        archivedLooksByCreator: next,
      };
    });
    try {
      const { error } = await supabase.from('looks').update({ archived: true }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('archiveLook error:', e);
      set({ looks: prev, archivedLooksByCreator: prevArchivedMap });
    }
  },

  unarchiveLook: async (id: string) => {
    const prev = get().looks;
    const prevArchivedMap = get().archivedLooksByCreator;
    let target: Look | undefined;
    for (const arr of Object.values(prevArchivedMap)) {
      const hit = arr.find((l) => l.id === id);
      if (hit) { target = hit; break; }
    }
    set((state) => {
      const nextArchived: Record<string, Look[]> = {};
      for (const [cid, arr] of Object.entries(state.archivedLooksByCreator)) {
        nextArchived[cid] = arr.filter((l) => l.id !== id);
      }
      const restored: Look | null = target ? { ...target, archived: false } : null;
      const nextLooks = restored
        ? [restored, ...state.looks.filter((l) => l.id !== id)]
        : state.looks;
      return {
        looks: nextLooks,
        archivedLooksByCreator: nextArchived,
      };
    });
    try {
      const { error } = await supabase.from('looks').update({ archived: false }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('unarchiveLook error:', e);
      set({ looks: prev, archivedLooksByCreator: prevArchivedMap });
    }
  },

  // Canonical-item mutations. `itemId` is the creator_items.id. Updates/archives
  // propagate to every look that embeds this canonical item via look_items.
  updateItem: async (itemId: string, patch: Partial<ClothingItem>) => {
    const prevLooks = get().looks;
    const prevArchivedMap = get().archivedLooksByCreator;
    const prevCloset = get().closetItems;
    const prevArchivedCloset = get().archivedClosetItems;

    const applyPatch = (item: ClothingItem): ClothingItem => {
      const next: ClothingItem = { ...item, ...patch };
      if ('category' in patch && patch.category) {
        next.emoji = emojiForCategory(patch.category);
      }
      return next;
    };

    set((state) => {
      const nextLooks = state.looks.map((l) => ({
        ...l,
        items: l.items.map((it) => (it.id === itemId ? applyPatch(it) : it)),
      }));
      const nextArchived: Record<string, Look[]> = {};
      for (const [cid, arr] of Object.entries(state.archivedLooksByCreator)) {
        nextArchived[cid] = arr.map((l) => ({
          ...l,
          items: l.items.map((it) => (it.id === itemId ? applyPatch(it) : it)),
        }));
      }

      // Canonical closet arrays: handle move between active <-> archived when `archived` is being toggled.
      let nextCloset = state.closetItems;
      let nextArchivedCloset = state.archivedClosetItems;

      const inActive = state.closetItems.find((it) => it.id === itemId);
      const inArchived = state.archivedClosetItems.find((it) => it.id === itemId);

      if ('archived' in patch) {
        const becomingArchived = patch.archived === true;
        const source = inActive ?? inArchived;
        if (source) {
          const patched = applyPatch(source);
          if (becomingArchived) {
            nextCloset = state.closetItems.filter((it) => it.id !== itemId);
            nextArchivedCloset = [
              patched,
              ...state.archivedClosetItems.filter((it) => it.id !== itemId),
            ];
          } else {
            nextArchivedCloset = state.archivedClosetItems.filter((it) => it.id !== itemId);
            nextCloset = [
              patched,
              ...state.closetItems.filter((it) => it.id !== itemId),
            ];
          }
        }
      } else {
        // No archive toggle — update in place in whichever array holds it.
        if (inActive) {
          nextCloset = state.closetItems.map((it) => (it.id === itemId ? applyPatch(it) : it));
        }
        if (inArchived) {
          nextArchivedCloset = state.archivedClosetItems.map((it) =>
            it.id === itemId ? applyPatch(it) : it
          );
        }
      }

      return {
        looks: nextLooks,
        archivedLooksByCreator: nextArchived,
        closetItems: nextCloset,
        archivedClosetItems: nextArchivedCloset,
      };
    });

    try {
      const uploadedPatch: Partial<ClothingItem> = { ...patch };
      if (patch.photoUri && !patch.photoUri.startsWith('http')) {
        const path = `items/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        uploadedPatch.photoUri = await uploadPhoto(patch.photoUri, 'item-photos', path);
      }
      const dbPatch = mapItemPatchToDb(uploadedPatch);
      if ('link' in patch) {
        dbPatch.affiliate_url = null;
        dbPatch.affiliate_provider = null;
        dbPatch.affiliate_wrapped_at = null;
      }
      const { error } = await supabase.from('creator_items').update(dbPatch).eq('id', itemId);
      if (error) throw error;
      if ('link' in patch && patch.link) {
        supabase.functions.invoke('auto-tag-amazon', { body: { item_id: itemId } })
          .catch((err) => console.warn('auto-tag-amazon failed (non-blocking):', err));
      }
    } catch (e) {
      if (__DEV__) {
        console.log('[updateItem] failed for', itemId, 'patch:', patch, 'error:', e);
      }
      console.warn('updateItem error:', e);
      set({
        looks: prevLooks,
        archivedLooksByCreator: prevArchivedMap,
        closetItems: prevCloset,
        archivedClosetItems: prevArchivedCloset,
      });
    }
  },

  archiveItem: async (itemId: string) => {
    await get().updateItem(itemId, { archived: true });
  },

  unarchiveItem: async (itemId: string) => {
    await get().updateItem(itemId, { archived: false });
  },

  removeItemFromLook: async (lookId: string, itemId: string): Promise<number> => {
    const prevLooks = get().looks;
    set(state => ({
      looks: state.looks.map(l =>
        l.id === lookId ? { ...l, items: l.items.filter(i => i.id !== itemId) } : l
      ),
    }));
    try {
      const { error } = await supabase
        .from('look_items')
        .delete()
        .eq('look_id', lookId)
        .eq('creator_item_id', itemId);
      if (error) throw error;
    } catch (e) {
      console.warn('removeItemFromLook error:', e);
      set({ looks: prevLooks });
    }
    const remaining = get().looks.find(l => l.id === lookId)?.items.length ?? 0;
    return remaining;
  },

  getClosetItemUsage: async (itemId: string): Promise<{ usageCount: number }> => {
    const { data: refs } = await supabase
      .from('look_items')
      .select('look_id')
      .eq('creator_item_id', itemId);
    const usageCount = refs?.length ?? 0;
    return { usageCount };
  },

  isItemInPublishedLook: async (itemId: string): Promise<boolean> => {
    // Two cheap steps (avoids relying on an embed FK name): collect the looks
    // this item is in, then check whether any of them is published.
    try {
      const { data: refs, error: refErr } = await supabase
        .from('look_items')
        .select('look_id')
        .eq('creator_item_id', itemId);
      if (refErr) throw refErr;
      const lookIds = (refs ?? [])
        .map((r) => (r as { look_id: string | null }).look_id)
        .filter((id): id is string => !!id);
      if (lookIds.length === 0) return false;

      const { data: published, error: pubErr } = await supabase
        .from('looks')
        .select('id')
        .in('id', lookIds)
        .not('published_at', 'is', null)
        .limit(1);
      if (pubErr) throw pubErr;
      return (published?.length ?? 0) > 0;
    } catch (e) {
      // Fail open: never block an eligible creator because of a query error.
      console.warn('[isItemInPublishedLook] query failed', e);
      return true;
    }
  },

  deleteItemPermanently: async (itemId: string): Promise<void> => {
    const affectedLookIds = get()
      .looks.filter((l) => (l.items ?? []).some((it) => it.id === itemId))
      .map((l) => l.id);

    const { error: liErr } = await supabase
      .from('look_items')
      .delete()
      .eq('creator_item_id', itemId);
    if (liErr) {
      console.error('[deleteItemPermanently] look_items delete failed', liErr);
      throw liErr;
    }

    const { error: ciErr } = await supabase
      .from('creator_items')
      .delete()
      .eq('id', itemId);
    if (ciErr) {
      console.error('[deleteItemPermanently] creator_items delete failed', ciErr);
      throw ciErr;
    }

    set((state) => {
      const archivedClosetItems = state.archivedClosetItems.filter((i) => i.id !== itemId);
      const closetItems = state.closetItems.filter((i) => i.id !== itemId);
      const looks = state.looks.map((look) => ({
        ...look,
        items: (look.items ?? []).filter((it) => it.id !== itemId),
      }));
      const archivedLooksByCreator: Record<string, Look[]> = {};
      for (const [cid, arr] of Object.entries(state.archivedLooksByCreator)) {
        archivedLooksByCreator[cid] = arr.map((look) => ({
          ...look,
          items: (look.items ?? []).filter((it) => it.id !== itemId),
        }));
      }
      return { archivedClosetItems, closetItems, looks, archivedLooksByCreator };
    });

    for (const lookId of affectedLookIds) {
      supabase.functions
        .invoke('auto-tag-look', { body: { look_id: lookId } })
        .catch((err) => console.warn('Auto-tag failed (non-blocking):', err));
    }
  },

  addItemToLook: async (lookId: string, itemId: string): Promise<'added' | 'already_in_look' | 'error'> => {
    try {
      const { data: existing } = await supabase
        .from('look_items')
        .select('id')
        .eq('look_id', lookId)
        .eq('creator_item_id', itemId)
        .limit(1);

      if (existing && existing.length > 0) return 'already_in_look';

      const { data: maxSort } = await supabase
        .from('look_items')
        .select('sort_order')
        .eq('look_id', lookId)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextOrder = ((maxSort?.[0]?.sort_order as number) ?? -1) + 1;

      // Pre-fill worn_size from creator's stored default for this canonical item
      const { data: itemRow } = await supabase
        .from('creator_items')
        .select('default_worn_size')
        .eq('id', itemId)
        .single();
      const seedSize = (itemRow as { default_worn_size?: string | null } | null)?.default_worn_size ?? null;

      const { error } = await supabase
        .from('look_items')
        .insert({ look_id: lookId, creator_item_id: itemId, sort_order: nextOrder, worn_size: seedSize });

      if (error) {
        console.warn('addItemToLook error:', error);
        return 'error';
      }

      supabase.functions.invoke('auto-tag-look', {
        body: { look_id: lookId },
      }).catch((err) => console.warn('Auto-tag failed (non-blocking):', err));

      const { data: refreshed } = await supabase
        .from('looks')
        .select(`*, ${LOOK_ITEMS_EMBED}`)
        .eq('id', lookId)
        .single();

      if (refreshed) {
        const refreshedLook = rowToLook(refreshed);
        set((state) => ({
          looks: state.looks.map(l => l.id === lookId ? refreshedLook : l),
        }));
      }

      return 'added';
    } catch (e) {
      console.warn('addItemToLook error:', e);
      return 'error';
    }
  },

  addStandaloneClosetItem: async (creatorId: string, item: ClothingItem): Promise<string | null> => {
    try {
      // Bug 1 fix: when the user picks a photo manually (no URL fetch), the
      // photoUri is a file:// URI from the picker. Earlier this just got
      // dropped (photoUrl = undefined) so DB landed with photo_url=NULL,
      // and pre-fix code paths sometimes wrote file:// verbatim. Now mirror
      // the look-flow's resolveItemPhotos: upload to Supabase Storage and
      // use the returned HTTPS URL. Same for alternates.
      let photoUrl: string | undefined = item.photoUri?.startsWith('http') ? item.photoUri : undefined;
      if (item.photoUri && !item.photoUri.startsWith('http')) {
        const itemPath = `closet/${creatorId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        photoUrl = await uploadPhoto(item.photoUri, 'item-photos', itemPath);
      }

      const sourceAlternates = (item.alternates ?? []).slice(0, MAX_ALTERNATES);
      const resolvedAlternates: AlternateItem[] = [];
      for (let i = 0; i < sourceAlternates.length; i++) {
        const alt = sourceAlternates[i];
        let resolvedAltPhoto: string | null = null;
        if (alt.photo_url) {
          if (alt.photo_url.startsWith('http')) {
            resolvedAltPhoto = alt.photo_url;
          } else {
            try {
              const altPath = `closet/${creatorId}/alt-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
              resolvedAltPhoto = await uploadPhoto(alt.photo_url, 'item-photos', altPath);
            } catch {
              resolvedAltPhoto = null;
            }
          }
        }
        resolvedAlternates.push({ ...alt, photo_url: resolvedAltPhoto });
      }

      // bumpRecency: this is the explicit "add to closet" action, so a re-add
      // of an already-owned piece should resurface it to the top.
      const id = await upsertCreatorItem(creatorId, item, photoUrl, resolvedAlternates, true);
      if (id) {
        const { data } = await supabase
          .from('creator_items')
          .select('*')
          .eq('id', id)
          .single();
        if (data) {
          const newItem = rowToClothingItem(data);
          set((state) => ({
            closetItems: [newItem, ...state.closetItems.filter(i => i.id !== id)],
          }));
        }
      }
      return id;
    } catch (e) {
      console.warn('addStandaloneClosetItem error:', e);
      return null;
    }
  },

  quickAddClosetItemPending: async (creatorId: string, url: string, name: string, category: ItemCategory): Promise<string | null> => {
    try {
      const cleanUrl = stripTrackingParams(url.trim());
      const { data, error } = await supabase
        .from('creator_items')
        .insert({
          creator_id: creatorId,
          url: cleanUrl || url,
          name,
          category,
          price: '',
          fetch_status: 'pending',
          archived: false,
          alternates: [],
        })
        .select('*')
        .single();
      if (error) {
        if ((error as any).code === '23505') {
          const { data: existing } = await supabase
            .from('creator_items')
            .select('*')
            .eq('creator_id', creatorId)
            .ilike('url', cleanUrl || url)
            .limit(1)
            .maybeSingle();
          if (existing) {
            // Re-add of an already-owned piece: bump created_at to now so it
            // resurfaces at the top of the closet/picker (both sort created_at
            // desc) instead of staying buried at its original add date.
            const nowIso = new Date().toISOString();
            await supabase
              .from('creator_items')
              .update({ fetch_status: 'pending', fetch_started_at: null, fetch_completed_at: null, fetch_error: null, created_at: nowIso })
              .eq('id', existing.id);
            // Prepend the bumped row locally (realtimeUpsert maps in place and
            // would keep its old position) so the move-to-top is immediate.
            const bumped = itemRowToClothingItem({ ...existing, created_at: nowIso }, {});
            set((state) => ({
              closetItems: [bumped, ...state.closetItems.filter((i) => i.id !== existing.id)],
              archivedClosetItems: state.archivedClosetItems.filter((i) => i.id !== existing.id),
            }));
            return existing.id;
          }
        }
        console.error('quickAddClosetItemPending error:', error);
        return null;
      }
      if (data) {
        get().realtimeUpsertClosetItem(itemRowToClothingItem(data, {}));
      }
      return data?.id ?? null;
    } catch (e) {
      console.warn('quickAddClosetItemPending error:', e);
      return null;
    }
  },

  realtimeUpsertClosetItem: (item: ClothingItem) => {
    set((state) => {
      const inActive = state.closetItems.some((i) => i.id === item.id);
      const inArchived = state.archivedClosetItems.some((i) => i.id === item.id);
      if (item.archived) {
        const nextCloset = state.closetItems.filter((i) => i.id !== item.id);
        const nextArchived = inArchived
          ? state.archivedClosetItems.map((i) => (i.id === item.id ? item : i))
          : [item, ...state.archivedClosetItems];
        return { closetItems: nextCloset, archivedClosetItems: nextArchived };
      } else {
        const nextArchived = state.archivedClosetItems.filter((i) => i.id !== item.id);
        const nextCloset = inActive
          ? state.closetItems.map((i) => (i.id === item.id ? item : i))
          : [item, ...state.closetItems];
        return { closetItems: nextCloset, archivedClosetItems: nextArchived };
      }
    });
  },

  realtimeRemoveClosetItem: (itemId: string) => {
    set((state) => ({
      closetItems: state.closetItems.filter((i) => i.id !== itemId),
      archivedClosetItems: state.archivedClosetItems.filter((i) => i.id !== itemId),
    }));
  },

  incrementClicks: async (lookId: string) => {
    // Optimistic local bump for instant UI feedback.
    set(state => ({
      looks: state.looks.map(l =>
        l.id === lookId ? { ...l, clicks: l.clicks + 1 } : l
      ),
    }));
    try {
      // Atomic server-side increment via RPC — avoids the lost-update race of a
      // client read-modify-write, and works for public/anon viewers.
      const { error } = await supabase.rpc('increment_look_clicks', { p_look_id: lookId });
      if (error) throw error;
    } catch (e) {
      console.warn('incrementClicks error:', e);
    }
  },
}));

export default useLookStore;

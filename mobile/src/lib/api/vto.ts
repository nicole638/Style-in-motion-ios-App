import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as base64Decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';

export interface VtoRender {
  render_id: string;
  output_url: string;
  look_id: string | null;
  selfie_url: string | null;
  garment_url: string | null;
  status: string;
  cached: boolean;
  created_at: string;
  saved_at: string | null;
}

export interface VtoRenderRequest {
  garment_url: string;
  selfie_url: string;
  look_id?: string;
}

export interface BgEditResponse {
  output_url: string;
  render_id: string;
  cached: boolean;
}

export interface VtoRenderResponse extends BgEditResponse {}

export interface Backdrop {
  id: string;
  name: string;
  category: string;
  thumbnail_url: string;
  image_url: string;
}

export class VtoError extends Error {
  code: 'daily_quota_exceeded' | 'photoroom_failed' | 'unauthorized' | 'unknown';
  status: number;
  constructor(code: VtoError['code'], status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readBytesAndHash(file: Blob | string): Promise<{ bytes: ArrayBuffer; hash: string }> {
  if (typeof file === 'string') {
    const base64 = await FileSystem.readAsStringAsync(file, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) throw new Error('Selfie is empty or unreadable');
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
    return { bytes: base64Decode(base64), hash };
  }
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]);
  const base64 = global.btoa ? global.btoa(binary) : Buffer.from(u8).toString('base64');
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  return { bytes: buf, hash };
}

export async function uploadSelfie(file: Blob | string): Promise<string> {
  return uploadToCutouts(file, 'selfies');
}

// Creator's "Use my photo" selfie for the Try-on Model sheet. Separate folder
// from shopper VTO selfies so we can prune/audit them independently.
export async function uploadTryOnSelfie(file: Blob | string): Promise<string> {
  return uploadToCutouts(file, 'try-on-selfies');
}

async function uploadToCutouts(file: Blob | string, folder: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new VtoError('unauthorized', 401, 'Not signed in');

  const { bytes, hash } = await readBytesAndHash(file);
  const path = `${folder}/${userId}/${hash}.jpg`;

  const { error } = await supabase.storage
    .from('cutouts')
    .upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Photo upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from('cutouts').getPublicUrl(path);
  return data.publicUrl;
}

// Manual creator override for an item's product photo. Uploads to the
// item-photos bucket (NOT cutouts) at item-photos/<creator_id>/<sha256>.jpg
// so the public look-photo CDN URL is content-addressed and cache-friendly.
export async function uploadItemPhoto(file: Blob | string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new VtoError('unauthorized', 401, 'Not signed in');

  const { bytes, hash } = await readBytesAndHash(file);
  const path = `${userId}/${hash}.jpg`;

  const { error } = await supabase.storage
    .from('item-photos')
    .upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Photo upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from('item-photos').getPublicUrl(path);
  return data.publicUrl;
}

export async function ensurePublicPhotoUrl(uri: string): Promise<string> {
  if (/^https?:\/\//i.test(uri)) return uri;
  return uploadToCutouts(uri, 'look-photos');
}

export async function requestVtoRender(req: VtoRenderRequest): Promise<VtoRenderResponse> {
  return callPhotoroomEdit({
    mode: 'vto',
    garment_url: req.garment_url,
    selfie_url: req.selfie_url,
    look_id: req.look_id,
  });
}

async function callPhotoroomEdit(payload: Record<string, unknown>): Promise<BgEditResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new VtoError('unauthorized', 401, 'Not signed in');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL is not configured');

  const res = await fetch(`${supabaseUrl}/functions/v1/photoroom-edit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }

  if (!res.ok) {
    if (res.status === 429) {
      throw new VtoError('daily_quota_exceeded', 429, body?.error ?? 'Daily quota reached');
    }
    if (res.status === 502) {
      throw new VtoError('photoroom_failed', 502, body?.error ?? 'Render failed');
    }
    throw new VtoError('unknown', res.status, body?.error ?? `Render failed (${res.status})`);
  }
  if (!body?.output_url || !body?.render_id) {
    throw new VtoError('unknown', res.status, 'Malformed render response');
  }
  return {
    output_url: body.output_url,
    render_id: body.render_id,
    cached: Boolean(body.cached),
  };
}

export async function requestRemoveBg(source_url: string): Promise<BgEditResponse> {
  return callPhotoroomEdit({ mode: 'remove_bg', source_url });
}

export async function requestSwapBg(source_url: string, backdrop_id: string): Promise<BgEditResponse> {
  return callPhotoroomEdit({ mode: 'swap_bg', source_url, backdrop_id });
}

export async function listBackdrops(): Promise<Backdrop[]> {
  const { data, error } = await supabase
    .from('creator_backdrops')
    .select('id, name, category, thumbnail_url, image_url')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.warn('[vto] listBackdrops error:', error.message);
    return [];
  }
  return (data ?? []) as Backdrop[];
}

export async function fetchRecentRenders(): Promise<VtoRender[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('vto_renders')
    .select('id, output_url, look_id, selfie_url, garment_url, status, created_at, saved_at')
    .eq('user_id', userId)
    .in('status', ['complete', 'cached'])
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.warn('[vto] fetchRecentRenders error:', error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    render_id: r.id,
    output_url: r.output_url,
    look_id: r.look_id ?? null,
    selfie_url: r.selfie_url ?? null,
    garment_url: r.garment_url ?? null,
    status: r.status,
    cached: r.status === 'cached',
    created_at: r.created_at,
    saved_at: r.saved_at ?? null,
  })) as VtoRender[];
}

export async function fetchSavedRenders(): Promise<VtoRender[]> {
  return fetchVtoRenders();
}

export async function fetchVtoRenders(): Promise<VtoRender[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('vto_renders')
    .select('id, output_url, look_id, selfie_url, garment_url, status, created_at, saved_at')
    .eq('user_id', userId)
    .not('saved_at', 'is', null)
    .order('saved_at', { ascending: false });

  if (error) {
    console.warn('[vto] fetchVtoRenders error:', error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    render_id: r.id,
    output_url: r.output_url,
    look_id: r.look_id ?? null,
    selfie_url: r.selfie_url ?? null,
    garment_url: r.garment_url ?? null,
    status: r.status,
    cached: r.status === 'cached',
    created_at: r.created_at,
    saved_at: r.saved_at ?? null,
  })) as VtoRender[];
}

export async function saveRender(renderId: string): Promise<void> {
  const { error } = await supabase
    .from('vto_renders')
    .update({ saved_at: new Date().toISOString() })
    .eq('id', renderId);
  if (error) throw new Error(`save_failed: ${error.message}`);
}

export async function unsaveRender(renderId: string): Promise<void> {
  const { error } = await supabase
    .from('vto_renders')
    .update({ saved_at: null })
    .eq('id', renderId);
  if (error) throw new Error(`unsave_failed: ${error.message}`);
}

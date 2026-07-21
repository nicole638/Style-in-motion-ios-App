import * as FileSystem from 'expo-file-system/legacy';

/**
 * Resolve any image URI (https, data:, file://, bare path) to a LOCAL file://
 * path in cacheDirectory, downloading when needed. Returns null on failure.
 *
 * Built for SDKs that require a local file (e.g. the TikTok OpenSDK wrapper
 * saves the file to the photo library itself to obtain a PHAsset — handing it
 * a remote https URL fails its save with "Failed to save media").
 *
 * Unlike savePhotoToLibrary (which this mirrors, and which stays untouched for
 * the Instagram flow), this helper does NOT touch the photo library and does
 * NOT delete the file — the caller owns cleanup after the SDK call resolves.
 * Callers can tell whether cleanup is theirs: a return value different from
 * the input means a temp file was created in cacheDirectory.
 */

const KNOWN_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif']);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/gif': 'gif',
};

function extFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    const lastDot = lastSegment.lastIndexOf('.');
    if (lastDot === -1) return null;
    const ext = lastSegment.slice(lastDot + 1).toLowerCase();
    if (!KNOWN_EXTS.has(ext)) return null;
    return ext === 'jpeg' ? 'jpg' : ext;
  } catch {
    return null;
  }
}

function extFromContentType(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  const raw = headers['Content-Type'] ?? headers['content-type'];
  if (!raw) return null;
  const main = raw.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[main] ?? null;
}

function randomBasename(ext: string): string {
  return `tt-share-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}

export async function downloadToCache(uri: string): Promise<string | null> {
  console.log('[downloadToCache] start', { uri: uri?.slice(0, 80) });

  if (!uri) {
    console.error('[downloadToCache] EMPTY_URI');
    return null;
  }

  // Already local — normalize bare paths to file:// and hand straight back.
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;

  // data:image/<subtype>;base64,<payload> — decode straight to disk.
  if (uri.startsWith('data:')) {
    const match = uri.match(/^data:image\/([\w+.-]+);base64,(.+)$/);
    if (!match) {
      console.error('[downloadToCache] DATA_URL_MALFORMED');
      return null;
    }
    const ext = MIME_TO_EXT[`image/${match[1].toLowerCase()}`] ?? 'jpg';
    const localPath = `${FileSystem.cacheDirectory}${randomBasename(ext)}`;
    try {
      await FileSystem.writeAsStringAsync(localPath, match[2], {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log('[downloadToCache] OK (data url)', { localPath });
      return localPath;
    } catch (err) {
      console.error('[downloadToCache] DATA_URL_WRITE_FAIL', err);
      return null;
    }
  }

  // Remote — download into cache, resolving the extension from the URL path
  // or, failing that, the response Content-Type (jpg fallback).
  const urlExt = extFromUrl(uri);
  const initialPath = `${FileSystem.cacheDirectory}${randomBasename(urlExt ?? 'tmp')}`;

  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await FileSystem.downloadAsync(uri, initialPath);
    console.log('[downloadToCache] download status', result.status);
  } catch (err) {
    console.error('[downloadToCache] DOWNLOAD_THREW', err);
    return null;
  }

  if (!result || result.status !== 200) {
    console.error('[downloadToCache] DOWNLOAD_HTTP_FAIL', result?.status);
    FileSystem.deleteAsync(initialPath, { idempotent: true }).catch(() => {});
    return null;
  }

  if (urlExt) return result.uri;

  const finalExt = extFromContentType(result.headers) ?? 'jpg';
  const finalPath = `${FileSystem.cacheDirectory}${randomBasename(finalExt)}`;
  try {
    await FileSystem.moveAsync({ from: result.uri, to: finalPath });
    console.log('[downloadToCache] OK', { finalPath });
    return finalPath;
  } catch (err) {
    console.warn('[downloadToCache] EXT_RENAME_FAILED keeping tmp uri', err);
    return result.uri;
  }
}

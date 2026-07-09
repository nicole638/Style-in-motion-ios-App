import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

/**
 * Save a photo to the device camera roll. iOS's MediaLibrary.saveToLibraryAsync()
 * requires a LOCAL file URI — passing a remote https URL silently no-ops.
 * This helper downloads remote URLs into a temp cache file first, then saves.
 *
 * Returns true on success, false on any failure. Logs detailed breadcrumbs at
 * each stage so failures can be diagnosed from device logs (TestFlight Xcode
 * console, etc.) instead of returning an opaque false.
 *
 * Defensively requests writeOnly permission internally — iOS 14+ has separate
 * read/write permission gates and saveToLibraryAsync silently fails if the
 * user only granted read access.
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

/**
 * Pull a known image extension from the URL's pathname. Drops query string
 * and hash by going through URL.pathname. Returns null if the URL doesn't
 * parse, has no extension after the last "/", or the extension isn't on the
 * allowlist (so e.g. "...?token=eyJ..." can't sneak through as ext "...").
 */
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

/** Pick the right ext from a Content-Type header value. Tolerates charset etc. */
function extFromContentType(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  const raw = headers['Content-Type'] ?? headers['content-type'];
  if (!raw) return null;
  const main = raw.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[main] ?? null;
}

function randomBasename(ext: string): string {
  return `share-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}

export async function savePhotoToLibrary(remoteUrl: string): Promise<boolean> {
  console.log('[savePhotoToLibrary] start', { url: remoteUrl?.slice(0, 80) });

  if (!remoteUrl) {
    console.error('[savePhotoToLibrary] EMPTY_URL');
    return false;
  }

  // iOS 14+ separates read/write permission. Request writeOnly so the user
  // sees "Add to Photos only" instead of full library access.
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      console.error('[savePhotoToLibrary] WRITE_PERMISSION_DENIED', status);
      return false;
    }
  } catch (err) {
    console.error('[savePhotoToLibrary] PERMISSION_THREW', err);
    return false;
  }

  if (remoteUrl.startsWith('file://') || remoteUrl.startsWith('/')) {
    const localUri = remoteUrl.startsWith('/') ? `file://${remoteUrl}` : remoteUrl;
    try {
      await MediaLibrary.saveToLibraryAsync(localUri);
      console.log('[savePhotoToLibrary] OK (local)');
      return true;
    } catch (err: any) {
      console.error('[savePhotoToLibrary] LOCAL_SAVE_FAIL', err?.message || err, err?.code);
      return false;
    }
  }

  // data:image/<subtype>;base64,<payload> — decode straight to disk; download
  // can't fetch a data URL.
  if (remoteUrl.startsWith('data:')) {
    const match = remoteUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/);
    if (!match) {
      console.error('[savePhotoToLibrary] DATA_URL_MALFORMED');
      return false;
    }
    const subtype = match[1].toLowerCase();
    const ext = MIME_TO_EXT[`image/${subtype}`] ?? 'jpg';
    const filename = randomBasename(ext);
    const localPath = `${FileSystem.cacheDirectory}${filename}`;
    console.log('[savePhotoToLibrary] resolved', { filename, ext, source: 'data-url' });
    try {
      await FileSystem.writeAsStringAsync(localPath, match[2], {
        encoding: FileSystem.EncodingType.Base64,
      });
      await MediaLibrary.saveToLibraryAsync(localPath);
      console.log('[savePhotoToLibrary] OK (data url)');
      FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
      return true;
    } catch (err: any) {
      console.error('[savePhotoToLibrary] DATA_URL_SAVE_FAIL', err?.message || err, err?.code);
      FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
      return false;
    }
  }

  // Resolve extension up front when the URL pathname tells us. Otherwise
  // download to a .tmp file and resolve from Content-Type after the response.
  const urlExt = extFromUrl(remoteUrl);
  const initialFilename = randomBasename(urlExt ?? 'tmp');
  const initialPath = `${FileSystem.cacheDirectory}${initialFilename}`;
  console.log('[savePhotoToLibrary] resolved', {
    filename: initialFilename,
    ext: urlExt,
    source: urlExt ? 'url-path' : 'pending-content-type',
  });

  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await FileSystem.downloadAsync(remoteUrl, initialPath);
    console.log('[savePhotoToLibrary] download status', result.status, 'uri', result.uri);
  } catch (err) {
    console.error('[savePhotoToLibrary] DOWNLOAD_THREW', err);
    return false;
  }

  if (!result || result.status !== 200) {
    console.error('[savePhotoToLibrary] DOWNLOAD_HTTP_FAIL', result?.status);
    return false;
  }

  let finalUri = result.uri;
  if (!urlExt) {
    const headerExt = extFromContentType(result.headers);
    const finalExt = headerExt ?? 'jpg';
    const finalFilename = randomBasename(finalExt);
    const finalPath = `${FileSystem.cacheDirectory}${finalFilename}`;
    try {
      await FileSystem.moveAsync({ from: result.uri, to: finalPath });
      finalUri = finalPath;
      console.log('[savePhotoToLibrary] resolved (post-download)', {
        filename: finalFilename,
        ext: finalExt,
        source: headerExt ? 'content-type' : 'jpg-fallback',
      });
    } catch (err) {
      console.warn('[savePhotoToLibrary] EXT_RENAME_FAILED keeping tmp uri', err);
    }
  }

  try {
    await MediaLibrary.saveToLibraryAsync(finalUri);
    console.log('[savePhotoToLibrary] OK', { uri: finalUri });
  } catch (err: any) {
    console.error('[savePhotoToLibrary] SAVE_THREW', err?.message || err, err?.code);
    FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
    return false;
  }

  FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
  return true;
}

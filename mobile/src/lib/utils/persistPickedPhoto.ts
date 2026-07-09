import * as FileSystem from 'expo-file-system/legacy';

const STABLE_DIR = `${FileSystem.documentDirectory}picked-photos/`;

export async function persistPickedPhoto(originalUri: string): Promise<string> {
  if (!originalUri || !originalUri.startsWith('file://')) return originalUri;
  try {
    await FileSystem.makeDirectoryAsync(STABLE_DIR, { intermediates: true });
  } catch {
    // ignore "already exists"
  }
  const ext = originalUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'].includes(ext) ? ext : 'jpg';
  const fileName = `pick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const dest = `${STABLE_DIR}${fileName}`;
  await FileSystem.copyAsync({ from: originalUri, to: dest });
  return dest;
}

/**
 * Best-effort cleanup of stable picks older than 30 days. Safe to
 * call on app launch; failures are ignored. Prevents Documents from
 * growing unbounded across versions.
 */
export async function pruneStalePickedPhotos(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(STABLE_DIR);
    const now = Date.now();
    await Promise.all(files.map(async (name) => {
      const path = `${STABLE_DIR}${name}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists || !('modificationTime' in info)) return;
      const ageMs = now - (info.modificationTime ?? 0) * 1000;
      if (ageMs > maxAgeMs) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    }));
  } catch {
    /* ignore */
  }
}

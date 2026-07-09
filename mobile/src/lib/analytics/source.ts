import { Platform } from 'react-native';

/**
 * Traffic-source tag stamped on every shop click (both the `/api/shop?source=`
 * query param and the client-written click_events row). Single source of truth
 * for the platform branch so Android traffic logs cleanly the moment it starts.
 *
 * iOS and web keep 'ios' (their long-standing value — zero behavior change);
 * Android emits 'android'. The backend already accepts and records this value
 * (see backend/src/routes/shop-redirect.ts), so no server change is needed.
 */
export const CLICK_SOURCE: 'ios' | 'android' =
  Platform.OS === 'android' ? 'android' : 'ios';

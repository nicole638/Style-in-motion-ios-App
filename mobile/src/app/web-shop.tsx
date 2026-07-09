import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { X, ChevronLeft, RotateCw, Plus, Check } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import useLookStore from '@/lib/state/lookStore';

/**
 * In-app brand browser (Closet capture, Feature 1 / Layer 1).
 *
 * Replaces the "Visit website" kick-out to Safari: the creator shops the
 * brand's real site inside the app, and a pinned "Add to Closet" button hands
 * the page's current URL to the EXISTING add-by-URL flow
 * (quickAddClosetItemPending → pending creator_items row → scrape-product +
 * lookup_catalog_product). No new scraper, no link-building here.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function WebShopScreen() {
  const params = useLocalSearchParams<{ url?: string; brand?: string }>();
  const initialUrl = typeof params.url === 'string' ? params.url : '';
  const brandLabel = typeof params.brand === 'string' ? params.brand : '';

  const insets = useSafeAreaInsets();
  const creatorId = useAuthStore((s) => s.creatorId);
  const quickAddClosetItemPending = useLookStore((s) => s.quickAddClosetItemPending);

  const webRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    setCurrentUrl(nav.url);
    setCanGoBack(nav.canGoBack);
  }, []);

  const handleClose = useCallback(() => {
    router.back();
  }, []);

  const handleBack = useCallback(() => {
    if (canGoBack) webRef.current?.goBack();
    else router.back();
  }, [canGoBack]);

  const handleAdd = useCallback(async () => {
    if (adding) return;
    const target = (currentUrl || initialUrl).trim();
    if (!target) return;
    if (!creatorId) {
      flashToast('Sign in as a creator to add items');
      return;
    }
    setAdding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Reuse the exact add-by-URL path: creates a pending creator_items row,
    // which triggers scrape-product + catalog/affiliate lookup server-side.
    const id = await quickAddClosetItemPending(creatorId, target, '', 'Other');
    setAdding(false);
    if (id) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      flashToast("Added — we're pulling in the details");
    } else {
      flashToast("Couldn't add that one — try again");
    }
  }, [adding, currentUrl, initialUrl, creatorId, quickAddClosetItemPending, flashToast]);

  if (!initialUrl) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.fallbackText}>No website to open.</Text>
        <Pressable
          onPress={handleClose}
          className="bg-[#B87063] rounded-full py-3 px-6 active:opacity-85 mt-3"
          testID="web-shop-close-fallback"
        >
          <Text className="text-white text-[15px]" style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}>
            Close
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.barWrap}>
        <View style={styles.bar}>
          <Pressable onPress={handleBack} hitSlop={8} style={styles.barBtn} testID="web-shop-back">
            <ChevronLeft size={24} color="#1A1210" strokeWidth={2.25} />
          </Pressable>
          <View style={styles.barTitleWrap}>
            <Text style={styles.barTitle} numberOfLines={1}>
              {brandLabel || hostOf(currentUrl)}
            </Text>
            <Text style={styles.barHost} numberOfLines={1}>
              {hostOf(currentUrl)}
            </Text>
          </View>
          <Pressable
            onPress={() => webRef.current?.reload()}
            hitSlop={8}
            style={styles.barBtn}
            testID="web-shop-reload"
          >
            <RotateCw size={19} color="#1A1210" strokeWidth={2} />
          </Pressable>
          <Pressable onPress={handleClose} hitSlop={8} style={styles.barBtn} testID="web-shop-close">
            <X size={22} color="#1A1210" strokeWidth={2.25} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* The brand's site */}
      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          source={{ uri: initialUrl }}
          onNavigationStateChange={onNavChange}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          allowsBackForwardNavigationGestures
          startInLoadingState
          decelerationRate="normal"
          testID="web-shop-webview"
        />
        {loading ? (
          <View style={styles.loadingBar} pointerEvents="none">
            <ActivityIndicator size="small" color="#B87063" />
          </View>
        ) : null}
      </View>

      {/* Floating Add to Closet */}
      <View style={[styles.fabWrap, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {toast ? (
          <View style={styles.toast} testID="web-shop-toast">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleAdd}
          disabled={adding}
          className="bg-[#B87063] rounded-full py-4 px-6 flex-row items-center justify-center active:opacity-85"
          style={{
            shadowColor: '#1A1210',
            shadowOpacity: 0.22,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 5,
            opacity: adding ? 0.7 : 1,
          }}
          testID="web-shop-add-to-closet"
        >
          {adding ? (
            <Check size={18} color="#FFFFFF" strokeWidth={2.5} />
          ) : (
            <Plus size={18} color="#FFFFFF" strokeWidth={2.5} />
          )}
          <Text
            className="ml-2 text-white text-[16px]"
            style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
          >
            {adding ? 'Adding…' : 'Add to Closet'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  barWrap: { backgroundColor: '#FFFFFF' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDE4DE',
  },
  barBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTitleWrap: { flex: 1, paddingHorizontal: 4 },
  barTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    fontWeight: '600',
  },
  barHost: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11.5,
    color: '#9B8B82',
  },
  webWrap: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingBar: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  toast: {
    backgroundColor: '#1A1210',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
    maxWidth: '100%',
  },
  toastText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13.5,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  fallbackText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#6B5E58',
  },
});

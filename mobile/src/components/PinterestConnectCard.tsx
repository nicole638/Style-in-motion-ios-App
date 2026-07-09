import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import useProfileStore from '@/lib/state/profileStore';

interface PinterestConnectCardProps {
  creatorId: string | null;
}

// HTTPS callback registered in the Pinterest app dashboard + embedded as
// redirect_uri inside the auth_url returned by `pinterest-oauth-init`. This
// is the URL Pinterest itself redirects the user-agent to after they approve
// scopes. Pinterest does NOT allow non-HTTPS schemes here, so this MUST stay
// https://. No trailing slash, no www.
const PINTEREST_HTTPS_CALLBACK = 'https://shop.styledinmotion.studio/api/pinterest/callback';

// Custom-scheme return URL that ASWebAuthenticationSession actually watches
// for. ASWebAuthenticationSession only auto-closes the auth sheet when the
// webview navigates to (a) a registered custom URL scheme OR (b) a Universal
// Link domain claimed via apple-app-site-association. Our app registers the
// "styledinmotion" scheme in app.json's `scheme` + iOS infoPlist.CFBundleURLTypes,
// but our applinks association is only on `app.styledinmotion.app` — NOT on
// `shop.styledinmotion.studio`. So an HTTPS callback URL gets rendered inside
// the sheet instead of intercepted. The callback page detects this case (no
// window.opener = iOS auth-session context) and does a JS redirect to this
// custom-scheme URL, which the system then intercepts to close the session.
const PINTEREST_RETURN_URL = 'styledinmotion://pinterest-callback';

type InlineMessage = { kind: 'info' | 'error'; text: string } | null;

export default function PinterestConnectCard({ creatorId }: PinterestConnectCardProps) {
  // Primitive selectors against the per-creator profile store. Source of truth =
  // creator_profiles.pinterest_enabled / pinterest_handle, surfaced via socials[].
  const enabled = useProfileStore((s) => {
    if (!creatorId) return false;
    const p = s.profiles[creatorId];
    if (!p) return false;
    return p.socials.find((x) => x.platform === 'Pinterest')?.enabled ?? false;
  });
  const handle = useProfileStore((s) => {
    if (!creatorId) return '';
    const p = s.profiles[creatorId];
    if (!p) return '';
    return p.socials.find((x) => x.platform === 'Pinterest')?.handle ?? '';
  });

  const [busy, setBusy] = useState<boolean>(false);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [message, setMessage] = useState<InlineMessage>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const insets = useSafeAreaInsets();

  const flashMessage = useCallback((next: InlineMessage) => {
    setMessage(next);
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
      messageTimer.current = null;
    }
    if (next) {
      messageTimer.current = setTimeout(() => {
        setMessage(null);
        messageTimer.current = null;
      }, 3000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (messageTimer.current) {
        clearTimeout(messageTimer.current);
        messageTimer.current = null;
      }
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (busy || !creatorId) return;
    setBusy(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // 1. Ask server for auth URL + CSRF state
      const { data: initData, error: initErr } = await supabase.functions.invoke(
        'pinterest-oauth-init',
        { body: {} },
      );
      console.log('[pinterest] init', {
        auth_url: initData?.auth_url,
        https_callback: PINTEREST_HTTPS_CALLBACK,
        return_url: PINTEREST_RETURN_URL,
      });
      if (initErr || !initData?.auth_url) {
        flashMessage({ kind: 'error', text: "Couldn't start Pinterest connection — try again." });
        return;
      }

      // 2. Open OAuth session — ASWebAuthenticationSession on iOS.
      // Watch the custom-scheme return URL: the HTTPS callback page below
      // redirects to it, ASWebAuthenticationSession intercepts and closes.
      //
      // DO NOT pass preferEphemeralSession here. An ephemeral session forces
      // Pinterest's embedded *login screen* on every connect — and that form's
      // "Log in" button stays greyed out when iOS autofills the credentials
      // (the page never sees the input events), which blocks sign-in entirely.
      // The default shared session reuses the Safari-signed-in Pinterest
      // account; to link a DIFFERENT account, sign into it in Safari first.
      const result = await WebBrowser.openAuthSessionAsync(
        initData.auth_url as string,
        PINTEREST_RETURN_URL,
      );
      console.log('[pinterest] session result', {
        type: result.type,
        url: 'url' in result ? result.url : null,
      });

      // 3. Handle non-success results
      if (result.type !== 'success' || !result.url) {
        if (result.type === 'cancel' || result.type === 'dismiss') {
          flashMessage({ kind: 'info', text: 'Pinterest connection canceled.' });
        } else {
          flashMessage({ kind: 'error', text: "Couldn't open Pinterest. Try again." });
        }
        return;
      }

      // 4. Parse callback URL — use Linking.parse for resilience to encoding quirks
      const parsed = Linking.parse(result.url);
      const params = (parsed.queryParams ?? {}) as Record<string, string | string[] | undefined>;
      const pickString = (v: string | string[] | undefined): string | null => {
        if (Array.isArray(v)) return v[0] ?? null;
        return v ?? null;
      };
      const code = pickString(params.code);
      const state = pickString(params.state);
      const oauthError = pickString(params.error);
      if (oauthError) {
        flashMessage({ kind: 'error', text: `Pinterest: ${oauthError}` });
        return;
      }
      if (!code || !state) {
        flashMessage({ kind: 'info', text: 'Pinterest connection canceled.' });
        return;
      }

      // 5. Exchange code with backend
      const { data: exchangeData, error: exchangeErr } = await supabase.functions.invoke(
        'pinterest-oauth-exchange',
        { body: { code, state } },
      );
      if (exchangeErr || !exchangeData?.ok) {
        flashMessage({ kind: 'error', text: "Couldn't finish connecting. Try again." });
        return;
      }

      // 6. Refetch profile so the card flips to Connected state
      await useProfileStore.getState().fetchProfile(creatorId);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const username = (exchangeData.pinterest_username as string | undefined) ?? '';
      flashMessage({
        kind: 'info',
        text: username ? `Connected as @${username}` : 'Pinterest connected.',
      });
    } catch (e) {
      console.warn('[PinterestConnectCard] connect failed:', e);
      flashMessage({ kind: 'error', text: "Couldn't finish connecting. Try again." });
    } finally {
      setBusy(false);
    }
  }, [busy, creatorId, flashMessage]);

  const handleDisconnect = useCallback(async () => {
    if (busy || !creatorId) return;
    setShowConfirm(false);
    setBusy(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { error } = await supabase.functions.invoke('pinterest-oauth-revoke', { body: {} });
      if (error) {
        flashMessage({ kind: 'error', text: "Couldn't disconnect — try again." });
        return;
      }
      await useProfileStore.getState().fetchProfile(creatorId);
      flashMessage({ kind: 'info', text: 'Pinterest disconnected.' });
    } catch (e) {
      console.warn('[PinterestConnectCard] disconnect failed:', e);
      flashMessage({ kind: 'error', text: "Couldn't disconnect — try again." });
    } finally {
      setBusy(false);
    }
  }, [busy, creatorId, flashMessage]);

  return (
    <View style={styles.card} testID="pinterest-connect-card">
      <View style={styles.row}>
        <Text style={styles.icon}>📌</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>
            {enabled ? 'Pinterest' : 'Connect Pinterest'}
          </Text>
          <Text style={styles.body}>
            {enabled
              ? `Connected as @${handle || 'your account'}`
              : 'Pin your looks straight from Styled in Motion. We never post on your behalf without asking.'}
          </Text>
        </View>
      </View>

      {enabled ? (
        <Pressable
          onPress={() => setShowConfirm(true)}
          disabled={busy}
          className="bg-white rounded-full py-3.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
          style={busy ? { opacity: 0.6 } : undefined}
          testID="pinterest-disconnect-button"
        >
          {busy ? (
            <ActivityIndicator size="small" color="#1A1210" />
          ) : (
            <Text
              className="text-[#1A1210] text-[15px] font-semibold"
              style={{ fontFamily: 'DMSans_500Medium' }}
            >
              Disconnect
            </Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          onPress={handleConnect}
          disabled={busy || !creatorId}
          className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
          style={[
            { shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
            (busy || !creatorId) ? { opacity: 0.6 } : null,
          ]}
          testID="pinterest-connect-button"
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              className="text-white text-[15px] font-semibold"
              style={{ fontFamily: 'DMSans_500Medium' }}
            >
              Connect Pinterest
            </Text>
          )}
        </Pressable>
      )}

      {message ? (
        <Text
          style={[
            styles.statusMessage,
            message.kind === 'error' ? styles.statusError : styles.statusInfo,
          ]}
          testID="pinterest-status-message"
        >
          {message.text}
        </Text>
      ) : null}

      <Modal
        visible={showConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirm(false)}
        testID="pinterest-disconnect-confirm-modal"
      >
        <View style={styles.confirmBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowConfirm(false)} />
          <View style={[styles.confirmSheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.confirmTitle}>Disconnect Pinterest?</Text>
            <Text style={styles.confirmBody}>You can reconnect any time.</Text>
            <View style={styles.confirmRow}>
              <Pressable
                onPress={() => setShowConfirm(false)}
                className="flex-1 bg-white rounded-full py-3.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                testID="pinterest-disconnect-cancel-button"
              >
                <Text
                  className="text-[#1A1210] text-[15px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleDisconnect}
                className="flex-1 bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                testID="pinterest-disconnect-confirm-button"
              >
                <Text
                  className="text-white text-[15px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Disconnect
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  icon: {
    fontSize: 22,
    lineHeight: 26,
  },
  heading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 19,
  },
  statusMessage: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  statusInfo: { color: '#2E7D52' },
  statusError: { color: '#B87063' },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  confirmSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  confirmTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    letterSpacing: 0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 18,
    textAlign: 'center',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 12,
  },
});

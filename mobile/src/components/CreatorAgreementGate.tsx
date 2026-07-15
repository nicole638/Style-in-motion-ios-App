import React, { useCallback } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, ExternalLink } from 'lucide-react-native';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import useAuthStore from '@/lib/state/authStore';
import { supabase } from '@/lib/supabase';

const CREATOR_AGREEMENT_URL = 'https://shop.styledinmotion.studio/creator-agreement';

interface AgreementStatus {
  is_creator: boolean;
  current_version: string | null;
  accepted: boolean;
}

/**
 * Blocking re-consent gate for the Creator Agreement.
 *
 * When the current agreement version (creator_agreement_versions.is_current) is
 * bumped, existing creators have not accepted the new terms — acceptance used to
 * be captured only as a one-time signup checkbox, so a version bump silently left
 * the whole creator base un-agreed. This gate closes that gap: on every launch it
 * asks the server whether the signed-in creator has accepted the CURRENT version,
 * and if not, shows a modal they must accept before continuing.
 *
 * Both the check and the accept run against auth.uid() server-side, so a creator
 * can only ever act on their own record. Shoppers and logged-out users are never
 * gated (the status RPC returns is_creator=false).
 *
 * Mounted once at the root, above the navigator.
 */
export function CreatorAgreementGate() {
  const insets = useSafeAreaInsets();
  const userType = useAuthStore((s) => s.userType);
  const creatorId = useAuthStore((s) => s.creatorId);
  const queryClient = useQueryClient();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const enabled = userType === 'creator' && !!creatorId;

  const { data, isLoading } = useQuery({
    queryKey: ['creator-agreement-status', creatorId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AgreementStatus> => {
      const { data, error } = await supabase.rpc('creator_agreement_status');
      if (error) throw error;
      // rpc returns a single-row table
      const row = Array.isArray(data) ? data[0] : data;
      return (row as AgreementStatus) ?? { is_creator: false, current_version: null, accepted: false };
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('accept_current_creator_agreement', { p_source: 'ios' });
      if (error) throw error;
    },
    onSuccess: async () => {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      await queryClient.invalidateQueries({ queryKey: ['creator-agreement-status', creatorId] });
    },
  });

  const openAgreement = useCallback(async () => {
    try { await Haptics.selectionAsync(); } catch {}
    try { await WebBrowser.openBrowserAsync(CREATOR_AGREEMENT_URL); } catch {}
  }, []);

  const handleAccept = useCallback(async () => {
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    acceptMutation.mutate();
  }, [acceptMutation]);

  // Only gate a creator who has definitively NOT accepted the current version.
  // While loading, or on any error/unknown, show nothing — never block on a
  // failed check (fail open, so a network blip can't lock a creator out).
  const mustAccept =
    enabled &&
    !isLoading &&
    data?.is_creator === true &&
    data?.accepted === false &&
    !!data?.current_version;

  if (!mustAccept || !fontsLoaded) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent testID="creator-agreement-gate">
      <View style={styles.backdrop}>
        <View style={[styles.card, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.iconWrap}>
            <FileText size={26} color="#B87063" strokeWidth={1.75} />
          </View>

          <Text style={styles.title}>We've updated our Creator Agreement</Text>
          <Text style={styles.body}>
            Before you keep styling and sharing, please review and accept the current Creator
            Agreement. It covers how you earn, how links are tracked, and how your closet is shared.
          </Text>

          <Pressable
            onPress={openAgreement}
            className="flex-row items-center justify-center gap-1.5 py-2.5 px-3 active:opacity-70"
            testID="agreement-gate-read"
          >
            <ExternalLink size={15} color="#B87063" />
            <Text style={styles.readLink}>Read the Creator Agreement</Text>
          </Pressable>

          {acceptMutation.isError ? (
            <Text style={styles.errorText}>
              Couldn't save that just now. Check your connection and try again.
            </Text>
          ) : null}

          <Pressable
            onPress={handleAccept}
            disabled={acceptMutation.isPending}
            className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
            style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, opacity: acceptMutation.isPending ? 0.7 : 1, marginTop: 8 }}
            testID="agreement-gate-accept"
          >
            {acceptMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                I Agree &amp; Continue
              </Text>
            )}
          </Pressable>

          <Text style={styles.fineprint}>
            By tapping "I Agree & Continue" you accept the current Creator Agreement.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,18,16,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FBF8F4',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 24,
    paddingTop: 26,
    gap: 10,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F3E7E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 27,
    lineHeight: 31,
    color: '#1A1210',
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: '#5A4F49',
  },
  readLink: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#B87063',
  },
  errorText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B4453A',
    marginTop: 2,
  },
  fineprint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#8A7F78',
    textAlign: 'center',
    marginTop: 10,
  },
});

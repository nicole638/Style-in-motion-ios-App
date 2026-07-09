import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { router } from 'expo-router';
import { User, BarChart3, Wallet, ChevronRight, Gift, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import useProfileStore from '@/lib/state/profileStore';
import useCreatorStore from '@/lib/state/creatorStore';
import FoundingCreatorPill from '@/components/FoundingCreatorPill';
import { InviteCreatorSheet } from '@/components/InviteCreatorSheet';
import CompleteProfileSheet from '@/components/CompleteProfileSheet';

type Row = {
  slug: string;
  label: string;
  helper: string;
  Icon: typeof User;
  onPress: () => void;
};

export default function MoreScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const isFoundingCreator = useProfileStore((s) => s.isFoundingCreator);
  const [inviteSheetOpen, setInviteSheetOpen] = useState<boolean>(false);
  const [completeProfileSheetOpen, setCompleteProfileSheetOpen] = useState<boolean>(false);

  // 8-section profile completion counter — drives the "N/8 sections filled"
  // subtitle on the Complete-your-profile row. Mirrors the field set used in
  // the sheet itself (photo, bio, IG, TT, Pi, location, any size, body
  // tags).
  const photoUri = useProfileStore((s) => s.photoUri);
  const bio = useProfileStore((s) => s.bio);
  const location = useProfileStore((s) => s.location);
  const topSize = useProfileStore((s) => s.topSize);
  const bottomSize = useProfileStore((s) => s.bottomSize);
  const dressSize = useProfileStore((s) => s.dressSize);
  const shoeSize = useProfileStore((s) => s.shoeSize);
  const braSize = useProfileStore((s) => s.braSize);
  const bodyTypeSelfTagsCount = useProfileStore((s) => s.bodyTypeSelfTags.length);
  const igHandle = useCreatorStore((s) => s.handles.find((h) => h.id === 'instagram')?.handle ?? '');
  const ttHandle = useCreatorStore((s) => s.handles.find((h) => h.id === 'tiktok')?.handle ?? '');
  const piHandle = useCreatorStore((s) => s.handles.find((h) => h.id === 'pinterest')?.handle ?? '');

  const completionCount = useMemo<number>(() => {
    let n = 0;
    if (photoUri && photoUri.length > 0) n += 1;
    if (bio && bio.trim().length > 0) n += 1;
    if (igHandle && igHandle.trim().length > 0) n += 1;
    if (ttHandle && ttHandle.trim().length > 0) n += 1;
    if (piHandle && piHandle.trim().length > 0) n += 1;
    if (location && location.trim().length > 0) n += 1;
    if (
      (topSize && topSize.length > 0) ||
      (bottomSize && bottomSize.length > 0) ||
      (dressSize && dressSize.length > 0) ||
      (shoeSize && shoeSize.length > 0) ||
      (braSize && braSize.length > 0)
    ) n += 1;
    if (bodyTypeSelfTagsCount > 0) n += 1;
    return n;
  }, [
    photoUri, bio, igHandle, ttHandle, piHandle, location,
    topSize, bottomSize, dressSize, shoeSize, braSize,
    bodyTypeSelfTagsCount,
  ]);
  const isComplete = completionCount === 8;

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const go = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(path as any);
  };

  const rows: Row[] = [
    {
      slug: 'profile',
      label: 'Profile',
      helper: 'Your details and payout',
      Icon: User,
      onPress: () => go('/creator-account'),
    },
    {
      slug: 'stats',
      label: 'Stats',
      helper: 'Clicks, sales, earnings',
      Icon: BarChart3,
      onPress: () => go('/creator-analytics'),
    },
    {
      slug: 'payouts',
      label: 'Payouts',
      helper: 'Connect your account',
      Icon: Wallet,
      onPress: () => go('/payments-payouts'),
    },
  ];

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: '#F7F4F0' }}
      edges={['top']}
      testID="more-screen"
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 140,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text
          style={{
            fontFamily: 'CormorantGaramond_600SemiBold',
            fontSize: 34,
            color: '#1A1210',
            letterSpacing: 0.5,
          }}
          testID="more-title"
        >
          More
        </Text>
        <Text
          style={{
            fontFamily: 'DMSans_400Regular',
            fontSize: 14,
            color: '#6B5E58',
            marginTop: 4,
            marginBottom: 24,
          }}
        >
          Profile, stats, and settings
        </Text>

        {/* Complete-your-profile row — opens the CompleteProfileSheet. Shows
            "N/8 sections filled" subtitle when incomplete; "Profile complete
            🖤" when all 8 sections have content. Manual-open ALWAYS shows the
            sheet, regardless of the AsyncStorage seen-key. */}
        <Pressable
          onPress={() => {
            if (isComplete) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setCompleteProfileSheetOpen(true);
          }}
          disabled={isComplete}
          testID="more-row-complete-profile"
          className="bg-white rounded-2xl border border-[#E8E0D8] active:opacity-85"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 16,
            paddingHorizontal: 16,
            marginBottom: 12,
            shadowColor: '#C4A882',
            shadowOpacity: 0.1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          }}
        >
          <View
            style={{
              width: 32,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={24} color="#B87063" strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1, marginHorizontal: 14 }}>
            <Text
              style={{
                fontFamily: 'DMSans_500Medium',
                fontSize: 16,
                color: isComplete ? '#B87063' : '#1A1210',
              }}
            >
              {isComplete ? 'Profile complete 🖤' : 'Complete your profile'}
            </Text>
            {!isComplete ? (
              <Text
                style={{
                  fontFamily: 'DMSans_400Regular',
                  fontSize: 13,
                  color: '#6B5E58',
                  marginTop: 2,
                }}
              >
                {completionCount}/8 sections filled
              </Text>
            ) : null}
          </View>
          {!isComplete ? <ChevronRight size={18} color="#9A8E88" strokeWidth={2} /> : null}
        </Pressable>

        {/* Rows */}
        {rows.map((row) => {
          const { Icon } = row;
          return (
            <Pressable
              key={row.slug}
              onPress={row.onPress}
              testID={`more-row-${row.slug}`}
              className="bg-white rounded-2xl border border-[#E8E0D8] active:opacity-85"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 16,
                paddingHorizontal: 16,
                marginBottom: 12,
                shadowColor: '#C4A882',
                shadowOpacity: 0.1,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 3 },
                elevation: 3,
              }}
            >
              <View
                style={{
                  width: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon size={24} color="#B87063" strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1, marginHorizontal: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text
                    style={{
                      fontFamily: 'DMSans_500Medium',
                      fontSize: 16,
                      color: '#1A1210',
                    }}
                  >
                    {row.label}
                  </Text>
                  {row.slug === 'profile' && isFoundingCreator ? (
                    <View style={{ marginLeft: 6 }}>
                      <FoundingCreatorPill testID="settings-profile-founding-pill" />
                    </View>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontFamily: 'DMSans_400Regular',
                    fontSize: 13,
                    color: '#6B5E58',
                    marginTop: 2,
                  }}
                >
                  {row.helper}
                </Text>
              </View>
              <ChevronRight size={18} color="#9A8E88" strokeWidth={2} />
            </Pressable>
          );
        })}

        {/* Invite-a-creator row — opens the InviteCreatorSheet (same sheet
            mounted from the Closet tab). Sits at the bottom of the More list
            so the primary profile/stats/payouts rows stay above-the-fold. */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setInviteSheetOpen(true);
          }}
          testID="more-row-invite-creator"
          className="bg-white rounded-2xl border border-[#E8E0D8] active:opacity-85"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            paddingVertical: 16,
            paddingHorizontal: 16,
            marginBottom: 12,
            shadowColor: '#C4A882',
            shadowOpacity: 0.1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          }}
        >
          <View
            style={{
              width: 32,
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 2,
            }}
          >
            <Gift size={24} color="#B87063" strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1, marginHorizontal: 14 }}>
            <Text
              style={{
                fontFamily: 'DMSans_500Medium',
                fontSize: 16,
                color: '#1A1210',
              }}
            >
              Invite a creator → unlock perks
            </Text>
            <Text
              style={{
                fontFamily: 'DMSans_400Regular',
                fontSize: 13,
                color: '#6B5E58',
                marginTop: 4,
                lineHeight: 18,
              }}
            >
              Refer a friend to Styled in Motion. When they publish 3 looks, you both get a multi-Reel spotlight on @styled.in.motion and priority access to paid brand partnerships.
            </Text>
          </View>
          <ChevronRight
            size={18}
            color="#9A8E88"
            strokeWidth={2}
            style={{ marginTop: 4 }}
          />
        </Pressable>
      </ScrollView>

      <InviteCreatorSheet
        visible={inviteSheetOpen}
        onClose={() => setInviteSheetOpen(false)}
        testIDPrefix="more-invite-creator-sheet"
      />

      <CompleteProfileSheet
        visible={completeProfileSheetOpen}
        onClose={() => setCompleteProfileSheetOpen(false)}
        triggerSource="manual"
        testIDPrefix="more-complete-profile-sheet"
      />
    </SafeAreaView>
  );
}

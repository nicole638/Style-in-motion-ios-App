import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { router } from 'expo-router';
import { ChevronRight, Sparkles, Heart } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

type Row = {
  slug: string;
  label: string;
  helper: string;
  Icon: typeof Sparkles;
  onPress: () => void;
};

export default function PublicMoreScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const go = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(path as any);
  };

  const rows: Row[] = [
    // App Store preflight: "Try On" is a "Coming Soon" placeholder (see
    // (public-tabs)/try-on.tsx) — commented out so the unfinished feature is
    // not reachable. Implement virtual try-on before publishing if you want it.
    // {
    //   slug: 'try-on',
    //   label: 'Try On',
    //   helper: 'Virtual try-on (coming soon)',
    //   Icon: Sparkles,
    //   onPress: () => go('/(public-tabs)/try-on'),
    // },
    {
      slug: 'saved',
      label: 'Saved',
      helper: 'Your saved items',
      Icon: Heart,
      onPress: () => go('/(public-tabs)/saved'),
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
          Your saved items
        </Text>

        {/* Rows */}
        {rows.map((row) => {
          const { Icon } = row;
          return (
            <Pressable
              key={row.slug}
              onPress={row.onPress}
              testID={`more-row-${row.slug}`}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}. ${row.helper}`}
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
                <Text
                  style={{
                    fontFamily: 'DMSans_500Medium',
                    fontSize: 16,
                    color: '#1A1210',
                  }}
                >
                  {row.label}
                </Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

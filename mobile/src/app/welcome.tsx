import React from 'react';
import { View, Text, Pressable, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import * as Haptics from 'expo-haptics';

const { width: SW, height: SH } = Dimensions.get('window');
const HERO_HEIGHT = SH * 0.68;
const PAD = 24;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F4F0' }} edges={['top', 'bottom']} testID="welcome-screen">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Hero image with gradient fade */}
      <View style={{ height: HERO_HEIGHT, width: SW }}>
        <Image
          source={{ uri: 'https://picsum.photos/seed/styledinmotion/800/1000' }}
          style={{ width: SW, height: HERO_HEIGHT }}
          contentFit="cover"
        />
        <LinearGradient
          colors={['transparent', '#F7F4F0']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: HERO_HEIGHT * 0.45 }}
        />
        <View style={{ position: 'absolute', bottom: 15, left: PAD, right: PAD, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, color: '#1A1210', textAlign: 'center', marginBottom: 6, width: '100%' }}>
            Styled in Motion
          </Text>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 16, color: '#3D3330', textAlign: 'center', width: '100%' }}>
            Looks you'll love. Shops that work.
          </Text>
        </View>
      </View>

      {/* Buttons */}
      <View style={{ paddingHorizontal: PAD, paddingTop: 32, backgroundColor: '#F7F4F0' }}>

        {/* Creator Login */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/creator-login'); }}
          testID="creator-path-button"
          style={{
            width: SW - PAD * 2,
            height: 52,
            backgroundColor: '#E8E4E0',
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 18, color: '#1A1210', fontWeight: '600', textAlign: 'center' }}>
            Creator Login
          </Text>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E58', marginTop: 1, textAlign: 'center' }}>
            Manage your looks & links
          </Text>
        </Pressable>

        {/* Gap */}
        <View style={{ height: 12 }} />

        {/* Shop Looks */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/public-signup'); }}
          testID="public-path-button"
          style={{
            width: SW - PAD * 2,
            height: 52,
            backgroundColor: '#E8E4E0',
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 18, color: '#1A1210', fontWeight: '600', textAlign: 'center' }}>
            Shop Looks
          </Text>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E58', marginTop: 1, textAlign: 'center' }}>
            Discover styles & shop the look
          </Text>
        </Pressable>

        {/* Footer */}
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#6B5E58', textAlign: 'center', marginTop: 16, marginBottom: insets.bottom + 8 }}>
          By continuing, you agree to our{' '}
          <Text
            onPress={() => router.push('/terms-of-service' as any)}
            style={{ color: '#B87063', textDecorationLine: 'underline' }}
            testID="terms-link-welcome"
          >
            Terms of Service
          </Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

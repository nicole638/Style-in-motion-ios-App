import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import useProfileStore from '@/lib/state/profileStore';
import FoundingCreatorBadge from '@/components/FoundingCreatorBadge';

export default function FoundingBadgeInfoScreen() {
  // Caller passes the badge subject's photo + initial via router params so
  // viewing another creator's badge shows THEIR photo, not the logged-in
  // user's. If params are missing (e.g., the modal is opened from a context
  // where the current user is the subject), fall back to the profile store.
  const params = useLocalSearchParams<{ photoUri?: string; firstInitial?: string }>();
  const myPhotoUri = useProfileStore((s) => s.photoUri);
  const myUsername = useProfileStore((s) => s.username);

  const photoUri = params.photoUri || myPhotoUri || null;
  const initialSource = params.firstInitial || myUsername || '';
  const initial = initialSource.charAt(0).toUpperCase() || 'F';

  return (
    <SafeAreaView style={s.root} testID="founding-badge-info-screen">
      <View style={s.headerRow}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          testID="founding-badge-info-close"
          style={({ pressed }) => [s.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <X size={22} color="#1A1210" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.heroWrap}>
          <FoundingCreatorBadge
            size="lg"
            photoUri={photoUri}
            firstInitial={initial}
            testID="founding-badge-hero"
          />
        </View>
        <Text style={s.title}>The Founding Creator's Badge</Text>
        <Text style={s.body}>
          Awarded to the first creators who shaped Styled in Motion. The badge is yours forever — it
          appears on your profile and next to your looks across the app.
        </Text>
        <Text style={s.body}>
          Founding Creators get higher commission rates, priority access to new features, and a
          permanent place in the platform's history.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F4F0' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 48,
    alignItems: 'center',
  },
  heroWrap: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: 400,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4A3F36',
    textAlign: 'center',
    marginBottom: 12,
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Sparkles } from 'lucide-react-native';

export default function TryOnTab() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="try-on-tab-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Try On</Text>
      </View>

      <View style={styles.center} testID="try-on-tab-coming-soon">
        <View style={styles.iconWrap}>
          <Sparkles size={36} color="#B87063" strokeWidth={1.6} />
        </View>
        <Text style={styles.bigText}>Coming Soon</Text>
        <Text style={styles.body}>
          Virtual try-on is almost here. We're putting the finishing touches on it — check back in a future update.
        </Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>In the works</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F0' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 30,
    color: '#1A1210',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 80,
    gap: 14,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FBF6EF',
    borderWidth: 1,
    borderColor: '#EDE6DF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  bigText: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 44,
    lineHeight: 48,
    color: '#1A1210',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#6B5E58',
    textAlign: 'center',
    maxWidth: 320,
  },
  pill: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#EDE6DF',
  },
  pillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
});

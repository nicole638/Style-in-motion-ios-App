import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft } from 'lucide-react-native';

type Section = { heading: string; body: string };

const SECTIONS: Section[] = [
  {
    heading: 'Welcome / Acceptance of Terms',
    body: 'By using Styled in Motion you agree to these terms. If you do not agree, do not use the app.',
  },
  {
    heading: 'Description of Service',
    body: 'Styled in Motion is a fashion discovery platform where creators curate shoppable looks and shoppers browse and purchase through affiliate links. We do not sell products directly.',
  },
  {
    heading: 'Account Registration',
    body: 'You must provide accurate information. You are responsible for maintaining the security of your account. You must be 13 years or older to use the app.',
  },
  {
    heading: 'Creator Content',
    body: 'Creators retain ownership of their photos and content. By posting, you grant Styled in Motion a non-exclusive license to display, distribute, and promote your content within the platform. You must have the rights to any content you upload.',
  },
  {
    heading: 'Shopping and Affiliate Links',
    body: 'Product links may be affiliate links. Styled in Motion earns commissions on qualifying purchases. Prices and availability are determined by third-party retailers, not by us. We are not responsible for product quality, shipping, or returns — those are handled by the respective retailer.',
  },
  {
    heading: 'Creator Affiliate Compliance (Amazon Creator Connections)',
    body: 'Creators participating in the Amazon Creator Connections program agree that: content must be independent and unbiased; no incentivized clicks (such as "click to win" or "click for free") are permitted; content must not mock or negatively portray Sponsored Products; no paid search advertising may drive traffic to look URLs; creators are responsible for brand-safety incidents arising from their content; creator profile, content, and Associates traffic data may be shared with Amazon and the brands you partner with; and creators agree to indemnify Styled in Motion for any breach of these rules. These provisions are subject to legal review and may be revised.',
  },
  {
    heading: 'User Conduct',
    body: 'You agree not to post harmful, illegal, or misleading content. We may remove content or suspend accounts that violate these terms.',
  },
  {
    heading: 'Intellectual Property',
    body: 'The Styled in Motion name, logo, and app design are our property. You may not copy or reproduce them without permission.',
  },
  {
    heading: 'Privacy',
    body: 'Your use of the app is also governed by our Privacy Policy. We collect data necessary to operate the service including account info, usage analytics, and content you create.',
  },
  {
    heading: 'Disclaimers',
    body: 'The service is provided as is without warranties. We do not guarantee uninterrupted or error-free service.',
  },
  {
    heading: 'Limitation of Liability',
    body: 'Styled in Motion is not liable for indirect, incidental, or consequential damages arising from your use of the service.',
  },
  {
    heading: 'Changes to Terms',
    body: 'We may update these terms at any time. Continued use of the app after changes constitutes acceptance.',
  },
  {
    heading: 'Contact',
    body: 'For questions about these terms, contact support@styledinmotion.app',
  },
];

export default function TermsOfServiceScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/welcome' as any);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="terms-of-service-screen">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          testID="terms-back-button"
        >
          <ChevronLeft size={24} color="#1A1210" strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.wordmark}>Styled in Motion</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="terms-scroll"
      >
        <Text style={styles.title}>Terms of Service</Text>
        <Text style={styles.effectiveDate}>Effective Date: April 17, 2026</Text>

        {SECTIONS.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}

        <View style={styles.divider} />

        <Text style={styles.footerNote}>
          These terms are also available at https://www.styledinmotion.app/terms.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6DF',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerSpacer: {
    width: 40,
  },
  wordmark: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 34,
    color: '#1A1210',
    marginBottom: 6,
  },
  effectiveDate: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginBottom: 28,
    letterSpacing: 0.3,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    marginBottom: 8,
  },
  sectionBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#1A1210',
    lineHeight: 23,
  },
  divider: {
    height: 1,
    backgroundColor: '#E8E0D8',
    marginTop: 8,
    marginBottom: 20,
  },
  footerNote: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 20,
  },
});

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
    heading: 'Introduction',
    body: 'This Privacy Policy describes how Styled in Motion ("we", "us", "our") collects, uses, and shares information about you when you use our mobile application. By using the app, you agree to the practices described here.',
  },
  {
    heading: 'Information We Collect',
    body: 'Account information: your name, email address, and (if provided) profile photo and location. Content you create: photos, look titles, tags, social handles, and product links. Usage data: screens viewed, looks liked or saved, follows, and interactions with shoppable items. Device data: basic device model and operating system information used to improve reliability.',
  },
  {
    heading: 'How We Use Information',
    body: 'We use the information we collect to operate and improve the app, personalize your experience, recommend looks and creators, communicate with you about your account, and protect the service and its users. We do not sell your personal information.',
  },
  {
    heading: 'Creator Content and Public Profiles',
    body: 'Photos, looks, and profiles published by creators are visible to other users of the app. Creators are responsible for ensuring they have the rights to content they upload. Please do not post content that contains personal information you are not comfortable sharing publicly.',
  },
  {
    heading: 'Shopping and Affiliate Links',
    body: 'When you tap a product link, you leave the app and visit a third-party retailer. Those retailers have their own privacy policies. Styled in Motion may earn affiliate commissions on qualifying purchases. We are not responsible for the privacy practices of third-party retailers.',
  },
  {
    heading: 'Creator Connections Data Sharing',
    body: 'If you participate as a creator in Amazon Creator Connections, we share your profile data, content data, and Associates traffic information with Amazon and the brands you partner with on the program. These provisions are subject to legal review and may be revised.',
  },
  {
    heading: 'Third-Party Services',
    body: 'We rely on vetted service providers (for example, cloud hosting, authentication, analytics, and email delivery) to operate the service. These providers process limited data on our behalf under contractual obligations of confidentiality and security.',
  },
  {
    heading: 'Data Storage and Security',
    body: 'Your data is stored on secure servers operated by our infrastructure providers. We use reasonable technical and organizational measures to protect it. No system is perfectly secure; please use a strong password and keep your device protected.',
  },
  {
    heading: 'Your Choices and Rights',
    body: 'You can edit your profile, update your preferences, and sign out at any time from within the app. You can also delete your account, which permanently removes your personal data and the content associated with it. Depending on where you live, you may have additional rights under applicable privacy laws — contact us to exercise them.',
  },
  {
    heading: 'Children',
    body: 'Styled in Motion is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with information, please contact us so we can remove it.',
  },
  {
    heading: 'Cookies and Similar Technologies',
    body: 'The mobile app does not use browser cookies. We use on-device storage to keep you signed in and remember your preferences. You can clear this data by signing out or deleting the app.',
  },
  {
    heading: 'International Users',
    body: 'If you use the app outside the country where our servers are located, your information may be transferred to and processed in that country. By using the app, you consent to such transfer.',
  },
  {
    heading: 'Marketing Communications',
    body: 'We may occasionally send you product updates or announcements by email. You can opt out of non-essential marketing emails at any time using the unsubscribe link.',
  },
  {
    heading: 'Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. When we make material changes, we will notify you in the app or by email. Continued use of the app after changes constitutes acceptance of the updated policy.',
  },
  {
    heading: 'Retention',
    body: 'We retain your information for as long as your account is active and as needed to provide the service. When you delete your account, we remove your personal data except where retention is required by law or for legitimate business purposes.',
  },
  {
    heading: 'Contact Us',
    body: 'For questions about this Privacy Policy or our data practices, contact us at support@styledinmotion.app.',
  },
];

export default function PrivacyPolicyScreen() {
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="privacy-policy-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          testID="privacy-back-button"
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
        testID="privacy-scroll"
      >
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.effectiveDate}>Effective Date: April 10, 2026</Text>

        {SECTIONS.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}

        <View style={styles.divider} />

        <Text style={styles.footerNote}>
          This policy is also available at https://www.styledinmotion.app/privacy.
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

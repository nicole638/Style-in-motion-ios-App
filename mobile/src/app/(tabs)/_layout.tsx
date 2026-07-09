import { useState, useEffect } from 'react';
import { Platform, View } from 'react-native';
import { withLayoutContext } from 'expo-router';
import { Tabs } from 'expo-router';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAndroidTabIcons } from '@/lib/hooks/useAndroidTabIcons';
import CreatorOnboarding from '@/components/CreatorOnboarding';
import RequiredUsernameSheet from '@/components/RequiredUsernameSheet';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore from '@/lib/state/profileStore';
import { supabase } from '@/lib/supabase';

let CreatorTabs: any;

try {
  const { createNativeBottomTabNavigator } = require('@bottom-tabs/react-navigation');
  const { Navigator } = createNativeBottomTabNavigator();
  CreatorTabs = withLayoutContext(Navigator);
} catch {
  CreatorTabs = null;
}

const isWeb = Platform.OS === 'web' || !CreatorTabs;

// Module-level: offer the golden path at most once per app session (resets
// on a cold start) so completing or skipping it never loops. A creator with no
// looks/collages is re-offered on the next cold start until they make one.
let goldenPathOfferedThisSession = false;

export default function TabLayout() {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [showRequiredUsername, setShowRequiredUsername] = useState<boolean>(false);
  const creatorId = useAuthStore((s) => s.creatorId);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  // Separation-rule-2: creator-vs-shopper routing keys on account_type, NOT
  // auth metadata / the mere presence of creatorId. A shopper has a creators
  // row (so creatorId is set) with account_type='shopper' — the creator-only
  // gates below MUST skip her, or she gets swept into creator onboarding and
  // (via the upgrade banner) her auth user_type can flip to 'creator'.
  const accountType = useAuthStore((s) => s.accountType);
  const isShopper = accountType === 'shopper';
  const username = useProfileStore((s) => s.username);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);

  // Android-only tab icons. The native bottom-tab navigator renders SF Symbols
  // on iOS (see below), but sfSymbol is meaningless on Android's
  // BottomNavigationView — it draws nothing. So on Android we rasterize the same
  // Ionicons glyphs the web tab bar uses into image sources and hand those to
  // the native tabs. iOS/web never touch this branch, so their icons are
  // unchanged. We gate the navigator on `androidIconsReady` so the bar renders
  // once with icon + label (no blank unselected tabs).
  const { icons: androidTabIcons, ready: androidIconsReady } = useAndroidTabIcons({
    index: 'home',
    create: 'add-circle',
    shop: 'bag',
    brands: 'sparkles',
    more: 'ellipsis-horizontal-circle',
  });

  // First-look gate. Any creator who has NOT yet created a look or collage is
  // routed into the golden path (welcome -> aesthetic -> seed -> pick ->
  // collage) on each fresh app session, regardless of how/when they signed up
  // or installed, until they've made something. Counts ALL looks (draft OR
  // published). The in-session guard offers it at most once per app run (so
  // completing/skipping never loops); a cold start re-offers if they still have
  // nothing. Welcome has a "Skip for now" exit so it is never a trap.
  useEffect(() => {
    if (!isLoggedIn || !creatorId) return;
    // Shoppers (account_type='shopper') are NEVER routed into creator
    // onboarding. They legitimately have a creatorId + zero looks, which is
    // exactly the golden-path trigger below — so we must bail before it fires.
    // Reaching /onboarding/welcome is what lets a shopper hit the upgrade
    // banner and flip her auth user_type to 'creator'. Gate on account_type.
    if (isShopper) return;
    if (goldenPathOfferedThisSession) return;
    let cancelled = false;
    (async () => {
      let lookCount = 0;
      try {
        const { count, error } = await supabase
          .from('looks')
          .select('id', { count: 'exact', head: true })
          .eq('creator_id', creatorId);
        if (error) return; // transient error - retry on next mount
        lookCount = count ?? 0;
      } catch {
        return;
      }
      if (cancelled) return;
      goldenPathOfferedThisSession = true; // offer at most once per app session
      if (lookCount === 0) {
        router.replace('/onboarding/welcome' as any);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, creatorId, isShopper]);

  // Legacy NULL-username gate. When a signed-in creator has no username,
  // force the required-username sheet so they can't keep using the app
  // (and especially can't publish a look) until they pick one.
  useEffect(() => {
    if (!isLoggedIn || !creatorId) {
      setShowRequiredUsername(false);
      return;
    }
    // Shoppers never get the required-username sheet — it's a creator-only
    // publish-gate. Gate on account_type, not just creatorId (separation-rule-2).
    if (isShopper) {
      setShowRequiredUsername(false);
      return;
    }
    let cancelled = false;
    (async () => {
      await fetchProfile(creatorId);
      if (cancelled) return;
      const fresh = useProfileStore.getState();
      const u = (fresh.username ?? '').trim();
      if (!u) {
        setShowRequiredUsername(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, creatorId, fetchProfile, isShopper]);

  // Hide the sheet as soon as a username appears in the store.
  useEffect(() => {
    if (username && username.trim()) {
      setShowRequiredUsername(false);
    }
  }, [username]);

  if (isWeb) {
    return (
      <>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: '#1A1210',
            tabBarInactiveTintColor: '#C4A882',
            tabBarStyle: {
              backgroundColor: '#FFFFFF',
              borderTopColor: '#E8E0D8',
              borderTopWidth: 1,
              height: 60,
              paddingBottom: 8,
              paddingTop: 8,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '500',
              letterSpacing: 0.2,
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Home',
              tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
              tabBarButtonTestID: 'tab-home',
            }}
          />
          <Tabs.Screen
            name="create"
            options={{
              title: 'Create',
              tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size} />,
              tabBarButtonTestID: 'tab-create',
            }}
          />
          <Tabs.Screen
            name="shop"
            options={{
              title: 'Studio',
              tabBarIcon: ({ color, size }) => <Ionicons name="bag" color={color} size={size} />,
              tabBarButtonTestID: 'tab-shop',
            }}
          />
          <Tabs.Screen
            name="brands"
            options={{
              title: 'Brands',
              tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} />,
              tabBarButtonTestID: 'tab-brands',
            }}
          />
          <Tabs.Screen
            name="more"
            options={{
              title: 'More',
              tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" color={color} size={size} />,
              tabBarButtonTestID: 'tab-more',
            }}
          />
        </Tabs>
        {showOnboarding ? (
          <CreatorOnboarding onComplete={() => setShowOnboarding(false)} />
        ) : null}
        <RequiredUsernameSheet
          visible={showRequiredUsername}
          onSaved={() => setShowRequiredUsername(false)}
        />
      </>
    );
  }

  // Android: hold the native bar until rasterized icons are ready so it renders
  // once with icon + label. iOS/web are ready immediately.
  if (!androidIconsReady) {
    return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} testID="creator-tabs-loading" />;
  }

  return (
    <>
      <CreatorTabs
        tabBarActiveTintColor="#1A1210"
        tabBarInactiveTintColor="#7D634A"
        labeled
        screenOptions={{}}
      >
        <CreatorTabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: () =>
              Platform.OS === 'android' ? androidTabIcons.index : ({ sfSymbol: 'house.fill' }),
            tabBarButtonTestID: 'tab-home',
          }}
        />
        <CreatorTabs.Screen
          name="create"
          options={{
            title: 'Create',
            tabBarIcon: () =>
              Platform.OS === 'android' ? androidTabIcons.create : ({ sfSymbol: 'plus.circle.fill' }),
            tabBarButtonTestID: 'tab-create',
          }}
        />
        <CreatorTabs.Screen
          name="shop"
          options={{
            title: 'Studio',
            tabBarIcon: () =>
              Platform.OS === 'android' ? androidTabIcons.shop : ({ sfSymbol: 'bag.fill' }),
            tabBarButtonTestID: 'tab-shop',
          }}
        />
        <CreatorTabs.Screen
          name="brands"
          options={{
            title: 'Brands',
            tabBarIcon: () =>
              Platform.OS === 'android' ? androidTabIcons.brands : ({ sfSymbol: 'sparkles' }),
            tabBarButtonTestID: 'tab-brands',
          }}
        />
        <CreatorTabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: () =>
              Platform.OS === 'android' ? androidTabIcons.more : ({ sfSymbol: 'ellipsis.circle.fill' }),
            tabBarButtonTestID: 'tab-more',
          }}
        />
      </CreatorTabs>
      {showOnboarding ? (
        <CreatorOnboarding onComplete={() => setShowOnboarding(false)} />
      ) : null}
    </>
  );
}

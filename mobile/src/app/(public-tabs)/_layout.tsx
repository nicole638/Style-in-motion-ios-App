import { Platform, View } from 'react-native';
import { withLayoutContext } from 'expo-router';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAndroidTabIcons } from '@/lib/hooks/useAndroidTabIcons';

let PublicTabs: any;

try {
  const { createNativeBottomTabNavigator } = require('@bottom-tabs/react-navigation');
  const { Navigator } = createNativeBottomTabNavigator();
  PublicTabs = withLayoutContext(Navigator);
} catch {
  PublicTabs = null;
}

const isWeb = Platform.OS === 'web' || !PublicTabs;

export default function PublicTabLayout() {
  // Android-only rasterized icons (iOS uses sfSymbol below; this is a no-op
  // there). Glyphs mirror the web tab bar so all platforms match.
  const { icons: androidTabIcons, ready: androidIconsReady } = useAndroidTabIcons({
    feed: 'home',
    search: 'search',
    brands: 'storefront-outline',
    closet: 'shirt-outline',
    more: 'ellipsis-horizontal',
  });

  if (isWeb) {
    return (
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#B87063',
          tabBarInactiveTintColor: '#A0938D',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#E8E0D8',
            height: 60,
          },
        }}
      >
        <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />, tabBarButtonTestID: 'tab-feed' }} />
        <Tabs.Screen name="search" options={{ title: 'Discover', tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} />, tabBarButtonTestID: 'tab-search' }} />
        <Tabs.Screen name="brands" options={{ title: 'Brands', tabBarIcon: ({ color, size }) => <Ionicons name="storefront-outline" color={color} size={size} />, tabBarButtonTestID: 'tab-brands' }} />
        <Tabs.Screen name="closet" options={{ title: 'Closet', tabBarIcon: ({ color, size }) => <Ionicons name="shirt-outline" color={color} size={size} />, tabBarButtonTestID: 'tab-closet' }} />
        <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={color} size={size} />, tabBarButtonTestID: 'tab-more' }} />
        {/* try-on and saved remain routable (reachable from the More screen)
            but are hidden from the tab bar via href: null. */}
        <Tabs.Screen name="try-on" options={{ href: null, tabBarButtonTestID: 'tab-try-on' }} />
        <Tabs.Screen name="saved" options={{ href: null, tabBarButtonTestID: 'tab-saved' }} />
      </Tabs>
    );
  }

  // Android: wait for the rasterized icons before mounting the native bar so it
  // renders once with icon + label (no blank unselected tabs). iOS is ready
  // immediately. Blank shell for the brief rasterization window.
  if (!androidIconsReady) {
    return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} testID="public-tabs-loading" />;
  }

  return (
    <PublicTabs
      tabBarActiveTintColor="#B87063"
      tabBarInactiveTintColor="#A0938D"
      labeled
      screenOptions={{}}
    >
      <PublicTabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: () => (Platform.OS === 'android' ? androidTabIcons.feed : { sfSymbol: 'house.fill' }), tabBarButtonTestID: 'tab-feed' }} />
      <PublicTabs.Screen name="search" options={{ title: 'Discover', tabBarIcon: () => (Platform.OS === 'android' ? androidTabIcons.search : { sfSymbol: 'magnifyingglass' }), tabBarButtonTestID: 'tab-search' }} />
      <PublicTabs.Screen name="brands" options={{ title: 'Brands', tabBarIcon: () => (Platform.OS === 'android' ? androidTabIcons.brands : { sfSymbol: 'storefront.fill' }), tabBarButtonTestID: 'tab-brands' }} />
      <PublicTabs.Screen name="closet" options={{ title: 'Closet', tabBarIcon: () => (Platform.OS === 'android' ? androidTabIcons.closet : { sfSymbol: 'tshirt.fill' }), tabBarButtonTestID: 'tab-closet' }} />
      <PublicTabs.Screen name="more" options={{ title: 'More', tabBarIcon: () => (Platform.OS === 'android' ? androidTabIcons.more : { sfSymbol: 'ellipsis' }), tabBarButtonTestID: 'tab-more' }} />
      {/* try-on and saved remain registered routes (reachable from the More
          screen via router.push) but are hidden from the native tab bar with
          tabBarItemHidden so we never trigger the native "More" overflow. */}
      <PublicTabs.Screen name="try-on" options={{ title: 'Try On', tabBarItemHidden: true, tabBarButtonTestID: 'tab-try-on' }} />
      <PublicTabs.Screen name="saved" options={{ title: 'Saved', tabBarItemHidden: true, tabBarButtonTestID: 'tab-saved' }} />
    </PublicTabs>
  );
}

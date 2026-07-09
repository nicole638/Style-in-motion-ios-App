import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayoutWeb() {
  return (
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
  );
}

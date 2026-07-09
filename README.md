# Styled in Motion

A two-sided iOS React Native Expo app for creator Kerri.

## Architecture

### Two Sides
- **Creator Side** (Kerri and future creators): Full dashboard with look creation, shop management, profile, and analytics
- **Public Audience Side**: Feed browsing, search, and saved looks

### Auth Flow
- Welcome screen → Creator Login (hardcoded credentials) or Public Signup/Login
- Auth state persisted in AsyncStorage via Zustand
- Root layout gates navigation based on auth state and user type

### Creator Tabs (`(tabs)/`)
- **Home** (`index.tsx`): Dashboard with stats (looks, clicks, items, likes), look grid with delete
- **Create** (`create.tsx`): 5-step wizard (photo → items → layout → caption → preview/share) with validation, discard confirmation, and success state
- **Shop** (`shop.tsx`): Look list with detail modal, item shop links with click tracking, copy link
- **Profile** (`profile.tsx`): Identity edit, connected platforms, settings, sign out

### Public Tabs (`(public-tabs)/`)
- **Feed** (`feed.tsx`): TikTok-style look cards with heart/share/shop actions
- **Search** (`search.tsx`): Category filters, 2-column grid
- **Saved** (`saved.tsx`): Liked looks collection

### State Management (Zustand + AsyncStorage)
- `authStore.ts`: Auth state, login/signup/logout, hydration tracking
- `lookStore.ts`: Looks CRUD, draft management, click tracking
- `likeStore.ts`: Like toggles, like counts (seeded random 40-300)
- `profileStore.ts`: Username, bio, photo
- `creatorStore.ts`: Platform handles, connected status

### Seed Data
- 6 pre-populated looks with items, captions, hashtags
- Auto-initialized on first launch when look store is empty

### Design
- Light theme: cream (#FAF8F5), dark (#1A1A1A), rose/tan accents
- Fonts: Cormorant Garamond (serif headings), DM Sans (body)
- StyleSheet.create for all styling

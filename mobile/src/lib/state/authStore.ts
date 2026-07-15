import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { isOldEnoughToSignUp } from '@/lib/age';
import useLikeStore from '@/lib/state/likeStore';
import useContextStore from '@/lib/state/contextStore';
import useFollowStore from '@/lib/state/followStore';
import useSavedItemsStore from '@/lib/state/savedItemsStore';
import useSavedLooksStore from '@/lib/state/savedLooksStore';
import useLookStore from '@/lib/state/lookStore';
import {
  mapSignupError,
  mapLoginError,
  type SignupOutcome,
  type LoginOutcome,
} from '@/lib/utils/mapAuthError';
import {
  ensureShareDeviceToken,
  revokeShareDeviceToken,
  clearLocalAndAppGroup,
} from '@/lib/share/deviceToken';

interface AuthState {
  userType: 'creator' | 'audience' | null;
  // Independent of userType. Shoppers are audience users (userType stays
  // 'audience' so route guards keep them in (public-tabs)) who have an opted-in
  // creators row with account_type='shopper' — this unlocks the reused closet /
  // collage surfaces. 'creator' is set for completeness on the creator branch.
  accountType: 'creator' | 'shopper' | null;
  isLoggedIn: boolean;
  creatorId: string | null;
  creatorName: string | null;
  publicUser: { name: string; email: string } | null;
  _hasHydrated: boolean;
  initialize: () => Promise<void>;
  // Create (or reuse) the currently-signed-in audience user's shopper closet:
  // an idempotent creators row tagged account_type='shopper'. Sets creatorId +
  // accountType WITHOUT changing userType, then hydrates the closet slice.
  ensureShopperCloset: () => Promise<{ success: boolean; creatorId?: string; error?: string }>;
  signupAsPublic: (firstName: string, lastName: string, email: string, password: string, birthDate: string) => Promise<'success' | 'invalid_name' | 'confirm_email' | 'underage' | SignupOutcome>;
  signupAsCreator: (firstName: string, lastName: string, email: string, password: string, birthDate: string) => Promise<'success' | 'invalid_name' | 'confirm_email' | 'underage' | SignupOutcome>;
  verifySignupOtp: (email: string, token: string) => Promise<'success' | 'invalid_code' | 'expired' | 'error'>;
  resendSignupOtp: (email: string) => Promise<boolean>;
  loginAsPublic: (email: string, password: string) => Promise<'success' | LoginOutcome>;
  login: (email: string, password: string) => Promise<'success' | LoginOutcome>;
  // Promote the currently-signed-in audience user to a creator. Carries
  // first/last name from audience_accounts (falling back to user_metadata)
  // so we never insert nulls into public.creators, updates the JWT's
  // user_type claim to 'creator', and refreshes the session so the in-app
  // token reflects the new claim immediately (otherwise route guards
  // bounce the user back to the audience surfaces).
  promoteToCreator: () => Promise<{ success: boolean; error?: string }>;
  // Revert a creator back to shopper mode — the MIRROR of promoteToCreator and
  // the ONLY other function allowed to write account_type / auth user_type.
  // Sets creators.account_type='shopper', flips the JWT user_type to 'audience',
  // and unpublishes ALL of the creator's looks (published_at=NULL) so shopper
  // looks stay private, then refreshes the session so route guards send the
  // user back to the shopper shell. Invoked exclusively from the explicit
  // "Switch to shopper mode" confirm in account-settings.
  revertToShopper: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
}

const useAuthStore = create<AuthState>()((set) => ({
  userType: null,
  accountType: null,
  isLoggedIn: false,
  creatorId: null,
  creatorName: null,
  publicUser: null,
  _hasHydrated: false,

  initialize: async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      // A stale/expired refresh token produces an AuthApiError here.
      // Sign out silently so the bad token is wiped from AsyncStorage.
      if (error) {
        await supabase.auth.signOut();
        set({ _hasHydrated: true });
        return;
      }
      if (session?.user) {
        const user = session.user;
        const userType = user.user_metadata?.user_type as 'creator' | 'audience' | undefined;
        const name = user.user_metadata?.name as string | undefined;
        if (userType === 'creator') {
          set({ isLoggedIn: true, userType: 'creator', accountType: 'creator', creatorId: user.id, creatorName: name ?? null, _hasHydrated: true });
          useLikeStore.getState().syncLikedIds(user.id).catch(() => {});
          useFollowStore.getState().hydrate(user.id).catch(() => {});
          useSavedItemsStore.getState().hydrate(user.id).catch(() => {});
          useSavedLooksStore.getState().hydrate(user.id).catch(() => {});
          // Hydrate storefront context: remembers the auth uid as the
          // "personal" id and prefetches any brand memberships the user has.
          // Default mode='personal' on every session — no last-context-used.
          useContextStore.getState().setPersonalCreatorId(user.id);
          useContextStore.getState().loadMemberships(user.id).catch(() => {});
        } else if (userType === 'audience') {
          set({ isLoggedIn: true, userType: 'audience', publicUser: { name: name ?? '', email: user.email ?? '' }, _hasHydrated: true });
          useLikeStore.getState().syncLikedIds(user.id).catch(() => {});
          useFollowStore.getState().hydrate(user.id).catch(() => {});
          useSavedItemsStore.getState().hydrate(user.id).catch(() => {});
          useSavedLooksStore.getState().hydrate(user.id).catch(() => {});
          // Lightweight shopper-closet probe: if this audience user has already
          // opted into a shopper closet (creators row account_type='shopper'),
          // wire creatorId + accountType so the reused closet/collage surfaces
          // work. userType stays 'audience' — route guards / creator hydration
          // are untouched. Non-fatal.
          try {
            const { data: shopperRow } = await supabase
              .from('creators')
              .select('id, account_type')
              .eq('id', user.id)
              .eq('account_type', 'shopper')
              .maybeSingle();
            if (shopperRow) {
              set({ creatorId: user.id, accountType: 'shopper' });
              useLookStore.getState().loadClosetItems(user.id).catch(() => {});
            }
          } catch (e) {
            console.warn('[auth] shopper-closet probe failed (non-fatal):', e);
          }
        } else {
          set({ _hasHydrated: true });
        }
      } else {
        set({ _hasHydrated: true });
      }
    } catch {
      // Any unexpected error (e.g. network offline) — sign out defensively
      // so a corrupted token doesn't leave the user stuck on a blank screen.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      set({ _hasHydrated: true });
    }
  },

  signupAsPublic: async (firstName, lastName, email, password, birthDate) => {
    try {
      // First name is required. Last name is optional (many creators are
      // mononyms — Latoya, Sylvia, Megan, Kerri, ReillyRose_Styles). Persist
      // an empty last name as NULL so DB triggers don't read "" as a value.
      const trimmedFirst = firstName.trim();
      const trimmedLast = lastName.trim();
      if (!trimmedFirst) {
        return 'invalid_name';
      }
      const lastOrNull: string | null = trimmedLast.length > 0 ? trimmedLast : null;
      const name = trimmedLast.length > 0 ? `${trimmedFirst} ${trimmedLast}` : trimmedFirst;
      // Age gate (16+). The signup screen already blocks under-16, but re-check
      // here so no caller can bypass it.
      if (!isOldEnoughToSignUp(birthDate)) {
        return 'underage';
      }
      const metadata = {
        name,
        first_name: trimmedFirst,
        last_name: lastOrNull,
        user_type: 'audience' as const,
        birth_date: birthDate,
        // Shopper Terms of Service acceptance — recorded server-side by the
        // signup trigger (writes terms_accepted_at/version/source to
        // audience_accounts). The shopper signup screen requires the acceptance
        // checkbox before enabling "Join Free", so reaching here means accepted.
        agreement_accepted: true,
        agreement_version: 'shopper-tos-v1' as const,
        agreement_source: 'ios' as const,
      };
      console.log('[auth] signupAsPublic invoked', {
        emailDomain: email.split('@')[1] ?? 'unknown'
      });
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          emailRedirectTo: 'styledinmotion://auth/confirm',
        },
      });
      if (error) {
        return mapSignupError(error);
      }
      if (data.user) {
        // If session is null, email confirmation is required — attempt sign-in anyway
        if (!data.session) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError || !signInData.session) {
            // Email confirmation is enabled and the user must confirm first
            return 'confirm_email';
          }
          await supabase.from('audience_accounts').insert({ id: data.user.id, email, name, first_name: trimmedFirst, last_name: lastOrNull, birth_date: birthDate });
          set({ isLoggedIn: true, userType: 'audience', publicUser: { name, email } });
          return 'success';
        }
        await supabase.from('audience_accounts').insert({ id: data.user.id, email, name, first_name: trimmedFirst, last_name: lastOrNull, birth_date: birthDate });
        set({ isLoggedIn: true, userType: 'audience', publicUser: { name, email } });
      }
      return 'success';
    } catch (e) {
      console.error('[auth] signupAsPublic exception:', e);
      return mapSignupError(e);
    }
  },

  signupAsCreator: async (firstName, lastName, email, password, birthDate) => {
    try {
      // First name is required; last name is optional (mononyms are common).
      const trimmedFirst = firstName.trim();
      const trimmedLast = lastName.trim();
      if (!trimmedFirst) {
        return 'invalid_name';
      }
      const lastOrNull: string | null = trimmedLast.length > 0 ? trimmedLast : null;
      const name = trimmedLast.length > 0 ? `${trimmedFirst} ${trimmedLast}` : trimmedFirst;
      // Age gate (16+). The signup screen already blocks under-16, but re-check
      // here so no caller can bypass it.
      if (!isOldEnoughToSignUp(birthDate)) {
        return 'underage';
      }
      const metadata = {
        name,
        first_name: trimmedFirst,
        last_name: lastOrNull,
        user_type: 'creator' as const,
        birth_date: birthDate,
        // Creator Agreement acceptance — recorded server-side by a Supabase
        // trigger that reads these signUp metadata fields. The mobile creator
        // signup screen requires the acceptance checkbox before enabling
        // "Create Account", so reaching this point means it was accepted.
        agreement_accepted: true,
        agreement_version: 'v1' as const,
        agreement_source: 'ios' as const,
      };
      console.log('[auth] signupAsCreator invoked', {
        emailDomain: email.split('@')[1] ?? 'unknown'
      });
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          emailRedirectTo: 'styledinmotion://auth/confirm',
        },
      });
      if (error) {
        console.error('[signupAsCreator] supabase error:', error.message, (error as any).status, JSON.stringify(error));
        return mapSignupError(error);
      }
      if (data.user) {
        // If session is null, email confirmation is required — attempt sign-in anyway
        if (!data.session) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError || !signInData.session) {
            // Email confirmation is enabled and the user must confirm first
            return 'confirm_email';
          }
          await supabase.from('creators').insert({ id: data.user.id, email, name, first_name: trimmedFirst, last_name: lastOrNull });
          await supabase.from('creator_profiles').insert({ creator_id: data.user.id, username: name, first_name: trimmedFirst, last_name: lastOrNull });
          set({ isLoggedIn: true, userType: 'creator', creatorId: data.user.id, creatorName: name });
          useContextStore.getState().setPersonalCreatorId(data.user.id);
          // Brand-new creator — no memberships expected, but a call is cheap
          // and keeps the membership-loading state consistent across flows.
          useContextStore.getState().loadMemberships(data.user.id).catch(() => {});
          return 'success';
        }
        await supabase.from('creators').insert({ id: data.user.id, email, name, first_name: trimmedFirst, last_name: lastOrNull });
        await supabase.from('creator_profiles').insert({ creator_id: data.user.id, username: name, first_name: trimmedFirst, last_name: lastOrNull });
        set({ isLoggedIn: true, userType: 'creator', creatorId: data.user.id, creatorName: name });
        useContextStore.getState().setPersonalCreatorId(data.user.id);
        useContextStore.getState().loadMemberships(data.user.id).catch(() => {});
        useLikeStore.getState().syncLikedIds(data.user.id).catch(() => {});
        useFollowStore.getState().hydrate(data.user.id).catch(() => {});
        useSavedItemsStore.getState().hydrate(data.user.id).catch(() => {});
        useSavedLooksStore.getState().hydrate(data.user.id).catch(() => {});
      }
      return 'success';
    } catch (e) {
      console.error('[auth] signupAsCreator exception:', e);
      return mapSignupError(e);
    }
  },

  verifySignupOtp: async (email, token) => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'signup' });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('expired')) return 'expired';
        if (msg.includes('invalid') || msg.includes('token')) return 'invalid_code';
        console.warn('[auth] verifySignupOtp error:', error.message);
        return 'error';
      }
      const u = data.user;
      if (!u || !data.session) return 'error';
      const md: any = u.user_metadata ?? {};
      const name: string = md.name ?? (md.first_name ?? '');
      const firstName: string = md.first_name ?? name;
      const lastName: string | null = md.last_name ?? null;

      // Route the OTP confirmation by the account's real type. Audience users
      // confirm through this same 6-digit signup code — they must land as
      // shoppers, NOT be bootstrapped into a creators row (separation rule 2:
      // route on account type, never infer "no creators row = new creator").
      const verifiedType = md.user_type as 'creator' | 'audience' | undefined;
      if (verifiedType === 'audience') {
        // The confirm_email signup path can't insert audience_accounts (no
        // session yet), so persist it here now that we're authenticated.
        try {
          await supabase.from('audience_accounts').upsert(
            { id: u.id, email: u.email ?? email.trim(), name, first_name: firstName, last_name: lastName },
            { onConflict: 'id' },
          );
        } catch (e) {
          console.warn('[auth] verifyOtp audience upsert failed', e);
        }
        set({ isLoggedIn: true, userType: 'audience', publicUser: { name, email: u.email ?? email.trim() } });
        useLikeStore.getState().syncLikedIds(u.id).catch(() => {});
        useFollowStore.getState().hydrate(u.id).catch(() => {});
        useSavedItemsStore.getState().hydrate(u.id).catch(() => {});
        useSavedLooksStore.getState().hydrate(u.id).catch(() => {});
        return 'success';
      }

      try {
        await supabase.from('creators').upsert(
          { id: u.id, email: u.email ?? email.trim(), name, first_name: firstName, last_name: lastName },
          { onConflict: 'id' },
        );
      } catch (e) {
        console.warn('[auth] verifyOtp creators upsert failed', e);
      }
      try {
        await supabase.from('creator_profiles').insert({ creator_id: u.id, username: name, first_name: firstName, last_name: lastName });
      } catch (e) {
        // profile row may already exist (retry) — ignore
      }
      set({ isLoggedIn: true, userType: 'creator', creatorId: u.id, creatorName: name });
      useContextStore.getState().setPersonalCreatorId(u.id);
      useContextStore.getState().loadMemberships(u.id).catch(() => {});
      useFollowStore.getState().hydrate(u.id).catch(() => {});
      useSavedItemsStore.getState().hydrate(u.id).catch(() => {});
      useSavedLooksStore.getState().hydrate(u.id).catch(() => {});
      return 'success';
    } catch (e) {
      console.error('[auth] verifySignupOtp exception:', e);
      return 'error';
    }
  },

  resendSignupOtp: async (email) => {
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
      if (error) {
        console.warn('[auth] resendSignupOtp error:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[auth] resendSignupOtp exception:', e);
      return false;
    }
  },

  loginAsPublic: async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return mapLoginError(error);
      }
      if (data.user) {
        const userType = data.user.user_metadata?.user_type;
        if (userType !== 'audience') return 'wrong_account_type';
        const name = data.user.user_metadata?.name ?? '';
        set({ isLoggedIn: true, userType: 'audience', publicUser: { name, email } });
        useLikeStore.getState().syncLikedIds(data.user.id).catch(() => {});
        useFollowStore.getState().hydrate(data.user.id).catch(() => {});
        useSavedItemsStore.getState().hydrate(data.user.id).catch(() => {});
        useSavedLooksStore.getState().hydrate(data.user.id).catch(() => {});
      }
      return 'success';
    } catch (e) {
      console.error('[auth] loginAsPublic exception:', e);
      return mapLoginError(e);
    }
  },

  login: async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return mapLoginError(error);
      }
      if (data.user) {
        const userType = data.user.user_metadata?.user_type;
        if (userType !== 'creator') return 'wrong_account_type';
        const name = data.user.user_metadata?.name ?? '';
        // Ensure creators row exists (handles accounts created before this fix)
        await supabase.from('creators').upsert(
          { id: data.user.id, email: data.user.email ?? '', name },
          { onConflict: 'id' }
        );
        set({ isLoggedIn: true, userType: 'creator', creatorId: data.user.id, creatorName: name });
        // Same hydration the initialize path does — keeps switcher and
        // RLS-aligned writes ready before the user reaches Home.
        useContextStore.getState().setPersonalCreatorId(data.user.id);
        useContextStore.getState().loadMemberships(data.user.id).catch(() => {});
        useFollowStore.getState().hydrate(data.user.id).catch(() => {});
        useSavedItemsStore.getState().hydrate(data.user.id).catch(() => {});
        useSavedLooksStore.getState().hydrate(data.user.id).catch(() => {});
      }
      return 'success';
    } catch (e) {
      console.error('[auth] login exception:', e);
      return mapLoginError(e);
    }
  },

  promoteToCreator: async () => {
    // SOLE WRITER of auth user_type='creator' (separation-rule). This is the
    // only function in the app that calls supabase.auth.updateUser to set
    // user_type, and it MUST only ever be invoked from the explicit upgrade
    // banner action (handleBecomeCreator in (tabs)/shop.tsx). There is NO
    // effect/auto-call path — do not wire this into a useEffect or hydration.
    //
    // Audience users who decide to become creators must NOT end up with a
    // creators row missing first_name (which is what produced the original
    // sign-in bounce loop) and their JWT must say user_type='creator' so the
    // route guards stop sending them back to the audience tabs.
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        return { success: false, error: 'No active session — please sign in again.' };
      }
      const user = session.user;

      // Pull first/last from audience_accounts first (source of truth that
      // we know was populated at signup); fall back to user_metadata.
      let firstName: string | null = null;
      let lastName: string | null = null;
      try {
        const { data: audience } = await supabase
          .from('audience_accounts')
          .select('first_name, last_name')
          .eq('id', user.id)
          .maybeSingle();
        if (audience) {
          const af = (audience as any).first_name as string | null | undefined;
          const al = (audience as any).last_name as string | null | undefined;
          if (af && af.trim()) firstName = af.trim();
          if (al && al.trim()) lastName = al.trim();
        }
      } catch (e) {
        console.warn('[promoteToCreator] audience_accounts lookup failed:', e);
      }
      if (!firstName) {
        const metaFirst = (user.user_metadata?.first_name as string | undefined)?.trim();
        if (metaFirst) firstName = metaFirst;
      }
      if (!lastName) {
        const metaLast = (user.user_metadata?.last_name as string | undefined)?.trim();
        if (metaLast) lastName = metaLast;
      }
      // Final fallback so we never write a null first_name into creators.
      if (!firstName) {
        const metaName = (user.user_metadata?.name as string | undefined)?.trim();
        if (metaName) {
          const parts = metaName.split(/\s+/);
          firstName = parts[0] ?? null;
          if (!lastName && parts.length > 1) {
            lastName = parts.slice(1).join(' ');
          }
        }
      }
      if (!firstName) {
        return { success: false, error: 'Missing first name — please update your profile before becoming a creator.' };
      }

      const name = lastName ? `${firstName} ${lastName}` : firstName;

      // Upsert into creators carrying the name fields (NOT nulls).
      const { error: creatorsError } = await supabase
        .from('creators')
        .upsert(
          // account_type:'creator' flips any prior shopper row to a full
          // creator on promote. No-op for existing creators (already 'creator').
          { id: user.id, email: user.email ?? '', name, first_name: firstName, last_name: lastName, account_type: 'creator' },
          { onConflict: 'id' }
        );
      if (creatorsError) {
        console.error('[promoteToCreator] creators upsert error:', creatorsError);
        return { success: false, error: creatorsError.message };
      }

      // Ensure a creator_profiles row exists too.
      const { error: profileError } = await supabase
        .from('creator_profiles')
        .upsert(
          { creator_id: user.id, username: name, first_name: firstName, last_name: lastName },
          { onConflict: 'creator_id' }
        );
      if (profileError) {
        console.warn('[promoteToCreator] creator_profiles upsert error:', profileError);
        // Non-fatal — DB triggers may also seed this row.
      }

      // Flip the JWT claim. updateUser merges into raw_user_meta_data.
      const { error: updateError } = await supabase.auth.updateUser({
        data: { user_type: 'creator', first_name: firstName, last_name: lastName, name },
      });
      if (updateError) {
        console.error('[promoteToCreator] updateUser error:', updateError);
        return { success: false, error: updateError.message };
      }

      // Refresh so the in-app session carries the new user_type claim.
      // Without this the next route guard read still sees user_type='audience'
      // and bounces the user back to the audience tabs.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.warn('[promoteToCreator] refreshSession warning:', refreshError);
      }

      set({
        isLoggedIn: true,
        userType: 'creator',
        accountType: 'creator',
        creatorId: user.id,
        creatorName: name,
        publicUser: null,
      });
      useContextStore.getState().setPersonalCreatorId(user.id);
      useContextStore.getState().loadMemberships(user.id).catch(() => {});
      useLikeStore.getState().syncLikedIds(user.id).catch(() => {});
      useFollowStore.getState().hydrate(user.id).catch(() => {});
      useSavedItemsStore.getState().hydrate(user.id).catch(() => {});
      useSavedLooksStore.getState().hydrate(user.id).catch(() => {});
      return { success: true };
    } catch (err: any) {
      console.error('[promoteToCreator] caught exception:', err?.message || err);
      return { success: false, error: err?.message ?? 'Failed to become a creator.' };
    }
  },

  revertToShopper: async () => {
    // MIRROR of promoteToCreator and the ONLY other function permitted to write
    // account_type / auth user_type (separation-rule). MUST only ever be invoked
    // from the explicit "Switch to shopper mode" confirm in account-settings.
    // There is NO effect/auto-call path — do not wire this into a useEffect or
    // hydration. It performs all three revert steps atomically-in-order:
    // creators.account_type='shopper', auth user_type='audience', and unpublish
    // the creator's looks so shopper looks stay private (discovery filters on
    // published_at, so nulling it hides without deleting).
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        return { success: false, error: 'No active session — please sign in again.' };
      }
      const user = session.user;

      // 1. Flip the creators row back to shopper.
      const { error: creatorsError } = await supabase
        .from('creators')
        .update({ account_type: 'shopper' })
        .eq('id', user.id);
      if (creatorsError) {
        console.error('[revertToShopper] creators update error:', creatorsError);
        return { success: false, error: creatorsError.message };
      }

      // 2. Unpublish every one of this creator's looks so they stay private.
      const { error: looksError } = await supabase
        .from('looks')
        .update({ published_at: null })
        .eq('creator_id', user.id);
      if (looksError) {
        console.error('[revertToShopper] looks unpublish error:', looksError);
        return { success: false, error: looksError.message };
      }

      // 3. Flip the JWT claim back to audience. updateUser merges into
      //    raw_user_meta_data.
      const { error: updateError } = await supabase.auth.updateUser({
        data: { user_type: 'audience' },
      });
      if (updateError) {
        console.error('[revertToShopper] updateUser error:', updateError);
        return { success: false, error: updateError.message };
      }

      // Refresh so the in-app session carries the new user_type claim. Without
      // this the next route guard read still sees user_type='creator' and keeps
      // the user in the creator shell.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.warn('[revertToShopper] refreshSession warning:', refreshError);
      }

      // Mirror the shopper store shape (userType='audience', accountType='shopper',
      // creatorId retained for the reused closet surfaces).
      const name = (user.user_metadata?.name as string | undefined) ?? '';
      set({
        isLoggedIn: true,
        userType: 'audience',
        accountType: 'shopper',
        creatorId: user.id,
        creatorName: null,
        publicUser: { name, email: user.email ?? '' },
      });
      useLookStore.getState().loadClosetItems(user.id).catch(() => {});
      return { success: true };
    } catch (err: any) {
      console.error('[revertToShopper] caught exception:', err?.message || err);
      return { success: false, error: err?.message ?? 'Failed to switch to shopper mode.' };
    }
  },

  ensureShopperCloset: async () => {
    // Idempotently opt the current audience user into a shopper closet. Creates
    // a creators row tagged account_type='shopper' (RLS: auth.uid()=id) and
    // sets creatorId + accountType WITHOUT touching userType / isLoggedIn /
    // publicUser — so route guards keep the user in (public-tabs) and the
    // creator-only hydration in _layout never fires. Name derivation mirrors
    // promoteToCreator so we never insert a null first_name.
    //
    // HARD INVARIANT (separation-rule-1): the shopper path must NEVER write auth
    // metadata. This function MUST NOT call supabase.auth.updateUser and MUST
    // NOT set user_type. Auth user_type stays 'audience' for shoppers forever.
    // The ONLY place allowed to flip user_type='creator' is promoteToCreator,
    // invoked exclusively from the explicit upgrade banner in (tabs)/shop.tsx.
    // Do not add an updateUser call here under any circumstances.
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        return { success: false, error: 'No active session — please sign in again.' };
      }
      const user = session.user;

      // Derive first/last from audience_accounts (source of truth), else metadata.
      let firstName: string | null = null;
      let lastName: string | null = null;
      let audienceEmail: string | null = null;
      try {
        const { data: audience } = await supabase
          .from('audience_accounts')
          .select('first_name, last_name, name, email')
          .eq('id', user.id)
          .maybeSingle();
        if (audience) {
          const af = (audience as any).first_name as string | null | undefined;
          const al = (audience as any).last_name as string | null | undefined;
          const ae = (audience as any).email as string | null | undefined;
          if (af && af.trim()) firstName = af.trim();
          if (al && al.trim()) lastName = al.trim();
          if (ae && ae.trim()) audienceEmail = ae.trim();
        }
      } catch (e) {
        console.warn('[ensureShopperCloset] audience_accounts lookup failed:', e);
      }
      if (!firstName) {
        const metaFirst = (user.user_metadata?.first_name as string | undefined)?.trim();
        if (metaFirst) firstName = metaFirst;
      }
      if (!lastName) {
        const metaLast = (user.user_metadata?.last_name as string | undefined)?.trim();
        if (metaLast) lastName = metaLast;
      }
      if (!firstName) {
        const metaName = (user.user_metadata?.name as string | undefined)?.trim();
        if (metaName) {
          const parts = metaName.split(/\s+/);
          firstName = parts[0] ?? null;
          if (!lastName && parts.length > 1) lastName = parts.slice(1).join(' ');
        }
      }
      const name = firstName ? (lastName ? `${firstName} ${lastName}` : firstName) : (user.email?.split('@')[0] ?? 'Shopper');
      const email = user.email ?? audienceEmail ?? '';

      // Reuse an existing creators row if one exists — NEVER flip an existing
      // creator to 'shopper'. Only insert a shopper row when none exists.
      let resolvedAccountType: 'creator' | 'shopper' = 'shopper';
      const { data: existing } = await supabase
        .from('creators')
        .select('id, account_type')
        .eq('id', user.id)
        .maybeSingle();
      if (existing) {
        const at = (existing as any).account_type as string | null | undefined;
        resolvedAccountType = at === 'creator' ? 'creator' : 'shopper';
      } else {
        const { error: insertError } = await supabase
          .from('creators')
          .insert({ id: user.id, email, name, account_type: 'shopper' });
        if (insertError) {
          console.error('[ensureShopperCloset] creators insert error:', insertError);
          return { success: false, error: insertError.message };
        }
      }

      set({ creatorId: user.id, accountType: resolvedAccountType });
      useLookStore.getState().loadClosetItems(user.id).catch(() => {});
      return { success: true, creatorId: user.id };
    } catch (err: any) {
      console.error('[ensureShopperCloset] caught exception:', err?.message || err);
      return { success: false, error: err?.message ?? 'Failed to create your closet.' };
    }
  },

  logout: async () => {
    // Revoke the share-extension device token while the session is still active
    // (then clear it locally + from the App Group) so "Share → SiM" stops adding.
    await revokeShareDeviceToken().catch(() => {});
    await supabase.auth.signOut();
    set({ isLoggedIn: false, userType: null, accountType: null, creatorId: null, creatorName: null, publicUser: null });
    useContextStore.getState().clear();
    useFollowStore.getState().clear();
    useSavedItemsStore.getState().clear();
    useSavedLooksStore.getState().clear();
  },

  deleteAccount: async () => {
    // The `delete-account` edge function is the source of truth: it validates
    // the JWT internally (verify_jwt=false to bypass the ES256 key issue),
    // deletes storage files, then calls admin.deleteUser which cascades
    // through creators/audience_accounts/looks/items via ON DELETE CASCADE.
    let invokeError: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        // No session — nothing to delete remotely. Fall through to local cleanup.
      } else {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('delete-account timed out')), 30000)
        );
        const result = await Promise.race([
          supabase.functions.invoke('delete-account', { body: {} }),
          timeout,
        ]);
        if (result && 'error' in result && result.error) {
          invokeError = result.error.message ?? 'Edge function error';
          console.warn('[delete-account] edge function error:', result.error);
        }
      }
    } catch (err: any) {
      invokeError = err?.message ?? 'Failed to delete account';
      console.warn('[delete-account] failed:', err);
    } finally {
      // Use scope: 'local' — after the edge function deletes auth.users, the
      // default signOut() call to /logout with the now-invalid access token
      // returns 403 and can stall. Local scope just clears AsyncStorage.
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
      void clearLocalAndAppGroup(); // account gone — drop the share token too
      set({ isLoggedIn: false, userType: null, accountType: null, creatorId: null, creatorName: null, publicUser: null });
      useContextStore.getState().clear();
    useFollowStore.getState().clear();
    useSavedItemsStore.getState().clear();
    useSavedLooksStore.getState().clear();
      // Explicit nav — onAuthStateChange doesn't fire for scope:'local' signOut,
      // so the root index redirect never kicks in on its own.
      try { router.replace('/welcome'); } catch (e) { console.warn('[delete-account] router.replace failed:', e); }
    }
    return invokeError ? { success: false, error: invokeError } : { success: true };
  },
}));

// Persistent listener: when Supabase's native auto-refresh fails (e.g. stale/revoked
// refresh token), it fires SIGNED_OUT so we clear local state cleanly.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    useAuthStore.setState({
      isLoggedIn: false,
      userType: null,
      accountType: null,
      creatorId: null,
      creatorName: null,
      publicUser: null,
    });
    useContextStore.getState().clear();
    useFollowStore.getState().clear();
    useSavedItemsStore.getState().clear();
    useSavedLooksStore.getState().clear();
    // Defensive: also covers involuntary sign-out (stale refresh token) — no
    // session to authorize a revoke RPC, but the local + App Group token must
    // still be cleared so the share extension can't keep adding.
    void clearLocalAndAppGroup();
    return;
  }
  // Any signed-in user — creator OR shopper (audience user with a shopper
  // closet) — has a closet and can use the "Share → Styled in Motion" extension,
  // so on sign-in / session restore / token refresh make sure the share device
  // token exists and is mirrored to the App Group. Mints only when none is
  // stored (idempotent). Deferred via setTimeout so we never call a supabase RPC
  // synchronously inside the auth-state callback (documented deadlock guard).
  //
  // NOTE: this MUST NOT be gated on user_metadata.user_type === 'creator'.
  // Doing so was the regression that broke share-to-closet after the shopper
  // shell shipped: shoppers keep user_type='audience', so their token was never
  // minted/mirrored and the extension read an empty App Group → "Open the app
  // and sign in" (with zero share-add-item invocations). The device token is
  // per-user and the extension lands the item in that user's own closet, so
  // minting for every signed-in user is both correct and safe. This does not
  // write user_type/account_type, so it doesn't touch the auth separation rule.
  if (session?.user) {
    setTimeout(() => { void ensureShareDeviceToken(); }, 0);
  }
});

// Re-mirror the share device token to the App Group whenever the app returns to
// the foreground. The onAuthStateChange handler above only fires on auth
// *events* (sign-in / token refresh / restore) — but a persistent signed-in
// creator like our repro account can foreground the app many times without any
// such event firing, so the App Group copy is only ever as fresh as the last
// auth event and can go stale/empty (the extension then shows "Open the app and
// sign in"). Foregrounding is the moment right before the user taps the share
// sheet, so we push the current token into the App Group here too. This mirrors
// the EXISTING token (ensureShareDeviceToken only mints when none is stored), so
// it's idempotent and never churns/revokes tokens on resume.
let shareTokenAppState: AppStateStatus = AppState.currentState;
AppState.addEventListener('change', (next: AppStateStatus) => {
  const cameToForeground =
    /inactive|background/.test(shareTokenAppState) && next === 'active';
  shareTokenAppState = next;
  if (!cameToForeground) return;
  if (!useAuthStore.getState().isLoggedIn) return;
  setTimeout(() => { void ensureShareDeviceToken(); }, 0);
});

export default useAuthStore;

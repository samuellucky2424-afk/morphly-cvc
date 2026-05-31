import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { fetchUserProfile, updateUserProfile } from '../lib/userCredits';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured) {
      setSessionLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) {
        return;
      }

      if (sessionError) {
        setError(sessionError.message);
      }

      setUser(data.session?.user ?? null);
      setSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setProfile(null);
      return undefined;
    }

    setProfileLoading(true);
    fetchUserProfile(user)
      .then((nextProfile) => {
        if (mounted) {
          setProfile(nextProfile);
        }
      })
      .catch((profileError) => {
        if (mounted) {
          setError(profileError.message || 'Unable to load your account profile.');
        }
      })
      .finally(() => {
        if (mounted) {
          setProfileLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  const signIn = useCallback(async (email, password) => {
    setError('');

    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add your project URL and publishable key first.');
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      throw signInError;
    }
  }, []);

  const signUp = useCallback(async (email, password) => {
    setError('');

    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add your project URL and publishable key first.');
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: email.split('@')[0],
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      throw signUpError;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError('');

    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add your project URL and publishable key first.');
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      throw oauthError;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError('');

    if (!isSupabaseConfigured) {
      setUser(null);
      setProfile(null);
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
      throw signOutError;
    }
  }, []);

  const saveProfile = useCallback(
    async (patch) => {
      if (!user?.id) {
        throw new Error('You must be signed in to update your profile.');
      }

      const updated = await updateUserProfile(user.id, patch);
      setProfile(updated);
      return updated;
    },
    [user]
  );

  const refreshProfile = useCallback(async () => {
    if (!user) {
      return null;
    }

    const nextProfile = await fetchUserProfile(user);
    setProfile(nextProfile);
    return nextProfile;
  }, [user]);

  const applyProfile = useCallback((nextProfile) => {
    if (nextProfile) {
      setProfile(nextProfile);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      subscription: profile?.subscription || null,
      credits: profile?.voice_credits ?? 0,
      displayEmail: profile?.email || user?.email || '',
      displayName: profile?.display_name || user?.email?.split('@')[0] || 'Morphly User',
      loading: sessionLoading || profileLoading,
      error,
      isSupabaseConfigured,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveProfile,
      refreshProfile,
      applyProfile,
    }),
    [
      user,
      profile,
      sessionLoading,
      profileLoading,
      error,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveProfile,
      refreshProfile,
      applyProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }

  return context;
}

import { requireSupabase } from './supabaseClient';
import { fetchCloudProfile, isMorphlyApiConfigured } from './morphlyApi';

const USER_SELECT = 'id,email,display_name,voice_credits,created_at,updated_at';

function fallbackDisplayName(user) {
  return user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Morphly User';
}

export async function fetchUserProfile(user) {
  if (!user?.id) {
    return null;
  }

  if (isMorphlyApiConfigured) {
    return fetchCloudProfile();
  }

  const supabase = requireSupabase();
  const { data, error } = await supabase.from('userw').select(USER_SELECT).eq('id', user.id).maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  const seedProfile = {
    id: user.id,
    email: user.email,
    display_name: fallbackDisplayName(user),
  };

  const { data: created, error: insertError } = await supabase.from('userw').insert(seedProfile).select(USER_SELECT).single();

  if (insertError) {
    throw insertError;
  }

  return created;
}

export async function updateUserProfile(userId, patch) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('userw')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select(USER_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateVoiceCredits(userId, voiceCredits) {
  const safeCredits = Math.max(0, Number(voiceCredits) || 0);
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('userw')
    .update({ voice_credits: safeCredits, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select(USER_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function addVoiceCredits(userId, creditsToAdd) {
  throw new Error('Voice credits must be changed by the Morphly Vercel backend after payment verification.');
}

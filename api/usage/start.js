import { CREDITS_PER_STARTED_MINUTE } from '../_lib/plans.js';
import { ensureProfile, handleApiError, handleOptions, requireUser, setCors, sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCors(req, res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
    return;
  }

  try {
    const { supabase, user } = await requireUser(req);
    await ensureProfile(supabase, user);

    const { data, error } = await supabase.rpc('start_voice_usagew', {
      target_user_id: user.id,
      credits_per_minute: CREDITS_PER_STARTED_MINUTE,
    });

    if (error) {
      throw error;
    }

    sendJson(res, 200, data);
  } catch (error) {
    handleApiError(res, error);
  }
}

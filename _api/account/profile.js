import { ensureProfile, handleApiError, handleOptions, requireUser, setCors, sendJson } from '../../server/http.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCors(req, res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
    return;
  }

  try {
    const { supabase, user } = await requireUser(req);
    const profile = await ensureProfile(supabase, user);
    sendJson(res, 200, { profile });
  } catch (error) {
    handleApiError(res, error);
  }
}

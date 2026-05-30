import { handleApiError, handleOptions, readJsonBody, requireUser, setCors, sendError, sendJson } from '../_lib/http.js';

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
    const body = await readJsonBody(req);

    if (!body.sessionId) {
      sendError(res, 400, 'Missing usage session id.', 'USAGE_SESSION_REQUIRED');
      return;
    }

    const { data, error } = await supabase.rpc('stop_voice_usagew', {
      target_user_id: user.id,
      usage_session_id: body.sessionId,
    });

    if (error) {
      throw error;
    }

    sendJson(res, 200, data);
  } catch (error) {
    handleApiError(res, error);
  }
}

import { getAccountProfile, handleApiError, handleOptions, readJsonBody, requireUser, setCors, sendError, sendJson } from '../../server/http.js';
import { applyVerifiedFlutterwavePayment } from '../../server/flutterwave.js';

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
    const transactionId = body.transactionId || body.transaction_id;
    const txRef = body.txRef || body.tx_ref;
    const planId = body.planId;

    if (!transactionId || !txRef || !planId) {
      sendError(res, 400, 'Missing payment verification details.', 'PAYMENT_DETAILS_REQUIRED');
      return;
    }

    const result = await applyVerifiedFlutterwavePayment(supabase, {
      transactionId,
      txRef,
      userId: user.id,
      planId,
    });

    sendJson(res, 200, { profile: await getAccountProfile(supabase, user.id), alreadyProcessed: result.alreadyProcessed });
  } catch (error) {
    handleApiError(res, error);
  }
}

import {
  handleApiError,
  handleOptions,
  getSupabaseAdmin,
  readRawJsonBody,
  setCors,
  sendError,
  sendJson,
} from '../../server/http.js';
import {
  applyVerifiedFlutterwavePayment,
  extractWebhookTransaction,
  isFlutterwaveLegacyHashValid,
  isFlutterwaveWebhookSignatureValid,
} from '../../server/flutterwave.js';

function legacyHashMatches(req) {
  const receivedHash = req.headers['verif-hash'] || req.headers['verify-hash'] || req.headers['verifi-hash'];

  return isFlutterwaveLegacyHashValid(receivedHash);
}

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
    const { rawBody, payload } = await readRawJsonBody(req);
    const signature = req.headers['flutterwave-signature'];
    const hasValidSignature =
      isFlutterwaveWebhookSignatureValid(rawBody, signature)
      || legacyHashMatches(req);

    if (!hasValidSignature) {
      sendError(res, 401, 'Flutterwave webhook signature is invalid.', 'WEBHOOK_SIGNATURE_INVALID');
      return;
    }

    const event = extractWebhookTransaction(payload);

    if (!event.transactionId) {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'missing_transaction_id' });
      return;
    }

    if (event.type && !event.type.toLowerCase().includes('charge')) {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'unsupported_event' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const result = await applyVerifiedFlutterwavePayment(supabase, {
      transactionId: event.transactionId,
      txRef: event.txRef,
    });

    sendJson(res, 200, {
      ok: true,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    if (error.code === 'PAYMENT_REFERENCE_NOT_FOUND') {
      sendJson(res, 200, { ok: true, ignored: true, reason: error.code });
      return;
    }

    handleApiError(res, error);
  }
}

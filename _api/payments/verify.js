import { findCreditPlan } from '../../server/plans.js';
import { getAccountProfile, handleApiError, handleOptions, readJsonBody, requireUser, setCors, sendError, sendJson } from '../../server/http.js';

function moneyEquals(left, right) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

async function verifyFlutterwaveTransaction(transactionId) {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;

  if (!secretKey) {
    const error = new Error('Missing FLUTTERWAVE_SECRET_KEY on the Vercel backend.');
    error.status = 500;
    error.code = 'PAYMENT_CONFIG_MISSING';
    throw error;
  }

  const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.message || 'Flutterwave verification failed.');
    error.status = 502;
    error.code = 'FLUTTERWAVE_VERIFY_FAILED';
    throw error;
  }

  return payload?.data;
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
    const { supabase, user } = await requireUser(req);
    const body = await readJsonBody(req);
    const transactionId = body.transactionId || body.transaction_id;
    const txRef = body.txRef || body.tx_ref;
    const planId = body.planId;

    if (!transactionId || !txRef || !planId) {
      sendError(res, 400, 'Missing payment verification details.', 'PAYMENT_DETAILS_REQUIRED');
      return;
    }

    const plan = findCreditPlan(planId);
    if (!plan) {
      sendError(res, 400, 'Unknown credit plan.', 'UNKNOWN_PLAN');
      return;
    }

    const { data: pendingPayment, error: pendingError } = await supabase
      .from('paymentw')
      .select('id,user_id,plan_id,amount,currency,credits,status,tx_ref')
      .eq('user_id', user.id)
      .eq('provider', 'flutterwave')
      .eq('tx_ref', txRef)
      .maybeSingle();

    if (pendingError) {
      throw pendingError;
    }

    if (!pendingPayment) {
      sendError(res, 404, 'This checkout reference was not created by Morphly.', 'PAYMENT_REFERENCE_NOT_FOUND');
      return;
    }

    if (pendingPayment.status === 'successful') {
      const profile = await getAccountProfile(supabase, user.id);

      sendJson(res, 200, { profile, alreadyProcessed: true });
      return;
    }

    const verified = await verifyFlutterwaveTransaction(transactionId);

    if (!verified || verified.status !== 'successful') {
      sendError(res, 402, 'Flutterwave has not marked this payment as successful.', 'PAYMENT_NOT_SUCCESSFUL');
      return;
    }

    if (verified.tx_ref !== txRef) {
      sendError(res, 400, 'Flutterwave reference does not match this checkout.', 'PAYMENT_REFERENCE_MISMATCH');
      return;
    }

    if (verified.currency !== plan.currency || !moneyEquals(verified.amount, plan.amount)) {
      sendError(res, 400, 'Flutterwave amount or currency does not match the selected plan.', 'PAYMENT_AMOUNT_MISMATCH');
      return;
    }

    const { error: applyError } = await supabase.rpc('apply_flutterwave_paymentw', {
      target_user_id: user.id,
      p_plan_id: plan.id,
      p_amount: plan.amount,
      p_currency: plan.currency,
      p_credits: plan.credits,
      p_subscription_days: plan.subscriptionDays || 0,
      p_provider_reference: `${verified.id || transactionId}`,
      p_tx_ref: txRef,
      p_raw_response: verified,
    });

    if (applyError) {
      throw applyError;
    }

    sendJson(res, 200, { profile: await getAccountProfile(supabase, user.id) });
  } catch (error) {
    handleApiError(res, error);
  }
}

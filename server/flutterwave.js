import { createHmac, timingSafeEqual } from 'crypto';
import { findCreditPlan } from './plans.js';

function moneyAtLeast(actual, expected) {
  return Math.round(Number(actual) * 100) >= Math.round(Number(expected) * 100);
}

function moneyEquals(left, right) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

function normalizeReference(value) {
  return value == null ? '' : `${value}`;
}

function successfulStatus(status) {
  return status === 'successful' || status === 'succeeded';
}

function failedStatus(status) {
  return ['failed', 'cancelled', 'canceled'].includes(status);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function flutterwaveWebhookSecret() {
  return process.env.FLUTTERWAVE_WEBHOOK_SECRET || process.env.FLW_SECRET_HASH || '';
}

export function isFlutterwaveWebhookSignatureValid(rawBody, signature, secretHash = flutterwaveWebhookSecret()) {
  if (!secretHash || !signature || !rawBody) {
    return false;
  }

  const expectedSignature = createHmac('sha256', secretHash).update(rawBody).digest('base64');

  return safeCompare(expectedSignature, signature);
}

export function isFlutterwaveLegacyHashValid(receivedHash, secretHash = flutterwaveWebhookSecret()) {
  return Boolean(secretHash && receivedHash && safeCompare(secretHash, receivedHash));
}

export function extractWebhookTransaction(payload) {
  const data = payload?.data || {};

  return {
    eventId: payload?.id || payload?.event_id || '',
    type: payload?.type || payload?.event || '',
    transactionId: normalizeReference(data.id || data.transaction_id || payload?.transaction_id),
    txRef: normalizeReference(data.tx_ref || data.reference || payload?.tx_ref),
    status: data.status || payload?.status || '',
  };
}

export async function verifyFlutterwaveTransaction(transactionId) {
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

async function markPaymentFailed(supabase, payment, verified) {
  await supabase
    .from('paymentw')
    .update({
      status: failedStatus(verified?.status) ? 'failed' : 'pending',
      provider_reference: normalizeReference(verified?.id || payment.provider_reference) || null,
      raw_response: verified || null,
    })
    .eq('id', payment.id)
    .neq('status', 'successful');
}

export async function applyVerifiedFlutterwavePayment(supabase, {
  transactionId,
  txRef,
  userId,
  planId,
} = {}) {
  const verified = await verifyFlutterwaveTransaction(transactionId);
  const verifiedTxRef = normalizeReference(verified?.tx_ref || verified?.reference || txRef);

  if (!verifiedTxRef) {
    const error = new Error('Flutterwave verification did not include a transaction reference.');
    error.status = 400;
    error.code = 'PAYMENT_REFERENCE_MISSING';
    throw error;
  }

  let paymentQuery = supabase
    .from('paymentw')
    .select('id,user_id,plan_id,amount,currency,credits,status,provider_reference,tx_ref')
    .eq('provider', 'flutterwave')
    .eq('tx_ref', verifiedTxRef);

  if (userId) {
    paymentQuery = paymentQuery.eq('user_id', userId);
  }

  const { data: pendingPayment, error: pendingError } = await paymentQuery.maybeSingle();

  if (pendingError) {
    throw pendingError;
  }

  if (!pendingPayment) {
    const error = new Error('This checkout reference was not created by Morphly.');
    error.status = 404;
    error.code = 'PAYMENT_REFERENCE_NOT_FOUND';
    throw error;
  }

  if (planId && pendingPayment.plan_id !== planId) {
    const error = new Error('Checkout plan does not match this payment reference.');
    error.status = 400;
    error.code = 'PAYMENT_PLAN_MISMATCH';
    throw error;
  }

  if (pendingPayment.status === 'successful') {
    return {
      alreadyProcessed: true,
      targetUserId: pendingPayment.user_id,
      payment: pendingPayment,
      verified,
    };
  }

  const plan = findCreditPlan(pendingPayment.plan_id);
  if (!plan) {
    const error = new Error('Unknown credit plan for this checkout reference.');
    error.status = 400;
    error.code = 'UNKNOWN_PLAN';
    throw error;
  }

  if (!successfulStatus(verified?.status)) {
    await markPaymentFailed(supabase, pendingPayment, verified);
    const error = new Error('Flutterwave has not marked this payment as successful.');
    error.status = 402;
    error.code = 'PAYMENT_NOT_SUCCESSFUL';
    throw error;
  }

  if (verifiedTxRef !== pendingPayment.tx_ref) {
    const error = new Error('Flutterwave reference does not match this checkout.');
    error.status = 400;
    error.code = 'PAYMENT_REFERENCE_MISMATCH';
    throw error;
  }

  if (`${verified.currency || ''}`.toUpperCase() !== `${pendingPayment.currency || ''}`.toUpperCase() || !moneyEquals(pendingPayment.amount, plan.amount)) {
    const error = new Error('Stored checkout details do not match the current plan catalog.');
    error.status = 409;
    error.code = 'PAYMENT_PLAN_CHANGED';
    throw error;
  }

  const amountPaid = Number(verified.charged_amount ?? verified.amount);
  if (!moneyAtLeast(amountPaid, pendingPayment.amount)) {
    const error = new Error('Flutterwave amount does not cover the selected plan.');
    error.status = 400;
    error.code = 'PAYMENT_AMOUNT_MISMATCH';
    throw error;
  }

  const { error: applyError } = await supabase.rpc('apply_flutterwave_paymentw', {
    target_user_id: pendingPayment.user_id,
    p_plan_id: pendingPayment.plan_id,
    p_amount: pendingPayment.amount,
    p_currency: pendingPayment.currency,
    p_credits: pendingPayment.credits,
    p_subscription_days: plan.subscriptionDays || 0,
    p_provider_reference: normalizeReference(verified.id || transactionId),
    p_tx_ref: pendingPayment.tx_ref,
    p_raw_response: verified,
  });

  if (applyError) {
    throw applyError;
  }

  return {
    alreadyProcessed: false,
    targetUserId: pendingPayment.user_id,
    payment: pendingPayment,
    verified,
  };
}

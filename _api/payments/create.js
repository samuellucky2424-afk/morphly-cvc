import { randomUUID } from 'crypto';
import { findCreditPlan } from '../../server/plans.js';
import { ensureProfile, handleApiError, handleOptions, readJsonBody, requireUser, setCors, sendError, sendJson } from '../../server/http.js';

function checkoutReference(planId, userId) {
  return `morphly-${planId}-${userId.slice(0, 8)}-${Date.now()}-${randomUUID()}`;
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
    await ensureProfile(supabase, user);

    const body = await readJsonBody(req);
    const plan = findCreditPlan(body.planId);

    if (!plan) {
      sendError(res, 400, 'Unknown credit plan.', 'UNKNOWN_PLAN');
      return;
    }

    const txRef = checkoutReference(plan.id, user.id);
    const { error } = await supabase.from('paymentw').insert({
      user_id: user.id,
      plan_id: plan.id,
      amount: plan.amount,
      currency: plan.currency,
      credits: plan.credits,
      provider: 'flutterwave',
      tx_ref: txRef,
      status: 'pending',
    });

    if (error) {
      throw error;
    }

    sendJson(res, 200, {
      checkout: {
        txRef,
        amount: plan.amount,
        currency: plan.currency,
        credits: plan.credits,
        kind: plan.kind,
        subscriptionDays: plan.subscriptionDays || 0,
        planId: plan.id,
        publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || '',
      },
    });
  } catch (error) {
    handleApiError(res, error);
  }
}

export const STARTER_VOICE_CREDITS = 10;
export const CREDITS_PER_STARTED_MINUTE = 2;

export const CREDIT_PLANS = [
  { id: 'basic', name: 'Basic', amount: 3500, currency: 'NGN', credits: 180 },
  { id: 'pro', name: 'Pro', amount: 9500, currency: 'NGN', credits: 720 },
  { id: 'studio', name: 'Studio', amount: 24000, currency: 'NGN', credits: 2400 },
];

export function findCreditPlan(planId) {
  return CREDIT_PLANS.find((plan) => plan.id === planId) || null;
}

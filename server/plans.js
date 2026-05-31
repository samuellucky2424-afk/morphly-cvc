export const STARTER_VOICE_CREDITS = 10;
export const CREDITS_PER_STARTED_MINUTE = 2;

export const CREDIT_PLANS = [
  { id: 'credit_1000', name: '1,000 Credits', amount: 8000, currency: 'NGN', credits: 1000, kind: 'credits' },
  { id: 'credit_2000', name: '2,000 Credits', amount: 16000, currency: 'NGN', credits: 2000, kind: 'credits' },
  { id: 'credit_5000', name: '5,000 Credits', amount: 40000, currency: 'NGN', credits: 5000, kind: 'credits' },
  { id: 'unlimited_monthly', name: 'Monthly Unlimited', amount: 60000, currency: 'NGN', credits: 0, kind: 'subscription', subscriptionDays: 29 },
];

export function findCreditPlan(planId) {
  return CREDIT_PLANS.find((plan) => plan.id === planId) || null;
}

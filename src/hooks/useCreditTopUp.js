import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closePaymentModal, useFlutterwave } from 'flutterwave-react-v3';
import { createCreditCheckout, isMorphlyApiConfigured, verifyCreditPayment } from '../lib/morphlyApi';

const flutterwavePublicKey = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY || '';

export function useCreditTopUp({ user, displayName, displayEmail, onPaymentSuccess, onPaymentError, onPaymentClosed }) {
  const [checkoutRequest, setCheckoutRequest] = useState(null);
  const [pendingPlanId, setPendingPlanId] = useState('');
  const processedRequestId = useRef('');
  const activePlan = checkoutRequest?.plan;
  const checkout = checkoutRequest?.checkout;
  const checkoutPublicKey = checkout?.publicKey || flutterwavePublicKey;

  const config = useMemo(
    () => ({
      public_key: checkoutPublicKey,
      tx_ref: checkout?.txRef || 'morphly-idle',
      amount: checkout?.amount || activePlan?.amount || 0,
      currency: checkout?.currency || activePlan?.currency || 'NGN',
      payment_options: 'card,banktransfer,ussd',
      customer: {
        email: displayEmail || user?.email || '',
        name: displayName || displayEmail || 'Morphly User',
      },
      customizations: {
        title: 'Morphly Voice Access',
        description: activePlan
          ? activePlan.kind === 'subscription'
            ? `${activePlan.name} plan - unlimited voice conversion for ${activePlan.subscriptionDays} days`
            : `${activePlan.name} plan - ${activePlan.credits.toLocaleString()} voice credits`
          : 'Voice credit top-up',
        logo: '',
      },
    }),
    [activePlan, checkout?.amount, checkout?.currency, checkout?.txRef, checkoutPublicKey, displayEmail, displayName, user]
  );

  const handleFlutterPayment = useFlutterwave(config);

  useEffect(() => {
    if (!checkoutRequest || processedRequestId.current === checkoutRequest.id) {
      return;
    }

    processedRequestId.current = checkoutRequest.id;

    handleFlutterPayment({
      callback: async (response) => {
        try {
          if (response?.status === 'successful' || response?.status === 'completed') {
            const profile = await verifyCreditPayment({
              planId: checkoutRequest.plan.id,
              txRef: checkoutRequest.checkout.txRef,
              transactionId: response?.transaction_id || response?.id,
            });
            await onPaymentSuccess(checkoutRequest.plan, response, profile);
          } else {
            onPaymentError?.('Payment was not completed.');
          }
        } catch (error) {
          onPaymentError?.(error.message || 'Unable to update credits after payment.');
        } finally {
          closePaymentModal();
          setCheckoutRequest(null);
          setPendingPlanId('');
        }
      },
      onClose: () => {
        onPaymentClosed?.();
        setCheckoutRequest(null);
        setPendingPlanId('');
      },
    });
  }, [checkoutRequest, handleFlutterPayment, onPaymentClosed, onPaymentError, onPaymentSuccess]);

  const startPayment = useCallback(
    async (plan) => {
      if (!isMorphlyApiConfigured) {
        onPaymentError?.('Morphly cloud API is not configured. Add VITE_MORPHLY_API_URL to your environment.');
        return;
      }

      if (!user?.id) {
        onPaymentError?.('Sign in before buying voice credits.');
        return;
      }

      setPendingPlanId(plan.id);
      try {
        const nextCheckout = await createCreditCheckout(plan.id);
        const publicKey = nextCheckout.publicKey || flutterwavePublicKey;

        if (!publicKey) {
          throw new Error('Flutterwave public key is missing. Add FLUTTERWAVE_PUBLIC_KEY on Vercel or VITE_FLUTTERWAVE_PUBLIC_KEY in the app.');
        }

        setCheckoutRequest({ id: nextCheckout.txRef, plan, checkout: nextCheckout });
      } catch (error) {
        setPendingPlanId('');
        onPaymentError?.(error.message || 'Unable to create Flutterwave checkout.');
      }
    },
    [onPaymentError, user]
  );

  return {
    startPayment,
    activePlanId: activePlan?.id || pendingPlanId,
    isPaymentConfigured: isMorphlyApiConfigured,
  };
}

import { requireSupabase } from './supabaseClient';

const apiBaseUrl = (import.meta.env.VITE_MORPHLY_API_URL || '').replace(/\/+$/, '');

export const isMorphlyApiConfigured = Boolean(apiBaseUrl);
export const CREDITS_PER_STARTED_MINUTE = 2;

async function accessToken() {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Sign in again before using Morphly cloud services.');
  }

  return token;
}

async function apiRequest(path, options = {}) {
  if (!apiBaseUrl) {
    throw new Error('Morphly cloud API is not configured. Add VITE_MORPHLY_API_URL to the app environment.');
  }

  const token = await accessToken();
  const response = await fetch(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || `Morphly cloud request failed (${response.status}).`;
    const details = payload?.error?.details;
    const code = payload?.error?.code;
    console.error('Morphly cloud request failed', {
      path,
      status: response.status,
      code,
      message,
      details,
    });
    const detailText = details && details !== message ? ` Details: ${details}` : '';
    const codeText = code ? ` (${code})` : '';
    throw new Error(`${message}${codeText}${detailText}`);
  }

  return payload;
}

export async function fetchCloudProfile() {
  const payload = await apiRequest('/api/account/profile', { method: 'GET' });
  return payload.profile;
}

export async function createCreditCheckout(planId) {
  const payload = await apiRequest('/api/payments/create', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });

  return payload.checkout;
}

export async function verifyCreditPayment({ planId, txRef, transactionId }) {
  const payload = await apiRequest('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify({ planId, txRef, transactionId }),
  });

  return payload.profile;
}

export async function startVoiceUsage() {
  return apiRequest('/api/usage/start', { method: 'POST', body: JSON.stringify({}) });
}

export async function billVoiceUsage(sessionId) {
  return apiRequest('/api/usage/tick', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function stopVoiceUsage(sessionId) {
  return apiRequest('/api/usage/stop', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

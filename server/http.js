import { createClient } from '@supabase/supabase-js';

const PROFILE_SELECT = 'id,email,display_name,voice_credits,created_at,updated_at';
const SUBSCRIPTION_SELECT = 'id,user_id,plan_id,status,current_period_start,current_period_end,created_at,updated_at';
const desktopOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'null']);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export function setCors(req, res) {
  const origin = req.headers.origin || '*';
  const allowedOrigin = allowedOrigins.length === 0 || allowedOrigins.includes(origin) || desktopOrigins.has(origin) ? origin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleOptions(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}

export function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

export function sendError(res, status, message, code = 'API_ERROR', details = undefined) {
  sendJson(res, status, { error: { code, message, details } });
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }

  return {};
}

export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body);
  }

  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body));
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function readRawJsonBody(req) {
  const rawBody = await readRawBody(req);
  const bodyText = rawBody.toString('utf8');

  return {
    rawBody,
    payload: bodyText.trim() ? JSON.parse(bodyText) : {},
  };
}

function decodeJwtPayload(token) {
  const payload = token?.split('.')?.[1];

  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function supabaseServiceKeyRole() {
  return decodeJwtPayload(process.env.SUPABASE_SERVICE_ROLE_KEY)?.role || '';
}

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on the Vercel backend.');
    error.status = 500;
    error.code = 'SUPABASE_ADMIN_CONFIG_MISSING';
    throw error;
  }

  const serviceKeyRole = supabaseServiceKeyRole();
  if (serviceKeyRole && serviceKeyRole !== 'service_role') {
    const error = new Error(`SUPABASE_SERVICE_ROLE_KEY is configured with a "${serviceKeyRole}" JWT. Use the Supabase service_role secret key on Vercel, not the anon/public key.`);
    error.status = 500;
    error.code = 'SUPABASE_SERVICE_ROLE_KEY_INVALID_ROLE';
    throw error;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireUser(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

  if (!token) {
    const error = new Error('Missing authorization token.');
    error.status = 401;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    const authError = new Error(error?.message || 'Invalid authorization token.');
    authError.status = 401;
    authError.code = 'AUTH_INVALID';
    throw authError;
  }

  return { supabase, user: data.user };
}

export async function ensureProfile(supabase, user) {
  const { data: existingProfile, error: readError } = await supabase
    .from('userw')
    .select(PROFILE_SELECT)
    .eq('id', user.id)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existingProfile) {
    return hydrateProfile(supabase, existingProfile);
  }

  const displayName = user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Morphly User';
  const seedProfile = {
    id: user.id,
    email: user.email,
    display_name: displayName,
  };

  const { data, error } = await supabase
    .from('userw')
    .insert(seedProfile)
    .select(PROFILE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return hydrateProfile(supabase, data);
}

export async function getAccountProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('userw')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  return hydrateProfile(supabase, data);
}

async function hydrateProfile(supabase, profile) {
  if (!profile?.id) {
    return profile;
  }

  const { data: subscription, error } = await supabase
    .from('subscriptionw')
    .select(SUBSCRIPTION_SELECT)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
  const subscriptionActive = Boolean(
    subscription?.status === 'active'
      && subscription?.plan_id === 'unlimited_monthly'
      && periodEnd
      && periodEnd.getTime() > Date.now()
  );

  return {
    ...profile,
    subscription: subscription
      ? {
          ...subscription,
          is_active: subscriptionActive,
        }
      : null,
  };
}

export function handleApiError(res, error) {
  const status = error.status || 500;
  const code = error.code || 'SERVER_ERROR';
  const message = status >= 500 ? error.message || 'The Morphly cloud service could not complete the request.' : error.message;
  sendError(res, status, message, code, status >= 500 ? error.message : undefined);
}

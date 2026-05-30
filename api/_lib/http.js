import { createClient } from '@supabase/supabase-js';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export function setCors(req, res) {
  const origin = req.headers.origin || '*';
  const allowedOrigin = allowedOrigins.length === 0 || allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on the Vercel backend.');
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
    .select('id,email,display_name,voice_credits,created_at,updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existingProfile) {
    return existingProfile;
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
    .select('id,email,display_name,voice_credits,created_at,updated_at')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export function handleApiError(res, error) {
  const status = error.status || 500;
  const code = error.code || 'SERVER_ERROR';
  const message = status >= 500 ? 'The Morphly cloud service could not complete the request.' : error.message;
  sendError(res, status, message, code, status >= 500 ? error.message : undefined);
}

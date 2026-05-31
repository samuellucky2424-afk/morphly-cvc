import { getSupabaseAdmin, handleOptions, setCors, sendJson } from '../server/http.js';

const TABLE_CHECKS = ['userw', 'walletw', 'creditw', 'subscriptionw', 'paymentw', 'usage_sessionw'];

async function checkSupabase() {
  const result = {};

  try {
    const supabase = getSupabaseAdmin();

    for (const table of TABLE_CHECKS) {
      const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      result[table] = error ? { ok: false, code: error.code, message: error.message } : { ok: true };
    }
  } catch (error) {
    result.connection = { ok: false, code: error.code || 'SUPABASE_CHECK_FAILED', message: error.message };
  }

  return result;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCors(req, res);
  const includeDeepCheck = req.query?.deep === '1' || req.url?.includes('deep=1');
  sendJson(res, 200, {
    ok: true,
    service: 'morphly-api',
    config: {
      supabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      flutterwavePublicKey: Boolean(process.env.FLUTTERWAVE_PUBLIC_KEY),
      flutterwaveSecretKey: Boolean(process.env.FLUTTERWAVE_SECRET_KEY),
    },
    supabase: includeDeepCheck ? await checkSupabase() : undefined,
    time: new Date().toISOString(),
  });
}

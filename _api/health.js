import { getSupabaseAdmin, handleOptions, setCors, sendJson } from '../server/http.js';

const TABLE_CHECKS = ['userw', 'walletw', 'creditw', 'subscriptionw', 'paymentw', 'usage_sessionw'];
const COLUMN_CHECKS = {
  userw: 'id,email,display_name,voice_credits,created_at,updated_at',
  subscriptionw: 'id,user_id,plan_id,status,current_period_start,current_period_end,created_at,updated_at',
  paymentw: 'id,user_id,plan_id,amount,currency,credits,provider,provider_reference,tx_ref,status,raw_response,created_at,updated_at',
  usage_sessionw: 'id,user_id,status,started_at,ended_at,last_billed_at,billed_minutes,credits_spent,created_at,updated_at',
};

function supabaseProjectRef() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';

  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith('.supabase.co') ? host.replace('.supabase.co', '') : host;
  } catch {
    return '';
  }
}

async function checkSupabase() {
  const result = {};

  try {
    const supabase = getSupabaseAdmin();

    for (const table of TABLE_CHECKS) {
      const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      result[table] = error ? { ok: false, code: error.code, message: error.message } : { ok: true };
    }

    result.columns = {};
    for (const [table, columns] of Object.entries(COLUMN_CHECKS)) {
      const { error } = await supabase.from(table).select(columns, { head: true }).limit(1);
      result.columns[table] = error ? { ok: false, code: error.code, message: error.message } : { ok: true };
    }

    result.rpc = {};
    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    const fakeSessionId = '00000000-0000-0000-0000-000000000001';
    const startCheck = await supabase.rpc('start_voice_usagew', {
      target_user_id: fakeUserId,
      credits_per_minute: 2,
    });
    result.rpc.start_voice_usagew = startCheck.error ? { ok: false, code: startCheck.error.code, message: startCheck.error.message } : { ok: true };

    const billCheck = await supabase.rpc('bill_voice_usagew', {
      target_user_id: fakeUserId,
      usage_session_id: fakeSessionId,
      credits_per_minute: 2,
    });
    result.rpc.bill_voice_usagew = billCheck.error ? { ok: false, code: billCheck.error.code, message: billCheck.error.message } : { ok: true };

    const stopCheck = await supabase.rpc('stop_voice_usagew', {
      target_user_id: fakeUserId,
      usage_session_id: fakeSessionId,
    });
    result.rpc.stop_voice_usagew = stopCheck.error ? { ok: false, code: stopCheck.error.code, message: stopCheck.error.message } : { ok: true };
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
      supabaseProjectRef: supabaseProjectRef(),
      supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      flutterwavePublicKey: Boolean(process.env.FLUTTERWAVE_PUBLIC_KEY),
      flutterwaveSecretKey: Boolean(process.env.FLUTTERWAVE_SECRET_KEY),
    },
    supabase: includeDeepCheck ? await checkSupabase() : undefined,
    time: new Date().toISOString(),
  });
}

import { handleOptions, setCors, sendJson } from '../server/http.js';

export default function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCors(req, res);
  sendJson(res, 200, {
    ok: true,
    service: 'morphly-api',
    config: {
      supabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      flutterwavePublicKey: Boolean(process.env.FLUTTERWAVE_PUBLIC_KEY),
      flutterwaveSecretKey: Boolean(process.env.FLUTTERWAVE_SECRET_KEY),
    },
    time: new Date().toISOString(),
  });
}

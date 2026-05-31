import { handleOptions, setCors, sendJson } from './_lib/http.js';

export default function handler(req, res) {
  if (handleOptions(req, res)) {
    return;
  }

  setCors(req, res);
  sendJson(res, 200, {
    ok: true,
    service: 'morphly-api',
    time: new Date().toISOString(),
  });
}

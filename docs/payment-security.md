# Morphly Payment Security

Morphly never grants credits from the frontend alone.

## Runtime Flow

1. The signed-in app asks `POST /api/payments/create` for a Morphly checkout reference.
2. Flutterwave Checkout runs in the frontend with the public key only.
3. The frontend callback sends `transactionId`, `txRef`, and `planId` to `POST /api/payments/verify`.
4. The Vercel backend calls Flutterwave's verify endpoint with `FLUTTERWAVE_SECRET_KEY`.
5. Credits or subscription time are applied only after the backend verifies:
   - Flutterwave status is successful.
   - The Flutterwave `tx_ref` matches a Morphly-created pending payment.
   - The payment belongs to the signed-in user when called from the app.
   - Amount and currency match the stored Morphly checkout.
   - The stored checkout plan still matches the server-side plan catalog.

## Webhook Recovery

Configure Flutterwave to send payment events to:

```text
https://morphly-cvc.vercel.app/api/payments/webhook
```

Set this Vercel environment variable to the Flutterwave webhook secret hash:

```text
FLUTTERWAVE_WEBHOOK_SECRET
```

`FLW_SECRET_HASH` is also supported as a compatibility alias.

The webhook verifies `flutterwave-signature` with HMAC-SHA256 over the raw request body before it processes anything. It also supports Flutterwave's older `verif-hash` header format for dashboards using that flow.

The webhook still calls Flutterwave's verify endpoint before applying credits, so a forged webhook body cannot create credits.

## Secret Placement

Server-only Vercel variables:

```text
SUPABASE_SERVICE_ROLE_KEY
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET
```

Frontend-safe variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_FLUTTERWAVE_PUBLIC_KEY
VITE_MORPHLY_API_URL
```

Never expose the Supabase service-role key or Flutterwave secret key in any `VITE_` variable.

# KCB Buni integration reference

This directory contains the official KCB Buni Swagger exports and supporting notification documents used by the payment implementation. Provider documents are authoritative when they differ from community examples.

## Implemented endpoints

- `kcbTillNotification`: signed Paybill/Till callback. Its deployed Firebase Functions URL is registered with KCB.
- `kcbStkCallback`: M-PESA Express result callback. Configure its deployed HTTPS URL as `KCB_STK_CALLBACK_URL`.
- `requestKcbStkPush`: authenticated callable function used to initiate an optional STK prompt.
- `reconcileKcbPayment` and `rejectKcbPayment`: administrator-only callable reconciliation commands.

An accepted notification or STK request does not credit a member. Successful provider transactions enter the administrator reconciliation queue and only the trusted reconciliation command updates financial records.

## Non-secret runtime parameters

- `KCB_SHARED_REFERENCE` (currently `7969138`)
- `KCB_CURRENCY` (default `KES`)
- `KCB_TOKEN_URL`
- `KCB_STK_URL`
- `KCB_STK_CALLBACK_URL`
- `KCB_ORG_SHORTCODE` (currently `522533`)
- `KCB_STK_ROUTE_CODE` (default `207`; confirm with KCB)

Use environment-specific Firebase parameter configuration for URLs and identifiers.

## Managed secrets

Configure these with Firebase Secret Manager; never add their values to source control, issues, logs, screenshots, or client configuration:

- `KCB_PUBLIC_KEY`
- `KCB_CONSUMER_KEY`
- `KCB_CONSUMER_SECRET`
- `KCB_STK_CALLBACK_TOKEN` (a high-entropy random token embedded in the registered STK callback URL)

The public key is not confidential, but storing it as managed configuration allows controlled rotation and avoids stale keys in deployments.

## Before UAT or production

Follow GitHub issue #25. In particular, obtain KCB's signing certificate, confirm the exact signed bytes, register the public callback URLs, deploy the Firestore index, verify callback retry/reversal behavior, and retain KCB's endpoint approval evidence.

The STK callback requires the secret URL token, is correlated with a server-created pending request, and always requires reconciliation. Rotate the token by updating the secret and callback registration together. If KCB supplies a signature, mTLS, or allow-list contract, enforce it in addition to or instead of the URL token before production enablement.

## Deployed development simulator

The administrator-only simulator signs a synthetic Till payload and sends it through the real deployed callback. It never bypasses signature verification.

Generate a development-only pair:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/tmbwa-kcb-dev-private.pem
openssl pkey -in /tmp/tmbwa-kcb-dev-private.pem -pubout -out /tmp/tmbwa-kcb-dev-public.pem
```

In the Firebase **development project only**, configure:

- `KCB_DEV_PRIVATE_KEY`: contents of the synthetic private PEM (managed secret).
- `KCB_PUBLIC_KEY`: contents of the matching synthetic public PEM (managed secret).
- `APP_ENV=development`.
- `KCB_DEV_MOCK_ENABLED=true`.
- `KCB_TILL_CALLBACK_URL`: deployed HTTPS URL ending in `/kcbTillNotification`.
- `KCB_DEV_ALLOWED_CALLBACK_ORIGIN`: exact HTTPS origin of that URL.

Deploy `kcbTillNotification` and `sendKcbDevTillNotification`, sign in as an administrator, and use **KCB reconciliation → Development test payment**. The item appears unresolved and must use the normal reconciliation workflow.

Never configure `KCB_DEV_PRIVATE_KEY` or enable the simulator in UAT or production. After testing, set `KCB_DEV_MOCK_ENABLED=false`, remove the private-key secret if it is no longer needed, and securely delete the temporary private-key file. Real KCB callbacks require KCB's environment-specific public key.

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

The public key is not confidential, but storing it as managed configuration allows controlled rotation and avoids stale keys in deployments.

## Before UAT or production

Follow GitHub issue #25. In particular, obtain KCB's signing certificate, confirm the exact signed bytes, register the public callback URLs, deploy the Firestore index, verify callback retry/reversal behavior, and retain KCB's endpoint approval evidence.

The current STK callback is correlated with a server-created pending request and always requires reconciliation. If KCB supplies an STK callback signature, mTLS, or allow-list contract, enforce it before production enablement.

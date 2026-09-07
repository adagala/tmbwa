# KCB Buni integration reference

This directory contains the official KCB Buni Swagger exports and supporting notification documents used by the payment implementation. Provider documents are authoritative when they differ from community examples.

## Implemented endpoints

- `kcbTillNotification`: Paybill/Till callback. KCB Sandbox sends unsigned mock notifications; production authentication remains fail-closed pending KCB's confirmed contract.
- `kcbStkCallback`: M-PESA Express result callback. Configure its deployed HTTPS URL as `KCB_STK_CALLBACK_URL`.
- `requestKcbStkPush`: authenticated callable function used to initiate an optional STK prompt.
- `reconcileKcbPayment` and `rejectKcbPayment`: administrator-only callable reconciliation commands.

An accepted notification or STK request does not credit a member. Successful provider transactions enter the administrator reconciliation queue and only the trusted reconciliation command updates financial records.

## Non-secret runtime parameters

- `KCB_SHARED_REFERENCE` (the account/till number included at the start of STK
  `invoiceNumber`; currently `7969138`)
- `KCB_CURRENCY` (default `KES`)
- `KCB_TOKEN_URL`
- `KCB_STK_URL`
- `KCB_STK_CALLBACK_URL`
- `KCB_STK_ROUTE_CODE` (default `207`; confirm with KCB)
- `APP_ENV` (default `production`; set to `development` only in the Firebase development project)
- `KCB_DEV_MOCK_ENABLED` (default `false`; set to `true` only for Sandbox IPN testing)
- `KCB_PUBLIC_KEY` (required only when the provider contract uses RSA callback signatures)

Use environment-specific Firebase parameter configuration for URLs and identifiers.

## Managed secrets

Configure these with Firebase Secret Manager; never add their values to source control, issues, logs, screenshots, or client configuration:

- `KCB_CONSUMER_KEY`
- `KCB_CONSUMER_SECRET`
- `KCB_STK_CALLBACK_TOKEN` (a high-entropy random token embedded in the registered STK callback URL)

The public key is not confidential. It is ordinary managed configuration and is not required for KCB Sandbox IPN testing.

### Migrating an existing `KCB_PUBLIC_KEY` secret

Before deploying this version to an environment that previously configured `KCB_PUBLIC_KEY` in Firebase Secret Manager, copy that public value into the new string parameter. Run:

```bash
firebase functions:secrets:access KCB_PUBLIC_KEY
```

Copy the complete public PEM into `functions/.env.<firebase-project-id>` as a quoted multiline `KCB_PUBLIC_KEY` value. Do not commit environment-specific configuration. Complete this migration before deploying; otherwise signed Till callbacks fail closed with HTTP 401. After the updated default codebase is deployed and callback verification is confirmed, the obsolete Secret Manager version can be removed according to the project's credential-retirement process.

## Before UAT or production

Follow GitHub issue #25. In particular, confirm KCB's production callback-authentication contract, obtain a signing certificate only if that contract requires one, register the public callback URLs, deploy the Firestore index, verify callback retry/reversal behavior, and retain KCB's endpoint approval evidence. Production remains fail-closed: unsigned callbacks are accepted only when both `APP_ENV=development` and `KCB_DEV_MOCK_ENABLED=true`.

The STK callback requires the secret URL token, is correlated with a server-created pending request, and always requires reconciliation. Rotate the token by updating the secret and callback registration together. If KCB supplies a signature, mTLS, or allow-list contract, enforce it in addition to or instead of the URL token before production enablement.

## Deployed development simulator

The administrator-only simulator sends an unsigned synthetic Till payload through the real deployed callback, matching KCB Buni Sandbox behavior. The callback uses the same parsing, validation, idempotent persistence, and reconciliation path as production; only its environment-specific authentication gate differs.

In the Firebase **development project only**, configure:

- `APP_ENV=development`.
- `KCB_DEV_MOCK_ENABLED=true`.
- `KCB_TILL_CALLBACK_URL`: deployed HTTPS URL ending in `/kcbTillNotification`.
- `KCB_DEV_ALLOWED_CALLBACK_ORIGIN`: exact HTTPS origin of that URL.

Set `VITE_APP_ENV=development` and `VITE_KCB_DEV_MOCK_ENABLED=true` in the development web build so the simulator control is visible.

The simulator lives in the separate Firebase `development-tools` codebase. Normal UAT and production configuration must leave the unsigned Sandbox gate disabled.

Deploy the normal callback and the development tools separately:

```bash
firebase deploy --only functions:default:kcbTillNotification
firebase deploy --only functions:development-tools
```

The default Functions package deploy script intentionally selects `functions:default`. Never replace it with the broad `--only functions` selector, because that also deploys the development-tools codebase.

Sign in as an administrator and use **KCB reconciliation → Development test payment**. The item appears unresolved and must use the normal reconciliation workflow.

Never deploy the `development-tools` codebase or enable either Sandbox flag in UAT or production. After testing, set both server and client enabled flags to `false` and remove the development-tools function if it is no longer needed. Do not enable production callbacks until KCB's production authentication requirements have been confirmed and implemented.

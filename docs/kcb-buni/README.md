# KCB Buni integration reference

This directory contains the official KCB Buni Swagger exports and supporting notification documents used by the payment implementation. Provider documents are authoritative when they differ from community examples.

## Implemented endpoints

- `kcbTillNotification`: Paybill/Till callback. KCB signs every production notification with SHA256withRSA over the request body in the `Signature` header; the callback verifies it with `KCB_PUBLIC_KEY`. Notifications with a missing or invalid signature are acknowledged to KCB but not stored, and are logged with reason `Invalid signature.` KCB Sandbox sends unsigned mock notifications.
- `kcbStkCallback`: M-PESA Express result callback. Configure its deployed HTTPS URL as `KCB_STK_CALLBACK_URL`.
- `requestKcbStkPush`: authenticated callable function used to initiate an optional STK prompt.
- `reconcileKcbPayment` and `rejectKcbPayment`: administrator-only callable reconciliation commands.

An accepted notification or STK request does not credit a member. Successful provider transactions enter the administrator reconciliation queue and only the trusted reconciliation command updates financial records.

KCB sends a Till notification for STK payments too. Its `header.originatorConversationID` carries the M-Pesa receipt, so a Till notification is stored under that receipt when present (the KCB FT reference from `transactionID` is kept as `kcbTransactionReference`). The Till notification and STK callback for one payment therefore share a `kcb_payment_notifications` document, whichever arrives first. Notifications without a receipt-shaped conversation ID are keyed by `transactionID`. Reconciliation refuses an older FT-keyed Till item whose M-Pesa receipt already has its own document; reject those instead.

Whichever source arrives second never overwrites the payment details the first one reported (`messageId`, `channelCode`, `billReference`, `payerPhone`, `payerName`, `currency`, `transactionDate`, `transactionType`, `paidAt`, `mpesaReceiptNumber`, `receivedAt`); it only fills those that are missing or empty. When an untouched Till notification with the same amount already holds the receipt, the STK callback settles the payment automatically on that document, exactly as if it had arrived first. If the amounts differ, the Till amount is kept, the callback amount is stored as `stkCallbackAmount`, and the item is flagged `payment_details_mismatch` for an administrator.

| Field | Till notification | STK callback |
| --- | --- | --- |
| `mpesaReceiptNumber` | `originatorConversationID`, when it is receipt-shaped | `MpesaReceiptNumber` |
| `paidAt` | parsed from `transactionDate` when it parses | parsed from `TransactionDate` when it parses |
| `transactionDate` | raw provider value, e.g. `Mon May 19 13:30:54 EAT 2025` | raw provider value, e.g. `20250519133054` |
| `kcbMessageId`, `kcbChannelCode` | `header.messageID`, `header.channelCode` | — |
| `kcbTransactionReference` | `transactionID` (FT reference) | — |
| `checkoutRequestId`, `merchantRequestId` | — | `CheckoutRequestID`, `MerchantRequestID` |
| `messageId`, `channelCode` | as reported by whichever source arrived first (legacy; prefer the explicit fields) | |

All of these fields are optional; documents written before them fall back to the older fields.

## Till member suggestions

A Till notification is matched on the payer phone against the server-owned `members/{id}.phoneNormalized`, a copy of the member's profile `phonenumber` in the `+2547XXXXXXXX` / `+2541XXXXXXXX` form. The `newMember` and `updateMember` triggers keep it current, and remove it when the profile number is not a valid Kenyan mobile; clients cannot write it. One matching member is stored as `suggestedMemberId` with `matchReason: 'unique_profile_phone'`; no match stores `no_verified_phone_match` and several store `ambiguous_phone_match`, both without a suggestion. Notifications stored earlier may carry `unique_verified_phone`. A suggestion is never applied automatically: an administrator confirms the member when reconciling. Existing notifications are not re-matched.

To enable it in an environment:

1. Deploy the default Functions codebase.
2. From `functions/`, set `GOOGLE_APPLICATION_CREDENTIALS` to that environment's service-account file and `GOOGLE_CLOUD_PROJECT` to its project ID (the script refuses to run without it), then run `npm run backfill:member-phone-normalized` (dry run). Check the `Target project` line it prints first, and review the updated, unchanged, invalid and duplicate counts. It prints member IDs only, never phone numbers.
3. Run `npm run backfill:member-phone-normalized -- --apply`. It is safe to re-run.
4. In development, send a synthetic Till notification from a member's profile phone and confirm it is suggested for that member.

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
- `KCB_PUBLIC_KEY` (required in UAT and production; the PEM KCB supplied as `kcb_prod_h2h_public_key.pem`)

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

## Source IP allowlist

KCB sends Till notifications only from `196.216.222.14`, `196.216.222.15`, `196.216.223.14`, and `196.216.223.15`. The allowlist is not enforced yet: behind Google's front end, `request.ip` and the leftmost `X-Forwarded-For` entries can be supplied by the caller. Each request logs `KCB notification source.` with `sourceIp` and `forwardedFor`; once real KCB traffic confirms which entry holds the true client address, enforce the allowlist in addition to the signature.

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

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

## Development STK simulator

The development-tools codebase also simulates M-PESA Express end to end, so **Add funds** and **Pay balance via STK** can be clicked through in the development app. No production code changes: the development project points `requestKcbStkPush` at a mock KCB API, and a simulated phone action posts the STK result to the real deployed `kcbStkCallback`.

1. `kcbDevMockApi` (HTTPS) stands in for KCB. `POST /token` returns a synthetic access token. `POST /stkpush` validates the STK request body, returns an accepted response (`header.statusCode = '0'`, `ResponseCode = 0`, new `MerchantRequestID` and `CheckoutRequestID`), and records a pending prompt in `kcb_dev_stk_prompts/{CheckoutRequestID}`. It records a prompt only when the request's `callbackUrl` is the configured `KCB_STK_CALLBACK_URL` carrying the correct `KCB_STK_CALLBACK_TOKEN`, which only `requestKcbStkPush` holds. The token is never stored or logged.
2. `listKcbDevStkPrompts` (callable) lists open prompts.
3. `resolveKcbDevStkPrompt` (callable) takes `promptId` and `outcome`: `approve` posts `ResultCode 0` with the amount, a deterministic `DEV…` receipt, the phone and the transaction date; `cancel` posts `ResultCode 1032`; `timeout` posts `ResultCode 1037`. The prompt is claimed in a transaction and marked `resolved`, so answering it again with the same outcome is a no-op, and a different outcome is refused. Because the receipt is derived from the prompt, a retried approval cannot create a second payment either. If the callback cannot be reached or fails, the claim lapses after 30 seconds and the same outcome can be retried. Only a 401 from the callback releases the prompt for any outcome, because nothing was recorded.

Prompt access: a super admin may list and answer any prompt. A member may list and answer the prompts for their own account or that they requested, as if holding the phone. Firestore rules deny all client access to `kcb_dev_stk_prompts`; the UI reads it only through the callables.

Every simulator function refuses to run unless `APP_ENV=development` and `KCB_DEV_MOCK_ENABLED=true`. The mock API and `resolveKcbDevStkPrompt` also require `KCB_STK_CALLBACK_URL` to be HTTPS, to share the exact origin of `KCB_DEV_ALLOWED_CALLBACK_ORIGIN`, and to end in `/kcbStkCallback`.

### Configuration (development project only)

Default codebase (`functions/.env.<dev-project-id>`, not committed):

- `KCB_TOKEN_URL=https://<region>-<dev-project-id>.cloudfunctions.net/kcbDevMockApi/token`
- `KCB_STK_URL=https://<region>-<dev-project-id>.cloudfunctions.net/kcbDevMockApi/stkpush`
- `KCB_STK_CALLBACK_URL`: deployed HTTPS URL of `kcbStkCallback`, as for real STK.
- `KCB_CONSUMER_KEY` and `KCB_CONSUMER_SECRET` must still be set as secrets, but the mock ignores their values, so use placeholders rather than real KCB credentials.

Development-tools codebase (`functions-dev/.env.<dev-project-id>`, not committed):

- `APP_ENV=development`
- `KCB_DEV_MOCK_ENABLED=true`
- `KCB_STK_CALLBACK_URL`: the same `kcbStkCallback` URL as above.
- `KCB_DEV_ALLOWED_CALLBACK_ORIGIN`: exact HTTPS origin of that URL.
- `KCB_STK_CALLBACK_TOKEN` is read from the same Secret Manager secret as the default codebase.

Web build: `VITE_APP_ENV=development` and `VITE_KCB_DEV_MOCK_ENABLED=true`. The **Simulated M-Pesa prompts** panel then appears under **KCB reconciliation → Development test payment** (all open prompts), in the **Add funds** dialog and in the contribution drawer after an STK request (that request's prompt only).

### Deploy

```bash
firebase deploy --only functions:development-tools
firebase deploy --only functions:default:requestKcbStkPush,functions:default:kcbStkCallback
```

Deploy the development-tools codebase first so the mock API URL exists, then redeploy the two default functions so they pick up the `KCB_TOKEN_URL` and `KCB_STK_URL` overrides.

### Try it

1. Sign in as a member, open **Add funds**, enter an amount and send the prompt.
2. In the panel, choose **Approve**. The production callback settles unpaid contributions oldest first, keeps the remainder as unreserved credit, and the dialog shows **Top-up received**.
3. **Cancel** or **Time out** marks the STK request `cancelled` or `timed_out` and records no payment.

`npm run test:integration` (`tests/kcbStkSimulator.integration.test.ts`) runs the same chain against the Firestore emulator.

### Turn it off

1. Remove the `KCB_TOKEN_URL` and `KCB_STK_URL` overrides (or point them at the KCB Sandbox) and redeploy `requestKcbStkPush`.
2. Set `KCB_DEV_MOCK_ENABLED=false` for the development-tools codebase and redeploy it, or delete its functions with `firebase functions:delete kcbDevMockApi listKcbDevStkPrompts resolveKcbDevStkPrompt`. In the development-tools codebase this flag also disables `sendKcbDevTillNotification`; the default codebase's own `KCB_DEV_MOCK_ENABLED`, which allows unsigned Sandbox Till notifications, is configured separately.
3. Set `VITE_KCB_DEV_MOCK_ENABLED=false` in the development web build.

Leftover `kcb_dev_stk_prompts` documents hold no financial state and can be deleted.

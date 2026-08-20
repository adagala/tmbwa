# KCB-only payments and legacy contribution corrections

Current member payments must enter the application through the KCB notification and reconciliation workflow. The legacy `recordContributionPayment` and `adjustMemberBalance` Functions remain deployed only to reject older clients with a clear error; they no longer mutate financial data.

## Legacy corrections

Administrators can use **Correct legacy record** from a contribution's details when a verified historical contribution state is missing or incorrect. A correction records a delta without creating a payment, receipt, KCB notification, or KCB credit.

The trusted `correctLegacyContribution` Function atomically writes an idempotency command, a canonical record under `members/{memberId}/legacy_corrections/{correctionId}`, the contribution state and history summary, member aggregate totals, monthly statistics, and an immutable audit event. Contributions linked to KCB or shared receipts are rejected and must use receipt reversal instead.

`reverseLegacyContributionCorrection` restores the recorded before-state only when the correction is still the contribution's explicit active correction and the state still matches. Each correction records the previously active correction ID, so reversals must occur in last-in-first-out order and restore the preceding correction marker. Reversals are idempotent and audited; correction records are marked reversed rather than deleted.

## Inventory

`listLegacyContributionInventory` is a read-only administrator callable. It scans at most 500 contribution documents per request and reports invalid totals, missing payment evidence, and KCB/shared-receipt linkage. It does not modify data. Results are ordered by document path. Pass the returned `nextCursor` as `cursor` on the next request until it returns `null`:

```ts
const firstPage = await listLegacyContributionInventory({ limit: 200 });
const nextPage = await listLegacyContributionInventory({
  limit: 200,
  cursor: firstPage.nextCursor,
});
```

Review all pages before applying individual corrections or designing a bulk migration.

## Development deployment

Deploy the affected Functions before or together with hosting:

```bash
firebase deploy --only functions:recordContributionPayment,functions:adjustMemberBalance,functions:correctLegacyContribution,functions:reverseLegacyContributionCorrection,functions:listLegacyContributionInventory,hosting --project dev
```

No new secrets, parameters, Firestore indexes, or destructive migrations are required.

## Member STK contribution flow

Member contribution payment uses the KCB STK request and callback flow and remains consistent with the KCB-only payment policy.

### Request phase

- Members can request STK only for their own contribution unless the caller is an administrator.
- The request is idempotent by `requestId`. Reusing an existing `requestId` is accepted only when `memberId`, `contributionId`, and `amount` are identical.
- Stale initiating or outcome-unknown retries retain the original provider `messageId` and invoice number; the contribution remains locked while the bounded recovery lease is active.
- Member status must be active.
- Phone target is always the member profile phone (`members/{memberId}.phonenumber`) after Kenyan phone normalization.
- `amount` must be a positive integer and cannot exceed the contribution balance.

### Callback phase

- Callback correlation uses both `CheckoutRequestID` and `MerchantRequestID`.
- Non-success callback result codes are persisted as explicit statuses: `failed`, `cancelled`, or `timed_out`.
- Successful callbacks are accepted only when callback `Amount`, `PhoneNumber`, and `MpesaReceiptNumber` match the pending STK request details.
- Mismatch scenarios are persisted as `rejected` and audited.

### Reconciliation lock for STK-originated notifications

- STK callback notifications store authoritative `memberId` and `contributionId` linkage.
- When source is `stk_callback`, reconciliation is locked to exactly one allocation:
  - allocation contribution must equal the callback-linked contribution
  - allocation amount must equal the callback amount
- This prevents relinking STK-originated payments to a different member or contribution.

### Audit trail

- Request creation, callback processing outcomes, and callback rejections are auditable.
- The expected trace is: STK request -> callback status -> payment notification -> contribution reconciliation.

## Deployment steps for issue #42

Deploy from a reviewed branch state after tests pass.

### 1) Pre-deploy checks

```bash
npm ci
npm ci --prefix functions
npm run test:unit
npm run build --workspace=functions
npm run build
```

### 2) Verify required runtime config and secrets

The STK flow relies on these values in the target Firebase project:

- `KCB_STK_CALLBACK_URL`
- `KCB_STK_CALLBACK_TOKEN`
- `KCB_CONSUMER_KEY`
- `KCB_CONSUMER_SECRET`
- `KCB_STK_URL`
- `KCB_TOKEN_URL`
- `KCB_ORG_SHORTCODE`
- `KCB_STK_ROUTE_CODE`

If needed, set or rotate secrets before deploy:

```bash
firebase functions:secrets:set KCB_STK_CALLBACK_TOKEN
firebase functions:secrets:set KCB_CONSUMER_KEY
firebase functions:secrets:set KCB_CONSUMER_SECRET
```

### 3) Deploy only affected Functions plus hosting

```bash
firebase deploy --only functions:reconcileKcbPayment,functions:allocateKcbPaymentCredit,functions:rejectKcbPayment,functions:requestKcbStkPush,functions:kcbStkCallback,functions:reverseContributionPayment,functions:correctLegacyContribution,functions:reverseLegacyContributionCorrection,functions:removeContribution,hosting --project <project-id>
```

### 4) Post-deploy verification

- Verify member STK request from the profile contribution dialog.
- Confirm callback updates one `kcb_stk_requests/{requestId}` document status exactly once.
- Confirm STK-origin notifications are locked to the callback-linked contribution during reconciliation.
- Confirm duplicate callback replay does not create duplicate payment records.

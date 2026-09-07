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

No new secrets, parameters, Firestore indexes, or destructive migrations are required. The STK rollout does require the idempotent active-request lock backfill documented below.

## Member STK contribution flow

Member contribution payment uses the KCB STK request and callback flow and remains consistent with the KCB-only payment policy.

### Request phase

- Members can request STK only for their own contribution unless the caller is an administrator.
- The request is idempotent by `requestId`. Reusing an existing `requestId` is accepted only when `memberId`, `contributionId`, and `amount` are identical.
- Stale pre-dispatch `initiating` retries retain the original provider `messageId` and invoice number. Before the provider call, the request is durably moved to `dispatching`; `dispatching` and `outcome_unknown` requests are never redispatched and remain locked until an administrator verifies the provider outcome and resolves them.
- Member status must be active.
- Phone target is always the member profile phone (`members/{memberId}.phonenumber`) after Kenyan phone normalization.
- `amount` must be a positive integer and cannot exceed the contribution balance.

### Callback phase

- Callback correlation uses both `CheckoutRequestID` and `MerchantRequestID`.
- Non-success callback result codes are persisted as explicit statuses: `failed`, `cancelled`, or `timed_out`.
- Successful callbacks whose `Amount`, `PhoneNumber`, or `MerchantRequestID` does not match the pending request are quarantined for administrator review instead of being silently rejected.
- Ambiguous merchant-request or terminal-receipt linkage remains `outcome_unknown` and keeps the contribution locked until an administrator verifies the provider outcome.
- Quarantined callbacks retain the collected receipt in the unresolved reconciliation queue only after exact checkout-request correlation.

### Reconciliation lock for STK-originated notifications

- STK callback notifications store authoritative `memberId` and `contributionId` linkage.
- When source is `stk_callback`, reconciliation is locked to the callback-linked contribution:
  - allocation contribution must equal the callback-linked contribution
- The contribution allocation is the minimum of the callback amount, requested amount, and current outstanding balance.
- Any callback amount above that allocation is retained as member account credit instead of being discarded or forced beyond the outstanding balance.
- This prevents relinking STK-originated payments to a different member or contribution.

### Audit trail

- Request creation, callback processing outcomes, and callback rejections are auditable.
- The expected trace is: STK request -> callback status -> payment notification -> contribution reconciliation.

### Resolving an ambiguous provider outcome

- Administrators can review eligible `dispatching` and `outcome_unknown` requests under **KCB payment reconciliation -> Ambiguous STK provider outcomes**.
- Use **Confirm no payment and release lock** only after KCB provides evidence that the request was not accepted and no member charge occurred; record that evidence in the required reason.
- The backend accepts this action only for an expired dispatch or an outcome caused by a lost/incomplete provider response.
- Confirmed successful callbacks with merchant or receipt-linkage conflicts are excluded from this action and remain locked for financial investigation and reconciliation.

## Deployment steps for issue #42

Deploy from a reviewed branch state after tests pass.

### 1) Pre-deploy checks

- The first new STK request for a contribution checks legacy active requests. If an `initiating`, `dispatching`, `outcome_unknown`, `pending`, or `succeeded_pending_reconciliation` request predates payment locks, the callable backfills its lock and refuses to send another prompt.
- Successful callbacks whose provider response was lost are correlated only when exactly one `dispatching` request matches the callback amount and phone. Non-unique orphan callbacks remain quarantined and return a retryable response until correlation is available.

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
- `KCB_SHARED_REFERENCE` (the account/till number used in STK invoice numbers)
- `KCB_STK_ROUTE_CODE`

If needed, set or rotate secrets before deploy:

```bash
firebase functions:secrets:set KCB_STK_CALLBACK_TOKEN
firebase functions:secrets:set KCB_CONSUMER_KEY
firebase functions:secrets:set KCB_CONSUMER_SECRET
```

### 3) Deploy the lock-aware STK entry points first

```bash
firebase deploy --only firestore:indexes --project <project-id>
firebase deploy --only functions:requestKcbStkPush,functions:kcbStkCallback,functions:resolveKcbStkUnknownOutcome --project <project-id>
```

Wait for the `kcb_stk_requests(memberId, contributionId)` index to finish building before deploying the Functions. This scopes legacy-request protection to one member contribution and prevents new lockless requests while the migration runs.

### 4) Backfill every active legacy STK lock

Use Application Default Credentials for the target project. Run the dry-run first; it fails without writing if duplicate active requests or a conflicting active lock require manual investigation.

```bash
cd functions
GOOGLE_CLOUD_PROJECT=<project-id> npm run migrate:stk-locks
GOOGLE_CLOUD_PROJECT=<project-id> npm run migrate:stk-locks -- --apply
cd ..
```

Lease-less legacy `initiating` requests receive an expired recovery lease, allowing the original request ID to retry safely. Each write transaction re-reads the request and lock, skips newly terminal requests, releases any stale owned lock, and refuses new ownership conflicts. Re-run the dry-run after any interrupted or failed apply and require it to report the expected active locks before continuing.

### 5) Deploy guarded mutations, rules, and hosting

```bash
firebase deploy --only functions:reconcileKcbPayment,functions:allocateKcbPaymentCredit,functions:rejectKcbPayment,functions:reverseContributionPayment,functions:correctLegacyContribution,functions:reverseLegacyContributionCorrection,functions:removeContribution,functions:deleteMemberSafely,functions:deleteMember,firestore:rules,hosting --project <project-id>
```

Do not deploy these guarded mutation handlers before the backfill completes successfully.

### 6) Post-deploy verification

- Verify member STK request from the profile contribution dialog.
- Confirm callback updates one `kcb_stk_requests/{requestId}` document status exactly once.
- Confirm STK-origin notifications are locked to the callback-linked contribution during reconciliation.
- Confirm duplicate callback replay does not create duplicate payment records.

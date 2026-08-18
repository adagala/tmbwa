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

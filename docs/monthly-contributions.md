# Monthly contribution generation

The scheduled job runs at midnight on the first day of each month in `Africa/Nairobi`. It selects active members only and processes them in bounded groups of 50 independent Firestore transactions, avoiding the 500-write batch ceiling.

Each contribution path is deterministic: `members/{memberId}/contributions/{YYYY-MM-01}`. A transaction skips an existing document, so scheduler retries and manual reruns cannot charge a member twice. Statistics are recomputed from the month's persisted contributions after processing, so partial retries converge on the same totals.

Rates are stored in `contribution_rates` with a positive numeric `amount` and an `effectiveFrom` value formatted as `YYYY-MM-01`. The newest rate effective on or before the target month is used. Until a rate document exists, the historical KES 500 default remains in effect for backward compatibility.

Example:

```json
{
  "amount": 750,
  "effectiveFrom": "2027-01-01",
  "updatedBy": "administrator-uid"
}
```

Rate documents cannot be deleted through the client, preserving the effective-dated history.

# Audit events

Sensitive financial commands append an immutable event in `audit_events/{requestId}` in the same Firestore transaction as the domain change. The request ID is both the command idempotency key and the audit event identifier, guaranteeing at most one event per accepted command.

Events contain the actor UID, action, affected member and target, safe financial deltas, and a server timestamp. Events written by an officer's command also contain `actorRoles`, the roles the actor held at the time; system events and events written before role-based permissions have no `actorRoles`. They never contain credentials or authentication tokens. Client SDKs cannot create, edit, or delete events; administrators have read-only access.

Current actions are `payment.recorded`, `payment.reversed`, `contribution.created`, `contribution.removed`, and `balance.adjusted`.

Adding several missing months at once (`createContributions`) is one command but writes one `contribution.created` event per month, at `audit_events/{requestId}-{YYYY-MM-01}`. Each event's `changes` include the amount, the credit applied to that month, `batchRequestId` (the command's request ID) and `batchSize`.

## Beneficiary events

Beneficiary commands write audit events in the same transaction as the change. Their IDs are namespaced by action, for example `audit_events/beneficiary-change-requested-{requestId}`, because a beneficiary request ID may also be used by financial commands. `targetId` is the beneficiary change request ID.

| Action | Actor | `changes` |
| --- | --- | --- |
| `beneficiary.change_requested` | Member | `type`, `beneficiaryCount`, `baseVersion`, `reasonCategory` (when a reason is given) |
| `beneficiary.change_cancelled` | Member | `type` |
| `beneficiary.initial_set` | Administrator | `beneficiaryCount`, `version` |
| `beneficiary.change_approved` | Administrator | `type`, `beneficiaryCount`, `version`, `annualChangeYear` (annual requests only) |
| `beneficiary.change_rejected` | Administrator | `type`, `beneficiaryCount` |

Beneficiary events record IDs and counts only. They never contain beneficiary names, dates of birth, contact details or ID numbers.

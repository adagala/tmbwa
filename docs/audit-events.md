# Audit events

Sensitive financial commands append an immutable event in `audit_events/{requestId}` in the same Firestore transaction as the domain change. The request ID is both the command idempotency key and the audit event identifier, guaranteeing at most one event per accepted command.

Events contain the actor UID, action, affected member and target, safe financial deltas, and a server timestamp. They never contain credentials or authentication tokens. Client SDKs cannot create, edit, or delete events; administrators have read-only access.

Current actions are `payment.recorded`, `payment.reversed`, `contribution.created`, `contribution.removed`, and `balance.adjusted`.

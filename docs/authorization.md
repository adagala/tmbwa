# Authorization matrix

Firestore Security Rules are the authorization boundary. Interface visibility is not authorization.

| Resource | Administrator | Member | Unauthenticated |
| --- | --- | --- | --- |
| Member documents | Read, list, create, update, delete | Read own; update approved own profile fields | None |
| Contributions | Read; write through trusted Functions | Read own | None |
| Payments | Read; write through trusted Functions | Read own | None |
| Monthly/global statistics | Read; write through trusted Functions | None | None |
| Beneficiaries and beneficiary state | Read all members; write through trusted Functions | Read own while active | None |
| Beneficiary change requests | Read and list all; write through trusted Functions | Read own while active (queries must filter by `memberId`) | None |
| Unknown collections | None unless explicitly added | None | None |

Members may update only their own first name, last name, admission number, welfare identification number, phone number, and gender. They cannot change email, role, status, balances, fees, identifiers, search indexes, timestamps, or financial records.

Beneficiaries hold third-party personal data. Neither members nor administrators can write them, their change requests, or the beneficiary bookkeeping in `members/{id}/beneficiary_state` through the client SDK; every change goes through trusted Functions so that approvals and the yearly allowance are enforced. Inactive members cannot read their beneficiaries. See [beneficiaries](beneficiaries.md).

Backend operations using the Admin SDK bypass Firestore Security Rules and must perform their own authorization and input validation. Firestore rules still check the Firebase Auth custom claim `role: administrator`; moving them to per-role checks is tracked separately.

## Roles and permissions

Trusted backend commands are authorized by permission, not by role name. A user holds one or more roles in the `roles` custom claim, and each role grants a fixed set of permissions defined once in `packages/shared/src/authorization.ts`.

| Permission | super_admin | treasurer | registrar | welfare_officer | auditor | member |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `members.read` (including contact details) | ✓ | ✓ | ✓ | ✓ | ✓ | own |
| `members.write`, `members.status` | ✓ | | ✓ | | | own profile fields |
| `beneficiaries.read` (personal data) | ✓ | | | ✓ | | own |
| `beneficiaries.review` | ✓ | | | ✓ | | |
| `payments.read` | ✓ | ✓ | | | ✓ | own |
| `payments.record`, `payments.reverse`, `contributions.manage`, `balances.adjust` | ✓ | ✓ | | | | |
| `kcb.reconcile` | ✓ | ✓ | | | | |
| `audit.read`, `reports.read` | ✓ | ✓ | | | ✓ | |
| `roles.manage`, `rates.manage`, `members.delete`, `notifications.retry` | ✓ | | | | | |

Auditors and treasurers never receive beneficiaries' personal data.

Callable commands require these permissions:

| Permission | Commands |
| --- | --- |
| `payments.record` | `recordContributionPayment` (retired) |
| `payments.reverse` | `reverseContributionPayment` |
| `contributions.manage` | `createContribution`, `createContributions`, `removeContribution`, `correctLegacyContribution`, `reverseLegacyContributionCorrection`, `listLegacyContributionInventory` |
| `balances.adjust` | `adjustMemberBalance` (retired) |
| `members.status` | `transitionMemberStatus` |
| `members.delete` | `deleteMemberSafely` |
| `kcb.reconcile` | `reconcileKcbPayment`, `allocateKcbPaymentCredit`, `rejectKcbPayment`, `resolveKcbStkUnknownOutcome`, and `requestKcbStkPush` for another member |
| `beneficiaries.review` | `setInitialBeneficiaries`, `approveBeneficiaryChange`, `rejectBeneficiaryChange` |
| `notifications.retry` | `retryNotificationDelivery` |

Every privileged command goes through `requirePermission` (`functions/src/authorization.ts`), which:

- rejects unauthenticated callers;
- rejects callers whose roles lack the permission;
- rejects callers whose member record is not `active`, even when their token still carries privileged claims.

Every privileged command that writes data also calls `assertActorActive` first inside its Firestore transaction. Because the actor's member record is then part of the transaction, suspending an officer while their command is in flight makes the transaction retry, and the retry is refused.

No one may perform a privileged financial, KCB or member-lifecycle action on their own member record, whatever their roles. This includes super admins. Beneficiary review already enforced the same rule.

Audit events written by these commands record the actor's roles at the time of the action in `actorRoles`.

### Transitional legacy claim

Until all administrators have been assigned specific roles, the legacy claim `role: administrator` is treated as `super_admin`. Role assignment, per-role Firestore rules and removal of this fallback follow in later changes.

Balances, contribution balances, contributions, payments, and monthly statistics are server-owned. Even administrators cannot write these fields directly through the client SDK; they must use the callable financial commands.

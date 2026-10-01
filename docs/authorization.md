# Authorization matrix

Firestore Security Rules are the authorization boundary. Interface visibility is not authorization.

Client reads and writes are granted per role. An officer's role counts only when both their token and their active member record grant it (see [where roles live](#where-roles-live)).

| Resource | super_admin | treasurer | registrar | welfare_officer | auditor | Member (own records) |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Member documents: read, list | ✓ | ✓ | ✓ | ✓ | ✓ | Read own |
| Member documents: create, edit profile fields | ✓ | | ✓ | | | Edit approved own fields |
| Contributions and payments (including collection-group queries) | Read | Read | | | Read | Read own |
| KCB payment notifications and STK requests | Read | Read | | | Read | Read own STK requests |
| Monthly and global statistics | Read | Read | | | Read | |
| Audit events | Read | Read | | | Read | |
| Beneficiaries, beneficiary state, change requests | Read | | | Read | | Read own while active |
| Member notifications and preferences, notification events and deliveries | Read | | | | | Own notifications and preferences |
| Contribution rates | Read, create | Read | | | Read | |
| Unknown collections | | | | | | |

No client can write financial records, statistics, beneficiaries, change requests, audit events, roles or KCB records; those change only through trusted Functions. Inactive or suspended officers lose officer access immediately, even while their token is still valid.

Members may update only their own first name, last name, admission number, welfare identification number, phone number, and gender. They cannot change email, role, status, balances, fees, identifiers, search indexes, timestamps, or financial records.

Beneficiaries hold third-party personal data. Neither members nor administrators can write them, their change requests, or the beneficiary bookkeeping in `members/{id}/beneficiary_state` through the client SDK; every change goes through trusted Functions so that approvals and the yearly allowance are enforced. Inactive members cannot read their beneficiaries. See [beneficiaries](beneficiaries.md).

Backend operations using the Admin SDK bypass Firestore Security Rules and must perform their own authorization and input validation.

The rules mirror the read permissions in `packages/shared/src/authorization.ts` in `permissionRoles()`. `tests/firestore.rules.test.ts` checks every role against every resource using the shared map, so the two cannot drift apart unnoticed.

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

Every privileged command that writes data also calls `reauthorizeActor` first inside its Firestore transaction. It repeats the same check (active record, and a role granted by both token and record) against the member record read through the transaction. Suspending an officer or revoking their role while their command is in flight makes the transaction retry, and the retry is refused.

No one may perform a privileged financial, KCB or member-lifecycle action on their own member record, whatever their roles. This includes super admins. Beneficiary review already enforced the same rule.

Audit events written by these commands record the actor's roles at the time of the action in `actorRoles`.

### Where roles live

The member record is the source of truth. `members/{id}.roles` holds the member's roles and is server-owned: clients cannot write `role` or `roles`, and new members must be created with `role: member`. Records created before `roles` existed are read from the legacy `role` field (`administrator` means `member` + `super_admin`) until the backfill runs.

Custom claims mirror the record (`roles`, plus the legacy `role`) for Firestore rules and the interface. Because a token keeps its claims until it expires, a role counts for a trusted command only when both the token and the member record grant it, so revoking a role takes effect on the member's next request. Firestore rules apply the same check to administrator access.

### Assigning roles

Super admins change roles with the `assignMemberRoles` command (**Manage roles** on a member's profile). The command:

- requires `roles.manage` and a reason of up to 500 characters;
- refuses changes to the caller's own roles;
- refuses to remove the last active super admin;
- grants roles only to active members, but can always remove them;
- is idempotent on `requestId`, recorded in `role_assignments/{requestId}`;
- writes the member's `roles`, the matching legacy `role`, and one audit event in a single transaction;
- then syncs the member's custom claims and revokes their refresh tokens, which signs them out of existing sessions.

Those Auth steps happen after the commit and can fail. Session revocation is recorded as `sessionsRevokedAt` on the assignment, so retrying the same `requestId` finishes whatever is left. Claims are always set by `syncRoleClaims`, which reads the member record as it is now and repeats until the roles it wrote are still current. A late event or a slow command therefore cannot leave claims at an older assignment. The member triggers call the same sync when effective roles change, and give new members `roles: [member]`.

### Transitional legacy role

Until every administrator has been assigned specific roles, the legacy `role: administrator` (claim and record) is treated as `super_admin` by trusted commands, Firestore rules and the interface. The legacy `role` is `administrator` only for super admins; other officers keep `role: member` and get their access from `roles`. Removing this fallback is the last step of the migration.

### Interface

Screens and actions follow the same permissions (`src/lib/access.ts`, `useUser().can`). Navigation shows only the pages an officer can open, officers land on the first useful page for their roles, and a member profile shows only the tabs and actions the viewer may use: financial tabs need `payments.read`, the beneficiaries tab needs `beneficiaries.read`, and status, deletion and role changes are hidden on one's own record. This is a convenience; the rules and trusted commands are what enforce access.

### Backfilling roles

Before deploying the rules change, set `roles` on existing members:

```bash
cd functions
npm run backfill:member-roles             # dry run: lists what would change
npm run backfill:member-roles -- --apply  # writes roles
npm run backfill:member-roles             # verify: reports 0 members need roles
```

The backfill derives `roles` from the legacy `role` and writes only `roles` and `rolesBackfilledAt`. It skips members that already have `roles`, so it is safe to re-run. It reports, but does not change, unrecognised legacy roles and records whose `roles` and `role` disagree. Effective roles do not change, so claims and sessions are untouched. No data rollback is needed: earlier releases ignore the `roles` field.

Balances, contribution balances, contributions, payments, and monthly statistics are server-owned. Even administrators cannot write these fields directly through the client SDK; they must use the callable financial commands.

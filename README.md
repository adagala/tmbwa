# TMBWA

TMBWA is the member and financial administration application for The Mid Bar Welfare Association. Administrators manage members, monthly contributions, payments, reporting, audit records, receipts, and lifecycle status. Members have self-service access only to their own profile and financial history.

## Architecture

- React 18, TypeScript, Vite, Tailwind CSS, and React Router provide the web client.
- Firebase Authentication provides identity and role claims.
- Cloud Firestore stores members and financial records.
- Cloud Functions contain trusted financial and lifecycle commands plus monthly scheduled processing.
- Firestore Security Rules are the authorization boundary. UI visibility is not treated as authorization.
- Firebase Hosting serves the application; Functions use Node.js 22.

The client may update approved personal-profile fields. Administrator clients currently create and delete member documents directly. The application sends the member form plus an initial zero balance, but the current administrator create rule does not validate the payload; server triggers then establish derived fields and the Auth account. Payments, contributions, derived totals, audit events, command markers, and lifecycle status updates are server-owned after creation.

## Data model

| Path | Purpose | Client writes |
| --- | --- | --- |
| `members/{id}` | Identity, membership status, account and contribution balances | Owners: restricted profile fields. Administrators: create/delete and restricted non-financial updates |
| `members/{id}/contributions/{month}` | Monthly charge, allocation, outstanding balance | Never |
| `members/{id}/payments/{id}` | Payment/account transaction and receipt number | Never |
| `monthly_stats/{month}` | Derived billed and collected totals | Never |
| `financial_commands/{requestId}` | Idempotency marker | Never |
| `audit_events/{requestId}` | Immutable sensitive-command history | Never |
| `contribution_rates/{id}` | Effective-dated monthly rates | Admin create only; immutable afterward |

Financial definitions:

- **Billed:** total contribution charges created.
- **Collected:** money allocated to those charges.
- **Outstanding:** billed minus collected.
- **Account credit:** unallocated positive member account balance.
- **Collection rate:** collected divided by billed.
- Reversals remain represented by audit events; financial history must not be silently rewritten.

## Local setup

Requirements: Node.js 22, npm, Firebase CLI, and Java for emulator-based rules tests.

```bash
git clone https://github.com/adagala/tmbwa.git
cd tmbwa
nvm use
npm ci
npm ci --prefix functions
```

Create an untracked `.env` containing the public Firebase web configuration:

```dotenv
VITE_FIREBASE_API_KEY=example
VITE_FIREBASE_AUTH_DOMAIN=example.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=example
VITE_FIREBASE_STORAGE_BUCKET=example.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=example
VITE_FIREBASE_APP_ID=example
VITE_FIREBASE_MEASUREMENT_ID=example
VITE_MAINTENANCE=false
```

Do not use production member data in development. Run the web app with `npm run dev`. The Firestore rules suite starts its own isolated emulator:

```bash
npm run test
```

Set `VITE_MAINTENANCE=true` and rebuild the frontend to replace every web route
with the maintenance screen. Set it back to `false` and rebuild to restore the
application. Because Vite embeds environment values at build time, changing the
deployed environment without rebuilding does not change maintenance mode.

## Quality checks

```bash
npm run lint
npm run build
npm run test:unit
npm run test:rules
npm run lint --prefix functions
npm run build --prefix functions
```

Rules tests require `java -version` to succeed. CI executes web checks, Functions checks, and Firestore emulator tests for pull requests targeting `develop` or `main`.

## Contribution workflow

Read [AGENTS.md](./AGENTS.md) before making changes. In summary:

1. Sync `develop`.
2. Create an issue-scoped `feat/`, `fix/`, `security/`, `refactor/`, `test/`, `docs/`, or `chore/` branch.
3. Run the relevant checks.
4. Open a focused PR into `develop` with `Closes #<issue>`.
5. Promote reviewed releases from `develop` to `main`.

Never commit directly to `main` or `develop` for ordinary work.

## Deployment

Deploy only from reviewed release state on `main` using an authenticated Firebase CLI session with least-privilege project access.

```bash
npm ci
npm ci --prefix functions
npm run lint
npm run build
npm run test
npm run lint --prefix functions
npm run build --prefix functions
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

Deployment-sensitive changes include Firestore indexes/rules, callable Functions, scheduled monthly generation (`Africa/Nairobi`, first day of each month), and contribution-rate records. Inspect Firebase deployment output and function logs after release.

## Rollback and recovery

- Revert the release commit through a reviewed PR; do not force-push shared branches.
- Redeploy the previous known-good `main` commit for Hosting and Functions.
- Treat Firestore rules/index rollback separately and verify old code remains compatible before reverting them.
- Never delete financial records to repair totals. Reconcile through audited commands or a reviewed corrective migration.
- Scheduled contribution generation is idempotent per member/month and can be rerun after the underlying fault is fixed.

## Secrets and incident handling

Never commit service-account JSON, private keys, access tokens, passwords, production exports, or member personal/financial data. Firebase web configuration is public configuration, but environment-specific values still belong in an untracked `.env`. Store backend credentials in managed Firebase/Google Cloud secrets.

If exposure is suspected: stop deployment, revoke or rotate the credential, remove it from current and historical distribution where appropriate, review audit/provider logs, and document the incident without reproducing the secret.

## Troubleshooting

- **Rules tests cannot start:** install a supported Java runtime and verify `java -version`.
- **Callable returns permission denied:** refresh the ID token and verify the member role/status and custom claims.
- **Collection-group query requests an index:** deploy `firestore.indexes.json` and wait for index construction.
- **A financial retry appears duplicated:** callers must reuse the request ID until a definitive response; inspect `financial_commands` and `audit_events`.
- **Member cannot sign in:** only `active` members are enabled; lifecycle transitions revoke existing refresh tokens.

Further detail: [authorization](./docs/authorization.md), [account provisioning](./docs/account-provisioning.md), [audit events](./docs/audit-events.md), and [monthly contributions](./docs/monthly-contributions.md).

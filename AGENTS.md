# Repository Working Agreement

This file contains repository-wide instructions for human contributors, AI coding agents, and automation working on TMBWA.

The goal is to keep changes secure, auditable, maintainable, and consistent across the application.

## Application overview

TMBWA is a member welfare and contributions application.

The application manages member information, monthly contributions, payments, balances, administrative workflows, and related financial records.

Because the system handles member identity and financial data, security, authorization, financial correctness, and auditability take priority over convenience or interface improvements.

## Application architecture

### Frontend

The frontend is built with:

- React
- Vite
- TypeScript
- Firebase Authentication
- Firestore
- Firebase Storage where required

Shared UI primitives live under:

`src/components/`

Use existing application patterns before introducing new abstractions, libraries, state-management approaches, or component systems.

### Backend

Trusted backend operations run through Firebase Cloud Functions under:

`functions/`

Use trusted backend operations for:

- Financial mutations
- Privileged administrative operations
- Payment processing
- Operations requiring server-side validation
- Derived financial values
- Operations requiring reliable audit information
- Authorization that cannot safely be enforced by Firestore rules alone

Do not move trusted financial or privileged authorization logic into the frontend.

The frontend may request an operation, but the trusted backend must independently validate sensitive commands.

### Data

Firestore is the primary application database.

Before changing the data model:

1. Inspect the existing collections, documents, types, and converters.
2. Identify existing readers and writers.
3. Identify Cloud Functions affected by the change.
4. Consider Firestore security rules.
5. Consider historical data.
6. Consider backward compatibility.
7. Consider migrations or backfills.
8. Check whether the proposed field duplicates an existing source of truth.

Avoid introducing multiple authoritative representations of the same data.

Derived financial values should not become independently editable sources of truth.

### Payments and contributions

Financial operations must preserve:

- Contribution history
- Payment history
- Member balances
- Auditability
- Idempotency
- Historical accuracy

Payment callbacks, retries, duplicate requests, or repeated administrative actions must not create duplicate financial transactions.

Never silently rewrite financial history.

Corrections should use explicit, auditable operations such as reversals, adjustments, or other established repository patterns.

### Repository structure

Important repository areas include:

- `src/` — Frontend application
- `src/components/` — Shared UI primitives
- `functions/` — Firebase Cloud Functions
- `firestore.rules` — Firestore authorization rules

This list is intentionally not exhaustive.

Inspect the repository before assuming that a module, path, collection, function, or architectural pattern exists.

The repository itself is the source of truth for implementation details.

## Source of truth

Use the following sources in this order when working on a task:

1. The assigned GitHub issue and its acceptance criteria
2. This `AGENTS.md`
3. Existing repository implementation and tests
4. Existing architecture and documentation
5. Relevant Git history, pull requests, and related issues

GitHub Issues is the source of truth for the current backlog, priorities, scope, and acceptance criteria.

Do not rely on old conversations, stale documentation, or assumptions when the repository or current issue provides newer information.

If requirements conflict or remain ambiguous, identify the conflict rather than silently choosing new product behavior.

## Branch strategy

- `main` is the production and release branch.
- `develop` is the shared integration branch for ongoing development.
- Do not commit feature or fix work directly to `main`.
- Do not commit feature or fix work directly to `develop` unless the repository owner explicitly requests it.
- Create every feature, fix, refactor, documentation update, or maintenance change from the latest `develop`.
- Open normal development pull requests into `develop`.
- Promote tested releases by opening a pull request from `develop` into `main`.

Before starting normal development work:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c <type>/<issue-number>-<short-description>
```

Do not discard unrelated local changes while preparing a branch.

## Branch naming

Use lowercase, hyphen-separated names:

- `feat/<issue-number>-<description>`
- `fix/<issue-number>-<description>`
- `security/<issue-number>-<description>`
- `refactor/<issue-number>-<description>`
- `test/<issue-number>-<description>`
- `docs/<issue-number>-<description>`
- `chore/<issue-number>-<description>`

Examples:

- `security/1-firestore-rules`
- `fix/3-build-pipeline`
- `feat/9-member-statements`

If no GitHub issue exists, create or request one before substantial work so the change has an agreed scope and acceptance criteria.

Small corrections may be handled without a dedicated issue only when explicitly requested by the repository owner.

## Working on an issue

Before editing code:

1. Read this `AGENTS.md`.
2. Read the assigned GitHub issue completely.
3. Identify its acceptance criteria.
4. Inspect the relevant existing implementation.
5. Inspect relevant tests.
6. Check related issues or pull requests when useful.
7. Identify security, financial, data, migration, and deployment implications.
8. Keep the implementation within the assigned scope.

Do not start by rewriting existing code based solely on assumptions about how the feature should work.

Prefer extending established repository patterns unless there is a clear technical reason to change them.

Do not opportunistically refactor unrelated areas while implementing an issue.

If unrelated problems are discovered, report them or create a separate issue rather than expanding the current pull request unnecessarily.

## Pull requests

- Target `develop` for features, fixes, tests, refactors, documentation, and maintenance.
- Reference the issue in the PR description with `Closes #<number>` when the PR fully resolves it.
- Keep PRs focused on one issue or one independently reviewable concern.
- Explain the user impact.
- Explain the implementation approach.
- Explain security or data implications where applicable.
- Document verification performed.
- Include screenshots for visible interface changes.
- Call out migrations.
- Call out environment changes.
- Call out new secrets.
- Call out Firebase rule changes.
- Call out scheduled jobs.
- Call out deployment steps.
- Call out known limitations or follow-up work.

Do not merge while required checks are failing.

Prefer squash merging unless the repository owner specifies otherwise.

Delete merged short-lived branches when they are no longer needed.

AI coding agents should not merge a pull request unless explicitly instructed to do so.

Opening or updating a PR does not imply permission to merge it.

## Review discipline

Before requesting review or declaring work complete:

1. Review the complete diff.
2. Remove accidental or unrelated changes.
3. Check for debugging code and temporary logging.
4. Check for exposed secrets or sensitive information.
5. Confirm the implementation satisfies the issue acceptance criteria.
6. Run the relevant verification.
7. Review security and authorization implications.
8. Review financial implications where applicable.

When responding to review feedback:

- Address the actual review concern rather than only the specific line mentioned.
- Do not resolve legitimate review comments without implementing or explaining the required change.
- Re-run relevant verification after changes.
- Avoid introducing unrelated changes while addressing review feedback.
- Document intentional disagreements with review suggestions.

## Release flow

1. Merge completed and reviewed work into `develop`.
2. Verify the integrated application on `develop`.
3. Open a release PR from `develop` to `main`.
4. Summarize included issues, migrations, deployment steps, risks, and rollback instructions.
5. Deploy only from the reviewed release state on `main`.

Emergency production fixes should branch from `main`.

Emergency fixes must be reviewed into `main` and then merged or cherry-picked back into `develop` immediately to prevent divergence.

## Engineering priorities

When concerns conflict, use this priority order:

1. Security and authorization
2. Financial correctness and auditability
3. Build reliability, tests, and operational safety
4. Data integrity
5. Scalability and maintainability
6. Product features
7. Interface improvements

Do not weaken a higher-priority property merely to simplify a lower-priority implementation.

## Authorization and security

Treat Firestore rules and trusted backend validation as the actual authorization boundary.

Hiding controls in React is not authorization.

Never trust the client to determine:

- Administrative privileges
- Financial totals
- Payment status
- Contribution status
- Sensitive derived values
- Ownership of privileged resources
- Whether a sensitive operation is allowed

Sensitive backend commands must validate authentication, authorization, input, and relevant current state.

Where appropriate, authorization must be enforced both through Firestore rules and trusted backend logic.

Prefer least-privilege access.

## Financial integrity

Financial changes must preserve these principles:

- Validate sensitive commands on the server.
- Prefer atomic operations.
- Prefer idempotent operations.
- Never silently rewrite financial history.
- Record who performed sensitive actions.
- Record when sensitive actions occurred.
- Prevent clients from directly controlling derived totals.
- Prevent clients from directly controlling privileged financial fields.
- Preserve historical records required for auditability.

Explicitly consider:

- Duplicate payments
- Duplicate callbacks
- Retries
- Concurrent operations
- Partial payments
- Overpayments
- Reversals
- Adjustments
- Failed transactions
- Balance calculations

Test financial behavior against realistic failure and retry scenarios whenever the change affects those areas.

## Verification

Run the checks relevant to the area changed before opening a PR.

The intended repository baseline is:

```bash
npm ci
npm run format:check
npm run lint
npm run build

cd functions
npm ci
npm run lint
npm run build
```

Also run automated tests once their scripts are available.

Run additional checks required by the area changed.

For frontend component work, also run:

```bash
npm run lint:ui-components
```

Use Firebase emulators for integration and security-rule testing.

Do not connect automated tests to production data.

Do not use production member or financial information as test fixtures.

If a baseline command is already broken:

1. Confirm the failure exists independently of the current change when practical.
2. Document the existing failure clearly in the PR.
3. Avoid introducing additional failures.
4. Do not hide or bypass the failure merely to make checks appear successful.

## Frontend formatting

Prettier is the canonical formatter for frontend code and configuration.

Run:

```bash
npm run format
```

after manually editing, generating, or AI-generating frontend files.

Run:

```bash
npm run format:check
```

before committing or opening a pull request.

Humans, AI agents, and automation must not introduce a competing formatting style or hand-format around Prettier.

Formatting must remain behavior-preserving.

Review bulk formatting separately from intentional UI changes whenever practical.

Editor formatting must use the repository configuration in `.prettierrc.json`.

The recommended VS Code configuration should format on save using the Prettier extension.

## Frontend component system

Application pages, sections, and feature components must use shared UI primitives from `src/components`.

This applies equally to human- and AI-generated code.

Do not introduce native:

- `button`
- `input`
- `select`
- `option`
- `textarea`
- `label`
- `table`

outside top-level shared primitive implementations in `src/components`.

If a required primitive is missing:

1. Add it centrally under `src/components`.
2. Use the current official Tremor component as the preferred source.
3. Record the source where appropriate.
4. Adapt it to repository accessibility requirements.
5. Adapt it to dark-mode conventions.
6. Adapt it to repository TypeScript conventions.
7. Adapt it to repository styling conventions.

Semantic structural elements such as `form`, headings, paragraphs, sections, and layout containers may remain native when no reusable visual primitive is appropriate.

After adding or converting UI, run:

```bash
npm run lint:ui-components
npm run format
npm run format:check
```

Any intentional exception to the shared-component rules requires an explicit explanation in the pull request.

## Dependencies

Prefer existing dependencies and platform capabilities before adding new packages.

Before adding a dependency:

1. Confirm the repository does not already provide the capability.
2. Confirm the functionality is substantial enough to justify another dependency.
3. Prefer actively maintained packages.
4. Consider bundle size for frontend dependencies.
5. Consider security and supply-chain risk.
6. Consider compatibility with the existing toolchain.

Do not introduce a second library that substantially duplicates an established repository dependency without a documented reason.

Do not perform broad dependency upgrades as part of an unrelated feature or fix.

## Secrets and sensitive data

Never commit:

- Firebase service-account files
- Passwords
- API credentials
- Access tokens
- Private keys
- Production exports
- Member financial data
- Member personal data
- Secret environment files

Never print plaintext passwords, tokens, or secrets to logs.

Use environment variables or managed secret storage.

Use synthetic fixtures in tests and examples.

Treat member identity and financial data as sensitive.

If secret exposure is suspected:

1. Stop work that could spread the exposure.
2. Report the exposure.
3. Remove the exposed value safely.
4. Rotate the affected credential.
5. Check repository history and logs where relevant.

Deleting a secret from the latest source file is not sufficient if it has already been committed or published.

## Logging and observability

Logs must provide enough context to diagnose operational failures without exposing sensitive data.

Do not log:

- Passwords
- Authentication tokens
- Private keys
- Full payment credentials
- Sensitive member data unnecessarily

Use structured and actionable error information where existing repository patterns support it.

Do not leave temporary debugging logs in production code unless they provide intentional operational value.

## Data migrations

Treat migrations and backfills as potentially destructive operations.

Before introducing one:

1. Understand the existing production data shape.
2. Define expected behavior for old and new records.
3. Prefer backward-compatible deployment sequences.
4. Make operations restartable or idempotent where practical.
5. Define verification steps.
6. Define rollback or recovery options.
7. Document deployment ordering.

Never assume all existing documents contain newly introduced fields.

Do not perform irreversible production data transformations without explicit approval.

## Working safely

- Preserve unrelated user changes.
- Avoid destructive Git commands.
- Avoid irreversible data migrations.
- Keep schema and data migrations backward-compatible when practical.
- Document assumptions.
- Document unresolved product decisions.
- Update documentation when behavior changes.
- Update documentation when setup changes.
- Update documentation when architecture changes.
- Update documentation when configuration changes.
- Update documentation when operational procedures change.

Do not use destructive resets or force pushes unless explicitly required and approved.

Do not modify production data merely to test an implementation.

## Scope control

Keep each issue and pull request focused.

Do not expand an assigned issue because nearby code could also be improved.

When discovering unrelated work:

- Mention it in the PR when relevant.
- Create or recommend a separate issue when appropriate.
- Continue the assigned task without unnecessary expansion.

Small refactors directly necessary to implement the assigned issue safely are acceptable.

Large architectural refactors require explicit scope.

## Work prioritization

GitHub Issues is the source of truth for the current backlog, priorities, scope, and acceptance criteria.

Do not infer current priorities from this file.

When assigned an issue:

1. Read the issue and its acceptance criteria.
2. Check related issues and pull requests when relevant.
3. Follow the engineering priorities defined in this file.
4. Stay within the issue scope.
5. Surface blockers or ambiguous requirements instead of inventing product decisions.

Do not automatically begin another backlog issue after completing the assigned work.

One completed issue does not imply authorization to continue through the backlog.

## Definition of done

An issue is ready to be considered complete when applicable:

- Acceptance criteria are satisfied.
- Relevant code has been implemented.
- Relevant security implications have been considered.
- Relevant financial implications have been considered.
- Relevant tests have been added or updated.
- Required verification passes.
- The complete diff has been reviewed.
- No unrelated changes are included.
- Documentation has been updated where necessary.
- Migrations and deployment steps are documented.
- User-visible changes include screenshots where appropriate.
- A focused pull request targets the correct branch.

Passing a build alone does not mean the issue is complete.

AI coding agents should report what was changed, what was verified, and any remaining risks or unresolved decisions.

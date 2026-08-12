# Repository Working Agreement

This file contains repository-wide instructions for human contributors, AI coding agents, and automation working on TMBWA.

## Branch strategy

- `main` is the production and release branch.
- `develop` is the shared integration branch for ongoing development.
- Do not commit feature or fix work directly to `main`.
- Do not commit feature or fix work directly to `develop` unless the repository owner explicitly requests it.
- Create every feature, fix, refactor, documentation update, or maintenance change from the latest `develop`.
- Open normal development pull requests into `develop`.
- Promote tested releases by opening a pull request from `develop` into `main`.

Before starting work:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c <type>/<issue-number>-<short-description>
```

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

## Pull requests

- Target `develop` for features, fixes, tests, refactors, documentation, and maintenance.
- Reference the issue in the PR description with `Closes #<number>` when the PR fully resolves it.
- Keep PRs focused on one issue or one independently reviewable concern.
- Explain the user impact, implementation approach, security or data implications, and verification performed.
- Include screenshots for visible interface changes.
- Call out migrations, environment changes, new secrets, Firebase rule changes, scheduled jobs, and deployment steps.
- Do not merge while required checks are failing.
- Prefer squash merging unless the repository owner specifies otherwise.
- Delete merged short-lived branches when they are no longer needed.

## Release flow

1. Merge completed and reviewed work into `develop`.
2. Verify the integrated application on `develop`.
3. Open a release PR from `develop` to `main`.
4. Summarize included issues, migrations, deployment steps, risks, and rollback instructions.
5. Deploy only from the reviewed release state on `main`.

Emergency production fixes should branch from `main`, be reviewed into `main`, and then be merged or cherry-picked back into `develop` immediately to prevent divergence.

## Engineering priorities

When work conflicts, use this priority order:

1. Security and authorization
2. Financial correctness and auditability
3. Build reliability, tests, and operational safety
4. Scalability and maintainability
5. Product features and interface improvements

Treat Firestore rules and trusted backend validation as the actual authorization boundary. Hiding controls in React is not sufficient authorization.

Financial changes must preserve these principles:

- Validate sensitive commands on the server.
- Prefer atomic and idempotent operations.
- Never silently rewrite financial history.
- Record who performed sensitive actions and when.
- Prevent clients from directly controlling derived totals or privileged fields.
- Test payments, reversals, balances, contributions, and concurrent or duplicate operations.

## Verification

Run the checks relevant to the area changed before opening a PR. The intended baseline is:

```bash
npm ci
npm run lint
npm run build

cd functions
npm ci
npm run lint
npm run build
```

Also run automated tests once their scripts are available. Use Firebase emulators for integration and security-rule testing; do not connect automated tests to production data.

If a baseline command is already broken, document the existing failure clearly in the PR and avoid introducing additional failures.

## Secrets and sensitive data

- Never commit Firebase service-account files, passwords, API credentials, access tokens, private keys, production exports, or member financial/personal data.
- Never print plaintext passwords, tokens, or secrets to logs.
- Use environment variables or managed secret storage.
- Use synthetic fixtures in tests and examples.
- Treat member identity and financial data as sensitive.
- If secret exposure is suspected, stop, report it, remove the exposure safely, and rotate the affected credential.

## Working safely

- Read the relevant GitHub issue and acceptance criteria before editing.
- Inspect existing code and repository instructions before choosing an approach.
- Preserve unrelated user changes.
- Avoid destructive git commands and irreversible data migrations.
- Keep schema and data migrations backward-compatible when practical.
- Document assumptions and unresolved product decisions.
- Update documentation when behavior, setup, architecture, configuration, or operations change.

## Current backlog

The ordered backlog is maintained in GitHub Issues. Start with P0 security and build-foundation issues before adding lower-priority features:

- #1 Firestore authorization
- #2 Account provisioning and password security
- #3 Reproducible builds, linting, dependencies, and CI

After those foundations, proceed through the P1 financial-integrity and testing issues, followed by P2 and P3 product work.

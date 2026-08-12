# Account provisioning and password operations

## New members

Creating a member document provisions a matching Firebase Auth account. The backend generates a cryptographically random bootstrap credential that is never returned, persisted, or logged. A phone number is never used as a password.

The administrator should tell the member to:

1. Open the sign-in page.
2. Select **Reset password**.
3. Enter the email address recorded on their membership profile.
4. Follow the one-time Firebase link delivered to that address and choose a private password.

Reset requests use a generic response so the interface does not reveal whether an email address is registered.

## Existing members

Existing predictable credentials should be treated as compromised. Ask all current members to complete the reset flow. Administrators should revoke refresh tokens for accounts suspected of unauthorized use:

```ts
await admin.auth().revokeRefreshTokens(uid);
```

If there is evidence that a real credential, private key, service-account file, or token was committed or exposed, rotate it with the relevant provider; removing it from the current tree is not sufficient.

## Administrative recovery

Do not ask a member to disclose a password and do not manually choose one for them. Direct the member to the public **Reset password** screen. The previous manual password-update script was removed because accepting credentials in an interactive maintenance process creates unnecessary exposure risk.

## Logging rules

- Never log passwords, bootstrap credentials, reset codes, ID tokens, access tokens, or service-account contents.
- Log only the minimum identifier needed to investigate an operation.
- Redact sensitive fields from structured error objects before forwarding them to external logging services.

# Beneficiaries

Members record up to three beneficiaries. Every change a member makes is a request that an administrator approves or rejects.

## Rules

- At most 3 beneficiaries per member. No percentage shares.
- First name, last name, relationship and date of birth are required. Email, phone number and ID number are optional. The ID number is free text (up to 100 characters) and may be a national ID, passport or birth certificate number.
- A member may make one change per calendar year (1 January to 31 December, Africa/Nairobi). A further change in the same year needs a reason: death of a beneficiary, marriage, divorce or separation, birth or adoption, correcting an error, or other. Free text is optional, and required for "other".
- The first beneficiaries a member records do not use the yearly change, whether the member submits them or an administrator enters them directly.
- Only an approved yearly change uses the allowance. Rejected and cancelled requests do not, and neither do approved changes made with a reason.
- A member can have at most one pending request.
- After the first entry, administrators cannot edit beneficiaries directly. Changes come from member requests.
- Inactive members cannot see their beneficiaries.

## Data model

| Path | Purpose |
| --- | --- |
| `members/{memberId}/beneficiaries/{beneficiaryId}` | Current approved beneficiaries (`beneficiaryDocumentSchema`) |
| `members/{memberId}/beneficiary_state/current` | Server bookkeeping: approved-list `version`, `lastAnnualChangeYear`, `pendingRequestId` (`beneficiaryStateDocumentSchema`) |
| `beneficiary_change_requests/{requestId}` | Every request and its outcome; never deleted (`beneficiaryChangeRequestDocumentSchema`) |

The bookkeeping is kept off the member document because member documents are copied into contribution records.

Each request stores the `baseVersion` it was made against. Approving a request whose `baseVersion` no longer matches the current `version` is refused, so a stale request cannot overwrite a newer list.

Dates of birth are stored as `YYYY-MM-DD` calendar dates, not timestamps, so they never shift across time zones.

All writes go through trusted Cloud Functions; see [authorization](authorization.md). Audit events and logs record IDs and counts only, never beneficiary personal details.

## Commands

All commands are callable Cloud Functions and take a client-generated `requestId` (8 to 128 letters, digits, `-` or `_`), which becomes the change request's document ID. Retrying with the same `requestId` returns the original result with `duplicate: true` and writes nothing. A retry counts only when the same command, caller and member created the request (each request records its `origin`: `member` or `administrator`); any other reuse of a `requestId` is refused with `already-exists`. Member commands check that the member is active before returning anything, including retries.

| Command | Caller | Effect |
| --- | --- | --- |
| `submitBeneficiaryChange({ requestId, beneficiaries, reason? })` | Active member, for themselves | Creates a `pending` request. The server sets the type: `initial` when the member has no approved list, `annual` when this calendar year's change is unused, otherwise `exceptional`, which requires `reason` (`{ category, text? }`). Refused while another request is pending. |
| `cancelBeneficiaryChange({ requestId })` | Active member who owns the request | Marks a `pending` request `cancelled`. The annual allowance is not used. |
| `setInitialBeneficiaries({ requestId, memberId, beneficiaries })` | Administrator | Records a member's first beneficiaries directly, as an `initial` request that is already `approved`. Refused when the member already has beneficiaries or a pending request. |

Approving and rejecting requests is covered by #67.

## Status

The data model, validation and access rules (#65) and the member and initial-entry commands (#66) are in place. The review commands (#67) and the screens (#68) follow.

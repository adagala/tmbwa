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
| `approveBeneficiaryChange({ requestId, reviewNote? })` | Administrator | Replaces the approved beneficiaries with the request's list and increments `version`. An `annual` request uses the allowance of the Nairobi calendar year it was **submitted** in, so a December request approved in January leaves the new year's change free. Refused when the approved list changed after the request was made (`baseVersion` mismatch); reject it and ask the member to resubmit. |
| `rejectBeneficiaryChange({ requestId, reviewNote })` | Administrator | Marks the request `rejected` with a required note (up to 500 characters). The approved list and the annual allowance are unchanged. |

Approving or rejecting clears the member's pending request and sends them an in-app notification (`beneficiary.change_approved` or `beneficiary.change_rejected`). The notification text contains no beneficiary details or review note; the member reads the note in the app. Repeating the same decision returns `duplicate: true` and writes nothing; any other decision on a request that is no longer `pending` is refused, so two administrators acting at once produce exactly one decision.

## Status

The data model, validation and access rules (#65), the member and initial-entry commands (#66) and the review commands (#67) are in place. The screens (#68) follow.

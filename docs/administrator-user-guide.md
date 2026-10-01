# TMBWA Administrator User Guide

This guide explains how administrators can add funds for a member, reconcile KCB payments, allocate account credit, resolve ambiguous STK outcomes, view financial reports, and monitor notification delivery.

## Before you begin

- Sign in using an account with the TMBWA administrator role.
- Use a current web browser.
- Amounts are shown in Kenya shillings (KES), and transaction times use East Africa Time.
- Confirm the source records before performing any financial action. Do not use reconciliation to guess or rewrite financial history.

## Add funds for a member

Administrators can start an account top-up on a member's behalf, for example when the member asks for help paying in advance.

1. Select **Members** and open the required member.
2. Confirm the member's identity, that their membership is **active**, and the amount they want to pay.
3. Next to **Account balance**, select **Add funds**.
4. Enter the amount in whole shillings and review how it will be used. The preview shows unpaid contributions settled oldest first and any amount held for future contributions.
5. Check **M-Pesa phone number**. It starts as the member's registered number; change it if someone else is paying for the member.
6. Select **Send M-Pesa prompt**. The payer approves it with the M-Pesa PIN on that phone, and the payment is credited to the member whichever number paid. The paying number is recorded on the payment.
7. Keep the dialog open to follow the status, or check the member's **Account balance** and **Transactions** later.

The preview is for display only. TMBWA recalculates the allocation when the payment arrives, so the result can differ if the member's contributions change in the meantime. You cannot choose which months a top-up pays.

A top-up cannot be started for an inactive member, or while a contribution STK payment for that member is still in progress. If the dialog shows **Payment received** or **Payment not yet confirmed**, do not send another prompt; check the KCB reconciliation queue as described below.

## Reconcile an unresolved KCB payment

Reconciliation is a sensitive financial action. Confirm the KCB receipt, payer, amount, reference, selected member, and allocations before submitting it.

1. Select **KCB reconciliation** from the navigation menu.
2. Under the unresolved payments list, review:
   - KCB receipt number
   - Payer name and phone number
   - Amount
   - Bill reference
   - Any member suggested from a verified phone number
3. Select the correct **Member**. Treat a suggested member as a hint and confirm it independently.
4. Under **Contribution allocations**, select a contribution month and enter the amount to allocate.
5. Use **Add allocation** when one receipt must be split across multiple contribution months.
6. Confirm the totals shown for **Receipt**, **Allocated**, and **Account credit**.
7. Select **Reconcile payment**.
8. If the allocation is smaller than the receipt, confirm that the remainder should be held as member account credit.

Allocations cannot exceed the receipt amount or a selected contribution's balance. A contribution should not be selected more than once in the same reconciliation. Once completed, the trusted backend records the allocation, updates the relevant balances, and preserves the receipt for audit purposes.

### Member account top-ups

Members, or administrators acting for a member, can start an **Add funds** M-Pesa prompt from the member's profile. A successful top-up is normally recorded automatically. It pays the member's unpaid contributions oldest first and keeps the rest as account credit that monthly contribution generation applies automatically.

A top-up appears in the unresolved list only when it could not be matched automatically, for example when the till notification arrived before the STK callback. For these payments the allocation editor is replaced by a short explanation. Confirm the member and select **Reconcile payment**. TMBWA then applies the same oldest-first rule; you cannot choose allocations for a top-up.

Top-up credit never appears under **Unallocated KCB credit**, and it cannot be allocated manually. A top-up with remaining credit can be reversed only if no account credit has been applied to a contribution since it was received. Credit is pooled, so once any later contribution has been paid from account credit (a `BALANCE B/F` payment), the reversal is refused, even if newer top-ups have since added more credit.

If the payment does not belong in the system, select **Reject**, enter a clear reason, and confirm. Reject only after verifying the provider record and reference.

## Allocate existing account credit

Some reconciled receipts may have an unallocated remainder.

1. In **KCB reconciliation**, find **Unallocated KCB credit**.
2. Confirm the receipt, member, and available credit.
3. Add one or more allocations to eligible contribution months.
4. Confirm that the allocation does not exceed the available credit.
5. Select **Allocate existing credit**.

This assigns previously recorded credit; it does not receive the payment a second time.

## Resolve an ambiguous STK outcome

An ambiguous outcome means TMBWA could not safely confirm whether the provider accepted the payment.

1. In **KCB reconciliation**, find **Ambiguous STK provider outcomes**.
2. Check the request, member, contribution, and current state against KCB records.
3. Use **Confirm no payment and release lock** only after KCB has confirmed that no payment was accepted.
4. Enter the provider verification evidence when prompted and confirm the action.

Do not release the lock when a successful receipt exists or the provider outcome is still uncertain. Escalate the case for financial investigation instead.

## View financial reports

1. Select **Report** from the navigation menu.
2. Optionally filter by:
   - **From month** and **To month**
   - **Member**
   - **Charge status**: paid, partial, or unpaid
   - **Payment type**: contribution or account
3. Review the summary cards:
   - **Billed** — contribution charges created.
   - **Collected** — money allocated to contribution charges.
   - **Outstanding** — billed less collected.
   - **Account credit** — received money not yet allocated to charges.
   - **Collection rate** — collected divided by billed.
   - **Payments** — the number of matching payments.
   - **Active members** — active members in the selected member scope.
4. Review the monthly table for billed, collected, and outstanding totals.
5. Select **Export CSV** to download the contribution records matching the current filters.

The exported file name includes the selected period. Account credit is reported separately and should not be treated as collected contributions until it is allocated.

## View a member's contributions, transactions, and documents

1. Select **Members** and open the required member.
2. Review **Contribution History** and select a month for its details.
3. Select **Transactions** to review payment records.
4. Select an underlined receipt number to open the printable receipt.
5. Under **Settings**, optionally select a statement date range and choose **Print statement**.
6. In the browser print window, print the document or choose **Save as PDF**.

Allow pop-ups for TMBWA if the receipt or statement window does not open.

## Add missing contribution months

A member's **Contribution History** shows a card listing every month from the member's join month through the current month that has no contribution. The card shows what adding them would bill, how much account credit would cover, and the member's balance afterwards.

1. Select **Members** and open the member.
2. On the missing-months card, select **Add missing months**.
3. Choose **All missing months**, **Only those credit covers in full** (shown when credit pays some but not all of them), or **Let me pick** to tick individual months. You can add up to 60 months at a time. Select **Continue**.
4. Review how each month will be billed: paid in full from credit, part-paid from credit, or fully due. Check the amount the member will owe afterwards, then select **Add months**. Select **Back** to change the months.

Each month is billed at KES 500. Any unreserved account credit pays the oldest selected month first. The months are added together: if any of them was added by someone else in the meantime, nothing is added and the error names the month. The member receives one notification covering all the months added.

Months can only be added for active members. To add a month before the member's join date, use **Add contribution**. If the member has no join date, missing months can't be worked out and the page says so.

## Review beneficiary requests

Members change their beneficiaries through requests that an administrator must approve. **Beneficiary requests** in the navigation shows how many are waiting.

1. Select **Beneficiary requests**. The **Pending** tab lists requests waiting for review; the other tabs show approved, not approved, cancelled or all requests.
2. Select **Review** to compare the member's current beneficiaries with the proposed ones. The request shows whether it is the member's first entry, their yearly change, or an extra change with a reason.
3. Optionally add a note, then select **Approve**; or add a note explaining why and select **Reject**. A note is required to reject.

The member is notified either way. Approval replaces the member's beneficiaries. Approval is refused if the member's beneficiaries changed after they sent the request, or if the member no longer exists; reject the request instead and, if needed, ask the member to send a new one.

You cannot approve or reject your own request; another administrator must review it.

To record a member's first beneficiaries yourself, open the member, select the **Beneficiaries** tab and select **Set initial beneficiaries**. This is available only while the member has no beneficiaries and no pending request, and not for your own record. Later changes must come from the member.

## View notifications and monitor delivery

1. Select **Notifications**.
2. Use the **Inbox** tab for notifications sent to your administrator account.
3. Mark individual notifications as read or use **Mark all as read**.
4. Use the **Deliveries** tab to review each delivery event, member, channel, status, and attempt count.
5. For a failed or dead-letter delivery, check that the underlying delivery problem has been resolved and select **Retry delivery**.

Use **Turn off** or **Turn on** under **In-app notifications** to change notifications for your own account. This preference does not modify financial records or another member's notification setting.

## Getting help and investigating discrepancies

Record the affected member, contribution month, receipt or reference number, approximate time, and the message shown on screen. Do not share passwords, M-Pesa PINs, authentication codes, access tokens, or private member information outside the approved support process.

For a payment discrepancy, compare the member's M-Pesa receipt with the KCB reconciliation queue and existing TMBWA transaction records. Never create, delete, or alter a financial record merely to make a displayed balance look correct. Use the established auditable reconciliation, allocation, reversal, or correction workflow.

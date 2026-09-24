# TMBWA Administrator User Guide

This guide explains how administrators can reconcile KCB payments, allocate account credit, resolve ambiguous STK outcomes, view financial reports, and monitor notification delivery.

## Before you begin

- Sign in using an account with the TMBWA administrator role.
- Use a current web browser.
- Amounts are shown in Kenya shillings (KES), and transaction times use East Africa Time.
- Confirm the source records before performing any financial action. Do not use reconciliation to guess or rewrite financial history.

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

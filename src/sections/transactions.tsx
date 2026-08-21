import React from 'react';
import { Payment, Member } from 'tmbwa-shared/firebase';
import { PaymentTypeEnum } from 'tmbwa-shared';
import { RiWalletLine } from '@remixicon/react';
import { List, ListItem } from '@/components/List';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { printReceipt, receiptNumber } from '@/lib/memberDocuments';
import { formatNairobiDateTime, timestampDate } from '@/lib/financialReporting';

interface TransactionsProps extends React.ComponentPropsWithoutRef<'div'> {
  member: Member;
  payments: Payment[];
}

const Transactions = React.forwardRef<HTMLDivElement, TransactionsProps>(
  ({ payments, member, className, ...props }: TransactionsProps, ref) => {
    return (
      <div className={className} {...props} ref={ref}>
        <div className="flex items-center justify-between">
          <div className="my-6 text-xl font-semibold flex items-center gap-1">
            <RiWalletLine className="size-5 shrink-0" aria-hidden="true" />
            Transactions History
          </div>
        </div>
        <List className="mt-4">
          {payments.map((payment) => {
            const type =
              payment.payment_type || PaymentTypeEnum.enum.contribution;
            return (
              <ListItem
                key={payment.payment_id}
                className="hover:bg-gray-50 dark:hover:bg-gray-900/60 px-2 dark:border-gray-800 h-12"
              >
                <div className="flex min-w-0 gap-x-4 items-baseline">
                  <div className="min-w-0 flex flex-auto items-center">
                    <div className="text-sm font-semibold leading-6 text-gray-900 dark:text-gray-200 flex">
                      <div className="w-48">
                        {timestampDate(payment.paymentdate)
                          ? formatNairobiDateTime(
                              timestampDate(payment.paymentdate)!,
                            )
                          : 'Pending'}
                      </div>
                      <div className="w-20">
                        <Badge
                          variant={
                            type === PaymentTypeEnum.Enum.contribution
                              ? 'neutral'
                              : 'default'
                          }
                        >
                          {type}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    type="button"
                    className="hidden h-auto border-0 p-0 text-xs underline shadow-none sm:inline-flex"
                    onClick={() => printReceipt(payment, member)}
                  >
                    {receiptNumber(payment)}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="shrink-0 flex items-center gap-2">
                    <div className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200 capitalize">
                      {payment.amount}
                    </div>
                  </div>
                </div>
              </ListItem>
            );
          })}
        </List>
      </div>
    );
  },
);

Transactions.displayName = 'Transactions';

export { Transactions };

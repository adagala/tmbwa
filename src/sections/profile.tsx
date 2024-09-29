import { Badge } from '@/components/Badge';
import { Tooltip } from '@/components/Tooltip';
import { DialogMembershipFeeUpdate } from '@/components/ui/members/DialogMembershipFeeUpdate';
import useUser from '@/hooks/useUser';
import { Member } from '@/schemas/member';
import {
  RiArrowDownDoubleLine,
  RiArrowUpDoubleLine,
  RiSubtractLine,
} from '@remixicon/react';

export function Profile({ member }: { member: Member }) {
  const { role } = useUser();
  const accountState =
    member.balance === 0
      ? 'neutral'
      : member.balance > 0
        ? 'positive'
        : 'negative';
  const balanceColor =
    accountState === 'neutral'
      ? 'text-gray-700 dark:text-gray-300'
      : accountState === 'positive'
        ? 'text-emerald-500'
        : 'text-red-500';
  return (
    <div className="mt-6 border-t border-gray-100 dark:border-gray-800">
      <dl className="divide-y divide-gray-100 dark:divide-gray-800">
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Full name
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
            {member.firstname} {member.lastname}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Role
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0 capitalize">
            {member.role}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Admission number
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
            {member.membernumber}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Welfare identification number
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
            {member.win}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Email address
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
            {member.email}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Phone number
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
            {member.phonenumber}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Membership Fees
          </dt>
          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0 flex gap-1 items-center">
            <Badge variant={member.isFeesPaid ? 'success' : 'error'}>
              {member.isFeesPaid ? 'Paid' : 'Not paid'}
            </Badge>
            {role === 'administrator' ? (
              <Tooltip showArrow={false} content="Update">
                <DialogMembershipFeeUpdate member={member} />
              </Tooltip>
            ) : null}
          </dd>
        </div>
        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
            Account balance
          </dt>
          <dd
            className={`mt-1 text-sm leading-6 font-semibold sm:col-span-2 sm:mt-0 flex ${balanceColor}`}
          >
            {member.balance}{' '}
            {accountState === 'positive' && (
              <RiArrowUpDoubleLine className="size-6" />
            )}
            {accountState === 'negative' && (
              <RiArrowDownDoubleLine className="size-6" />
            )}
            {accountState === 'neutral' && (
              <RiSubtractLine className="size-6" />
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

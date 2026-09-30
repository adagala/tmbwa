import React, { useEffect, useState } from 'react';
import { Contribution, Member, Payment } from 'tmbwa-shared/firebase';
import {
  ContributionStatusEnum,
  missingContributionMonths,
} from 'tmbwa-shared';
import {
  RiAccountBoxLine,
  RiFileList3Line,
  RiPrinterLine,
  RiUserLine,
} from '@remixicon/react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import { Tooltip } from '@/components/Tooltip';
import { DialogAccountTopUp } from '@/components/ui/members/DialogAccountTopUp';
import { DialogMembershipFeeUpdate } from '@/components/ui/members/DialogMembershipFeeUpdate';
import useUser from '@/hooks/useUser';
import {
  getMemberContributions,
  getMemberPayments,
} from '@/lib/firebase/firestore';
import { formatNairobiMonth, timestampDate } from '@/lib/financialReporting';
import { getMonth } from '@/lib/utils';
import { Contributions } from './contributions';
import { Profile } from './profile';
import { StatementPrint } from './statementPrint';
import { Transactions } from './transactions';

const memberProfileTabs = [
  'details',
  'contributions',
  'transactions',
  'statement',
] as const;
type MemberProfileTab = (typeof memberProfileTabs)[number];

const isMemberProfileTab = (value: string | null): value is MemberProfileTab =>
  memberProfileTabs.includes(value as MemberProfileTab);

const formatKes = (value: number) =>
  `KES ${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}`;

const arrearsSummary = (contributions: Contribution[]) => {
  const unpaid = contributions.filter(
    (contribution) => contribution.paid === ContributionStatusEnum.enum.unpaid,
  ).length;
  const partial = contributions.filter(
    (contribution) => contribution.paid === ContributionStatusEnum.enum.partial,
  ).length;
  if (contributions.length === 0) return 'No contributions recorded yet';
  if (unpaid === 0 && partial === 0) return 'All contributions paid';
  const parts = [
    partial ? `${partial} partial` : null,
    unpaid ? `${unpaid} unpaid` : null,
  ].filter(Boolean);
  return `Owes ${parts.join(' + ')} ${unpaid + partial === 1 ? 'month' : 'months'}`;
};

const joinedDate = (member: Member) =>
  (member.datejoined ? timestampDate(member.datejoined) : null) ??
  (member.createat ? timestampDate(member.createat) : null);

function SummaryTile({
  label,
  children,
  detail,
  action,
}: {
  label: string;
  children: React.ReactNode;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </div>
        {action}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-gray-900 dark:text-gray-50">
        {children}
      </div>
      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {detail}
      </div>
    </Card>
  );
}

export function MemberAccount({
  member,
  ownProfile = false,
}: {
  member: Member;
  ownProfile?: boolean;
}) {
  const { role } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [contributionsLoaded, setContributionsLoaded] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const tabParam = searchParams.get('tab');
  const currentTab: MemberProfileTab = isMemberProfileTab(tabParam)
    ? tabParam
    : 'contributions';

  useEffect(() => {
    if (!member.member_id) return;
    setContributionsLoaded(false);
    const unsubscribeContributions = getMemberContributions(
      (contributions) => {
        setContributions(contributions);
        setContributionsLoaded(true);
      },
      { memberId: member.member_id },
    );
    const unsubscribePayments = getMemberPayments(setPayments, {
      memberId: member.member_id,
    });
    return () => {
      unsubscribeContributions();
      unsubscribePayments();
    };
  }, [member.member_id]);

  const updateTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const balance = member.balance || 0;
  const balanceColor =
    balance > 0
      ? 'text-emerald-600 dark:text-emerald-500'
      : balance < 0
        ? 'text-red-600 dark:text-red-500'
        : undefined;
  const joined = joinedDate(member);
  const missingMonths =
    contributionsLoaded && joined
      ? missingContributionMonths(
          joined,
          contributions.flatMap((contribution) => [
            contribution.contribution_id,
            contribution.month,
          ]),
          getMonth(),
        )
      : undefined;
  // The backend independently rejects inactive members and other members.
  const canTopUp =
    member.status === 'active' && (ownProfile || role === 'administrator');

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Account balance"
          action={
            canTopUp ? (
              <DialogAccountTopUp
                member={member}
                contributions={contributions}
              />
            ) : null
          }
          detail={
            contributionsLoaded
              ? arrearsSummary(contributions)
              : 'Checking contributions…'
          }
        >
          <span className={balanceColor}>{formatKes(balance)}</span>
        </SummaryTile>
        <SummaryTile
          label="Total contribution"
          detail={
            joined
              ? `Since joining · ${formatNairobiMonth(joined)}`
              : 'Lifetime'
          }
        >
          {formatKes(member.contributionBalance || 0)}
        </SummaryTile>
        <SummaryTile
          label="Membership fees"
          detail={member.isFeesPaid ? 'Fees settled' : 'Fees outstanding'}
        >
          <span className="flex items-center gap-2">
            <Badge
              variant={member.isFeesPaid ? 'success' : 'error'}
              className="text-sm"
            >
              {member.isFeesPaid ? 'Paid' : 'Not paid'}
            </Badge>
            {role === 'administrator' ? (
              <Tooltip showArrow={false} content="Update">
                <DialogMembershipFeeUpdate member={member} />
              </Tooltip>
            ) : null}
          </span>
        </SummaryTile>
      </div>

      <Tabs value={currentTab} onValueChange={updateTab}>
        <TabsList variant="line" className="overflow-x-auto">
          <TabsTrigger value="details" className="inline-flex gap-2">
            <RiUserLine className="-ml-1 size-4" aria-hidden="true" />
            Details
          </TabsTrigger>
          <TabsTrigger value="contributions" className="inline-flex gap-2">
            <RiFileList3Line className="-ml-1 size-4" aria-hidden="true" />
            Contributions
          </TabsTrigger>
          <TabsTrigger value="transactions" className="inline-flex gap-2">
            <RiAccountBoxLine className="-ml-1 size-4" aria-hidden="true" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="statement" className="inline-flex gap-2">
            <RiPrinterLine className="-ml-1 size-4" aria-hidden="true" />
            Statement
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <Profile
            member={member}
            ownProile={ownProfile}
            showAccountSummary={false}
          />
        </TabsContent>
        <TabsContent value="contributions">
          <Contributions
            member={member}
            contributions={contributions}
            missingMonths={missingMonths}
            joinDateUnknown={!joined}
          />
        </TabsContent>
        <TabsContent value="transactions">
          <Transactions member={member} payments={payments} />
        </TabsContent>
        <TabsContent value="statement" className="mt-6">
          <StatementPrint
            member={member}
            contributions={contributions}
            payments={payments}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Payment, Member, Contribution } from 'tmbwa-shared/firebase';
import {
  RiAccountBoxLine,
  RiSettings5Line,
  RiUserLine,
} from '@remixicon/react';
import { Contributions } from './contributions';
import { Transactions } from './transactions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import { MemberTab } from '@/lib/types';
import {
  getMemberContributions,
  getMemberPayments,
} from '@/lib/firebase/firestore';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { printStatement } from '@/lib/memberDocuments';

interface ContributionsAndTransactionsProps
  extends React.ComponentPropsWithoutRef<'div'> {
  member: Member;
}

const ContributionsAndTransactions = React.forwardRef<
  HTMLDivElement,
  ContributionsAndTransactionsProps
>(({ member, className, ...props }: ContributionsAndTransactionsProps, ref) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');
  const tab = searchParams.get('tab') as MemberTab;
  const [currentTab] = useState<MemberTab>(tab || 'contributions');

  const updateTab = (tab: MemberTab) => {
    searchParams.set('tab', tab);
    navigate(`${location.pathname}?${searchParams.toString()}`);
  };

  useEffect(() => {
    if (!tab) {
      updateTab('contributions');
    }
  }, [tab]);

  useEffect(() => {
    if (member.member_id) {
      const unsubscribeContributions = getMemberContributions(
        (contributions) => {
          setContributions(contributions);
        },
        { memberId: member.member_id },
      );
      const unsubscribePayments = getMemberPayments(
        (payments) => {
          setPayments(payments);
        },
        { memberId: member.member_id },
      );
      return () => {
        unsubscribeContributions();
        unsubscribePayments();
      };
    }
  }, [member.member_id]);
  return (
    <div className={className} {...props} ref={ref}>
      <div className="flex flex-col gap-8">
        <div className="mt-6 text-xl font-medium flex items-center gap-1">
          <RiSettings5Line className="size-6 shrink-0" aria-hidden="true" />
          Settings
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded border p-3"><label className="text-xs">Statement from<input className="mt-1 block rounded border p-2" type="date" value={statementFrom} onChange={(event) => setStatementFrom(event.target.value)} /></label><label className="text-xs">To<input className="mt-1 block rounded border p-2" type="date" value={statementTo} onChange={(event) => setStatementTo(event.target.value)} /></label><button type="button" className="rounded bg-guardsman-red-600 px-4 py-2 text-sm text-white" onClick={() => printStatement(member, contributions, payments, statementFrom, statementTo)}>Print statement</button></div>
        <Tabs defaultValue={currentTab}>
          <TabsList variant="line">
            <TabsTrigger
              value="contributions"
              className="inline-flex gap-2"
              onClick={() => updateTab('contributions')}
            >
              <RiUserLine className="-ml-1 size-4" aria-hidden="true" />
              Contributions
            </TabsTrigger>
            <TabsTrigger
              value="transactions"
              className="inline-flex gap-2"
              onClick={() => updateTab('transactions')}
            >
              <RiAccountBoxLine className="-ml-1 size-4" aria-hidden="true" />
              Transactions
            </TabsTrigger>
          </TabsList>
          <div className="mt-4">
            <TabsContent value="contributions">
              {member ? (
                <Contributions member={member} contributions={contributions} />
              ) : null}
            </TabsContent>
            <TabsContent value="transactions">
              {member ? (
                <Transactions payments={payments} member={member} />
              ) : null}
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
});

ContributionsAndTransactions.displayName = 'ContributionsAndTransactions';

export { ContributionsAndTransactions };

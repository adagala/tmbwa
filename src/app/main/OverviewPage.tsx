import { Card } from '@/components/Card';
import { MonthlyStats, Payment } from '@/schemas/member';
import { RiExchangeFundsLine, RiHome2Line } from '@remixicon/react';
import { List, ListItem } from '@tremor/react';
import { AreaChart } from '@/components/AreaChart';
import { useEffect, useState } from 'react';
import { getMonthlyStats, getRecentPayments } from '@/lib/firebase/firestore';
import { Avatar } from '@/components/Avatar';

export default function OverviewPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const currentMonth = new Date().toLocaleDateString('en-US', {
    month: 'long',
  });
  const currentMonthShort = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
  });
  const currentYear = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
  });
  const currentMonthStats = monthlyStats.find(
    (stat) => stat.month === `${currentYear}-${currentMonthShort}-01`,
  );
  const chartdata = monthlyStats.map((stats) => ({
    date: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: '2-digit',
    }).format(new Date(stats.month)),
    Contributions: stats.contribution,
  }));

  useEffect(() => {
    const unsubscribe = getMonthlyStats(
      (stats) => setMonthlyStats(stats.reverse()),
      {
        max: 12,
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = getRecentPayments((payments) => setPayments(payments));
    return () => unsubscribe();
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div className="mt-6  text-guardsman-red-600 text-xl font-bold flex items-center gap-1">
        <RiHome2Line className="size-6 shrink-0" aria-hidden="true" />
        Overview
      </div>
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="flex-1 grid sm:grid-cols-1 gap-4">
          <Card className="mx-auto space-y-2 hover:bg-gray-50 dark:hover:bg-gray-900/60">
            <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content">
              {currentMonth} amount
            </p>
            <p className="text-xl sm:text-2xl text-tremor-content-strong dark:text-dark-tremor-content-strong font-semibold">
              KES {currentMonthStats?.contribution || 0}
            </p>
          </Card>
          <div className="flex-1 grid sm:grid-cols-2 gap-4">
            <Card className="mx-auto space-y-2 hover:bg-gray-50 dark:hover:bg-gray-900/60">
              <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content">
                Total Members
              </p>
              <p className="text-xl sm:text-2xl text-tremor-content-strong dark:text-dark-tremor-content-strong font-semibold">
                {currentMonthStats?.totalMembers || 0}
              </p>
            </Card>
            <Card className="mx-auto space-y-2 hover:bg-gray-50 dark:hover:bg-gray-900/60">
              <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content">
                New Members in {currentMonth}
              </p>
              <p className="text-xl sm:text-2xl text-tremor-content-strong dark:text-dark-tremor-content-strong font-semibold">
                {currentMonthStats?.newMembers || 0}
              </p>
            </Card>
          </div>
        </div>
        <Card className="flex-1 space-y-4 h-80">
          <div className="flex gap-1 font-semibold text-lg">
            <RiExchangeFundsLine className="size-6" />
            Recent payments
          </div>
          <List className="mt-2">
            {payments.map((payment) => (
              <ListItem
                key={payment.payment_id}
                className="hover:bg-gray-50 dark:hover:bg-gray-900/60 dark:border-gray-800 px-2"
              >
                <div className="flex items-center min-w-0 gap-x-4">
                  <Avatar
                    initial={`${payment.firstname.charAt(0)}${payment.lastname.charAt(0)}`}
                  />
                  <div className="min-w-0 flex-auto">
                    <p className="text-sm font-semibold leading-6 text-gray-900 dark:text-gray-200">
                      {payment.firstname} {payment.lastname}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="shrink-0 flex items-center gap-2">
                    <div className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200 capitalize">
                      {payment.amount}
                    </div>
                  </div>
                </div>
              </ListItem>
            ))}
          </List>
        </Card>
      </div>
      <Card>
        <AreaChart
          className="h-72"
          data={chartdata}
          index="date"
          categories={['Contributions']}
          showLegend={true}
          xAxisLabel="Month of Year"
          yAxisLabel="Contributions (KES)"
        />
      </Card>
    </div>
  );
}

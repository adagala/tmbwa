import { RiFileTextLine } from '@remixicon/react';
import React from 'react';
import { List, ListItem } from '@tremor/react';
import { MonthlyStats } from '@/schemas/member';
import { getMonthlyStats } from '@/lib/firebase/firestore';
import { Link } from 'react-router-dom';

export default function ReportPage() {
  const [monthlyStats, setMonthlyStats] = React.useState<MonthlyStats[]>([]);

  React.useEffect(() => {
    const unsubscribe = getMonthlyStats((stats) => setMonthlyStats(stats), {});
    return () => unsubscribe();
  }, []);

  const totalAmount = monthlyStats.reduce((acc, stat) => acc + stat.amount, 0);

  const getYear = (date: string) => new Date(date).getFullYear().toString();
  const getMonth = (date: string) =>
    String(new Date(date).getMonth() + 1).padStart(2, '0');

  return (
    <div className="flex flex-col gap-8">
      <div className="mt-6 text-xl font-bold flex items-center gap-1 text-guardsman-red-600">
        <RiFileTextLine className="size-6 shrink-0" aria-hidden="true" />
        Report
      </div>

      <List className="mt-4">
        <ListItem className="hover:bg-gray-50 dark:hover:bg-gray-900/60 px-2 dark:border-gray-800 h-12">
          <div className="flex min-w-0 gap-x-4">
            <div className="min-w-0 flex flex-auto items-center">
              <div className="text-sm font-bold leading-6 text-gray-900 dark:text-gray-200 flex">
                <div className="w-48 uppercase">Month</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="shrink-0 flex items-center gap-2">
              <div className="text-sm font-bold leading-6 text-gray-900 dark:text-gray-200 uppercase">
                Amount (kes)
              </div>
            </div>
          </div>
        </ListItem>
        {monthlyStats.map((stat) => {
          return (
            <ListItem
              key={stat.month}
              className="hover:bg-gray-50 dark:hover:bg-gray-900/60 px-2 dark:border-gray-800 h-12"
            >
              <Link
                to={`/contributions?year=${getYear(stat.month)}&month=${getMonth(stat.month)}`}
                key={stat.month}
                className="flex justify-between w-full gap-x-4"
              >
                <div className="flex min-w-0 gap-x-4">
                  <div className="min-w-0 flex flex-auto items-center">
                    <div className="text-sm font-semibold leading-6 text-gray-900 dark:text-gray-200 flex">
                      <div className="w-48">
                        {new Date(stat.month).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="shrink-0 flex items-center gap-2">
                    <div className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200 capitalize">
                      {new Intl.NumberFormat('en-US', {}).format(stat.amount)}
                    </div>
                  </div>
                </div>
              </Link>
            </ListItem>
          );
        })}
        <ListItem className="hover:bg-gray-50 dark:hover:bg-gray-900/60 px-2 dark:border-gray-800 h-12">
          <div className="flex min-w-0 gap-x-4">
            <div className="min-w-0 flex flex-auto items-center">
              <div className="text-sm font-bold leading-6 text-gray-900 dark:text-gray-200 flex">
                <div className="w-48 uppercase">Total</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="shrink-0 flex items-center gap-2">
              <div className="text-sm font-bold leading-6 text-gray-900 dark:text-gray-200 capitalize">
                {new Intl.NumberFormat('en-US', {}).format(totalAmount)}
              </div>
            </div>
          </div>
        </ListItem>
      </List>
    </div>
  );
}

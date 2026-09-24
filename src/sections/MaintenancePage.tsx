import { RiCheckLine, RiPauseFill, RiShieldCheckLine } from '@remixicon/react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { maintenanceAvailablePages } from '@/lib/maintenance';
import { cx } from '@/lib/utils';

type MaintenancePageProps = {
  // Render inside the app layout instead of as a full-screen page.
  embedded?: boolean;
};

const safeRecords = [
  'Contribution history',
  'Payments & transactions',
  'Member balances',
];

export default function MaintenancePage({
  embedded = false,
}: MaintenancePageProps) {
  const Container = embedded ? 'section' : 'main';

  return (
    <Container
      aria-labelledby="maintenance-title"
      className={cx(
        'relative flex items-center justify-center overflow-hidden px-2 py-12 text-sm text-gray-950 antialiased sm:px-6 dark:text-gray-50',
        embedded
          ? 'min-h-[70vh]'
          : 'min-h-screen bg-gray-50 px-6 dark:bg-gray-950',
      )}
    >
      {!embedded && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-guardsman-red-500 via-gold-drop-500 to-guardsman-red-500"
        />
      )}
      <div className="grid w-full max-w-[51.25rem] grid-cols-1 items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-guardsman-red-500 dark:text-guardsman-red-300">
            Scheduled maintenance
          </p>
          <h1
            id="maintenance-title"
            className="mt-2.5 text-[1.625rem] font-semibold leading-tight tracking-[-0.015em]"
          >
            System under maintenance
          </h1>
          <p className="mt-2.5 leading-relaxed text-gray-600 dark:text-gray-300">
            We're carrying out scheduled maintenance.{' '}
            {embedded ? 'This page is' : 'The member portal is'} temporarily
            unavailable and will be back online as soon as the work is complete.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {maintenanceAvailablePages.map((page) => (
              <Button
                key={page.to}
                variant="secondary"
                className="px-3.5 py-2"
                asChild
              >
                <Link to={page.to} className="gap-1.5">
                  <page.icon aria-hidden="true" className="size-[18px]" />
                  Go to {page.label.toLowerCase()}
                </Link>
              </Button>
            ))}
          </div>
        </div>

        <Card className="rounded-[0.625rem] p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <RiShieldCheckLine
              aria-hidden="true"
              className="size-[18px] text-emerald-700 dark:text-emerald-400"
            />
            Your records are safe
          </h2>
          <p className="mt-1 text-[0.8125rem] text-gray-500 dark:text-gray-400">
            Maintenance never removes or rewrites your history.
          </p>
          <ul className="mt-3.5 grid gap-2.5">
            {safeRecords.map((record) => (
              <li key={record} className="flex items-center gap-2.5">
                <RiCheckLine
                  aria-hidden="true"
                  className="size-[18px] shrink-0 text-emerald-700 dark:text-emerald-400"
                />
                {record}
              </li>
            ))}
          </ul>
          <div className="my-4 h-px bg-gray-100 dark:bg-gray-800" />
          <ul className="grid gap-2.5">
            <li className="flex items-center gap-2.5">
              <RiPauseFill
                aria-hidden="true"
                className="size-[18px] shrink-0 text-amber-700 dark:text-amber-400"
              />
              All other pages
              <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                Paused
              </span>
            </li>
            {maintenanceAvailablePages.map((page) => (
              <li key={page.to} className="flex items-center gap-2.5">
                <RiCheckLine
                  aria-hidden="true"
                  className="size-[18px] shrink-0 text-emerald-700 dark:text-emerald-400"
                />
                {page.label}
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                  Available
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Container>
  );
}

import { useEffect, useState } from 'react';
import {
  collection,
  DocumentData,
  limit,
  onSnapshot,
  orderBy,
  QueryDocumentSnapshot,
  query,
  startAfter,
} from 'firebase/firestore';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendarEventLine,
  RiExternalLinkLine,
  RiHistoryLine,
  RiTimeLine,
} from '@remixicon/react';
import { Link, Navigate } from 'react-router-dom';
import { AuditEvent, auditEventSchema } from 'tmbwa-shared/firebase';
import { parseDocument } from 'tmbwa-shared';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import useUser from '@/hooks/useUser';
import { db } from '@/lib/firebase/clientApp';
import {
  formatNairobiDateTime,
  kenyaMoney,
  monthLabel,
} from '@/lib/financialReporting';

const PAGE_SIZE = 10;

type AuditRow = {
  event: AuditEvent;
  snapshot: QueryDocumentSnapshot<DocumentData>;
};

function formatChangeValue(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

type Allocation = {
  amount: number;
  contributionId: string;
};

function parseAllocations(value: unknown): Allocation[] | undefined {
  const candidates = Array.isArray(value) ? value : [value];
  if (candidates.length === 0) return [];

  const allocations = candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const record = candidate as Record<string, unknown>;
    const contributionId = record.contributionId ?? record.contribution_id;
    const amount = record.amount;

    if (typeof contributionId !== 'string' || typeof amount !== 'number')
      return undefined;

    return { contributionId, amount };
  });

  return allocations.every((allocation) => allocation !== undefined)
    ? (allocations as Allocation[])
    : undefined;
}

function contributionLabel(contributionId: string) {
  return /^\d{4}-\d{2}(?:-\d{2})?$/.test(contributionId)
    ? monthLabel(contributionId)
    : contributionId;
}

function MemberLink({ id }: { id: string }) {
  return (
    <Link
      to={`/members/${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 items-center gap-1 font-medium text-guardsman-red-600 underline decoration-guardsman-red-300 underline-offset-2 hover:text-guardsman-red-700 dark:text-guardsman-red-400 dark:decoration-guardsman-red-700 dark:hover:text-guardsman-red-300"
      title={`Open member ${id} in a new tab`}
    >
      <span className="truncate">{id}</span>
      <RiExternalLinkLine className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </Link>
  );
}

export default function AuditPage() {
  const { role } = useUser();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [page, setPage] = useState(0);
  const [pageStarts, setPageStarts] = useState<
    Array<QueryDocumentSnapshot<DocumentData> | null>
  >([null]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (role !== 'administrator') return;

    setIsLoading(true);
    setError(undefined);
    const pageStart = pageStarts[page];
    const baseQuery = query(
      collection(db, 'audit_events'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE + 1),
    );
    const pageQuery = pageStart
      ? query(baseQuery, startAfter(pageStart))
      : baseQuery;

    return onSnapshot(
      pageQuery,
      (snapshot) => {
        const visibleDocuments = snapshot.docs.slice(0, PAGE_SIZE);
        setRows(
          visibleDocuments.map((item) => ({
            snapshot: item,
            event: parseDocument(auditEventSchema, item.data(), item.ref.path),
          })),
        );
        setHasNextPage(snapshot.docs.length > PAGE_SIZE);
        setIsLoading(false);
      },
      () => {
        setError('Audit events could not be loaded. Please try again.');
        setIsLoading(false);
      },
    );
  }, [page, pageStarts, role]);

  const showNextPage = () => {
    const nextPageStart = rows[rows.length - 1]?.snapshot;
    if (!nextPageStart) return;

    setPageStarts((current) => [...current.slice(0, page + 1), nextPageStart]);
    setPage((current) => current + 1);
  };

  if (role && role !== 'administrator')
    return <Navigate to="/profile" replace />;

  return (
    <div className="flex flex-col gap-6">
      <header className="mt-6 flex items-start gap-3">
        <div className="rounded-lg bg-guardsman-red-50 p-2 text-guardsman-red-600 dark:bg-guardsman-red-950 dark:text-guardsman-red-400">
          <RiHistoryLine className="size-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50">
            Audit trail
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Review administrative and financial activity across the platform.
          </p>
        </div>
      </header>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </Card>
      ) : null}

      <section aria-label="Audit events" className="space-y-3">
        {rows.map(({ event, snapshot }) => (
          <Card key={snapshot.id} className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50/70 px-4 py-4 dark:border-gray-800 dark:bg-gray-900/40 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <Badge className="w-fit" variant="neutral">
                {event.action}
              </Badge>
              <span className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                <RiTimeLine className="size-4" aria-hidden="true" />
                {event.createdAt
                  ? formatNairobiDateTime(event.createdAt.toDate())
                  : 'Pending timestamp'}
              </span>
            </div>

            <div className="grid gap-x-8 gap-y-4 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
              <AuditIdentity label="Member">
                <MemberLink id={event.memberId} />
              </AuditIdentity>
              <AuditIdentity label="Actor">
                {event.actorId.startsWith('system:') ? (
                  <span className="break-all">{event.actorId}</span>
                ) : (
                  <MemberLink id={event.actorId} />
                )}
              </AuditIdentity>
              <AuditIdentity label="Target">
                <span className="break-all">{event.targetId}</span>
              </AuditIdentity>
            </div>

            {Object.keys(event.changes ?? {}).length > 0 ? (
              <div className="border-t border-gray-200 px-4 py-5 dark:border-gray-800 sm:px-6">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Event details
                </p>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(event.changes ?? {}).map(([key, value]) => (
                    <AuditChangeDetail key={key} name={key} value={value} />
                  ))}
                </dl>
              </div>
            ) : null}
          </Card>
        ))}

        {!isLoading && rows.length === 0 && !error ? (
          <Card className="py-12 text-center">
            <RiHistoryLine
              className="mx-auto size-8 text-gray-400"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">
              No audit events found
            </p>
          </Card>
        ) : null}

        {isLoading ? (
          <Card className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            Loading audit events…
          </Card>
        ) : null}
      </section>

      {!error && (page > 0 || hasNextPage) ? (
        <nav
          aria-label="Audit trail pagination"
          className="flex flex-col gap-3 border-t border-gray-200 pt-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 sm:text-left">
            Page {page + 1} · Up to {PAGE_SIZE} events per page
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={page === 0 || isLoading}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              <RiArrowLeftSLine className="size-4" aria-hidden="true" />
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!hasNextPage || isLoading}
              onClick={showNextPage}
            >
              Next
              <RiArrowRightSLine className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function AuditChangeDetail({ name, value }: { name: string; value: unknown }) {
  const allocations = name === 'allocations' ? parseAllocations(value) : null;

  if (allocations) {
    const total = allocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );

    return (
      <div className="min-w-0 rounded-md bg-gray-50 p-4 dark:bg-gray-900/60 sm:col-span-2 lg:col-span-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Contribution allocations
          </dt>
          {allocations.length > 0 ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Total
              <span className="ml-2 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {kenyaMoney.format(total)}
              </span>
            </div>
          ) : null}
        </div>
        <dd className="mt-3">
          {allocations.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {allocations.map((allocation, index) => (
                <div
                  key={`${allocation.contributionId}-${index}`}
                  className="flex min-w-0 items-center justify-between gap-4 rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-950"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="rounded-md bg-guardsman-red-50 p-2 text-guardsman-red-600 dark:bg-guardsman-red-950 dark:text-guardsman-red-400">
                      <RiCalendarEventLine
                        className="size-4"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900 dark:text-gray-100">
                        {contributionLabel(allocation.contributionId)}
                      </span>
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                        {allocation.contributionId}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {kenyaMoney.format(allocation.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No contribution allocations
            </p>
          )}
        </dd>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {name}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap break-all text-sm text-gray-900 dark:text-gray-100">
        {formatChangeValue(value)}
      </dd>
    </div>
  );
}

function AuditIdentity({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
        {children}
      </div>
    </div>
  );
}

import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiInbox2Line,
  RiNotification3Line,
  RiSendPlaneLine,
} from '@remixicon/react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import useUser from '@/hooks/useUser';
import {
  markAllNotificationsRead,
  markNotificationRead,
  MemberNotification,
  NotificationDelivery,
  retryNotificationDelivery,
  subscribeToMemberNotifications,
  subscribeToNotificationDeliveries,
  subscribeToNotificationPreference,
  updateNotificationPreference,
} from '@/lib/firebase/notifications';
import { formatNairobiDateTime } from '@/lib/financialReporting';

const PAGE_SIZE = 10;

function Pagination({
  currentPage,
  itemCount,
  label,
  onPageChange,
}: {
  currentPage: number;
  itemCount: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.ceil(itemCount / PAGE_SIZE);
  if (pageCount <= 1) return null;
  const firstItem = currentPage * PAGE_SIZE + 1;
  const lastItem = Math.min((currentPage + 1) * PAGE_SIZE, itemCount);

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-col gap-3 border-t border-gray-200 px-4 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <p className="text-center text-sm text-gray-500 dark:text-gray-400 sm:text-left">
        Showing {firstItem}–{lastItem} of {itemCount}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <RiArrowLeftSLine aria-hidden="true" className="size-4" />
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={currentPage === pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
          <RiArrowRightSLine aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

const deliveryBadgeVariant = (status: string) => {
  if (status === 'delivered') return 'success' as const;
  if (status === 'failed' || status === 'dead_letter') return 'error' as const;
  if (status === 'pending' || status === 'processing')
    return 'warning' as const;
  return 'neutral' as const;
};

export default function NotificationsPage() {
  const { user, role } = useUser();
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [notificationPage, setNotificationPage] = useState(0);
  const [deliveryPage, setDeliveryPage] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!user) return;
    const unsubscribeNotifications = subscribeToMemberNotifications(
      user.uid,
      setNotifications,
    );
    const unsubscribePreference = subscribeToNotificationPreference(
      user.uid,
      setEnabled,
    );
    const unsubscribeDeliveries =
      role === 'administrator'
        ? subscribeToNotificationDeliveries(setDeliveries)
        : undefined;
    return () => {
      unsubscribeNotifications();
      unsubscribePreference();
      unsubscribeDeliveries?.();
    };
  }, [role, user]);

  useEffect(() => {
    const lastPage = Math.max(
      0,
      Math.ceil(notifications.length / PAGE_SIZE) - 1,
    );
    setNotificationPage((page) => Math.min(page, lastPage));
  }, [notifications.length]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(deliveries.length / PAGE_SIZE) - 1);
    setDeliveryPage((page) => Math.min(page, lastPage));
  }, [deliveries.length]);

  const setPreference = async (next: boolean) => {
    if (!user) return;
    setBusy('preference');
    setError(undefined);
    try {
      await updateNotificationPreference(user.uid, next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save your preference.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const retry = async (deliveryId: string) => {
    setBusy(deliveryId);
    setError(undefined);
    try {
      await retryNotificationDelivery(deliveryId);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not retry delivery.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const markAllRead = async () => {
    if (!user) return;
    if (!unreadCount) return;

    setBusy('mark-all-read');
    setError(undefined);
    try {
      await markAllNotificationsRead(user.uid);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not mark all notifications as read.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const unreadCount = notifications.filter(({ read }) => !read).length;
  const visibleNotifications = notifications.slice(
    notificationPage * PAGE_SIZE,
    (notificationPage + 1) * PAGE_SIZE,
  );
  const visibleDeliveries = deliveries.slice(
    deliveryPage * PAGE_SIZE,
    (deliveryPage + 1) * PAGE_SIZE,
  );

  const inbox = (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="inbox-heading" className="font-semibold">
              Your inbox
            </h2>
            {unreadCount ? <Badge>{unreadCount} unread</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Your latest account and contribution updates.
          </p>
        </div>
        {unreadCount && user ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full shrink-0 sm:w-auto"
            isLoading={busy === 'mark-all-read'}
            loadingText="Marking as read"
            onClick={() => void markAllRead()}
          >
            Mark all as read
          </Button>
        ) : null}
      </div>
      {visibleNotifications.length ? (
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {visibleNotifications.map((notification) => (
            <article key={notification.id} className="px-4 py-5 sm:px-6">
              <div className="flex items-start gap-3 sm:gap-4">
                <span
                  className={`mt-2 size-2 shrink-0 rounded-full ${
                    notification.read
                      ? 'bg-gray-300 dark:bg-gray-700'
                      : 'bg-guardsman-red-600 dark:bg-guardsman-red-500'
                  }`}
                  aria-label={notification.read ? 'Read' : 'Unread'}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-50">
                        {notification.title}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
                        {notification.body}
                      </p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {notification.createdAt
                          ? formatNairobiDateTime(
                              notification.createdAt.toDate(),
                            )
                          : 'Sending'}
                      </p>
                    </div>
                    {!notification.read && user ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full shrink-0 sm:w-auto"
                        onClick={() =>
                          void markNotificationRead(user.uid, notification.id)
                        }
                      >
                        Mark as read
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <RiInbox2Line aria-hidden="true" className="size-8 text-gray-400" />
          <h3 className="mt-3 font-semibold">Your inbox is clear</h3>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Payment, contribution, reversal, and arrears updates will appear
            here.
          </p>
        </div>
      )}
      <Pagination
        currentPage={notificationPage}
        itemCount={notifications.length}
        label="Inbox"
        onPageChange={setNotificationPage}
      />
    </Card>
  );

  const deliveryOperations = (
    <Card className="overflow-hidden p-0">
      {visibleDeliveries.length ? (
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {visibleDeliveries.map((delivery) => (
            <article
              key={delivery.id}
              className="grid gap-4 px-4 py-5 text-sm sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(7rem,0.8fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Event
                </p>
                <p className="mt-1 break-all font-medium text-gray-900 dark:text-gray-50">
                  {delivery.eventId}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {delivery.createdAt
                    ? formatNairobiDateTime(delivery.createdAt.toDate())
                    : 'Queued'}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Member
                </p>
                <p className="mt-1 break-all text-gray-700 dark:text-gray-300">
                  {delivery.memberId}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Delivery
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge variant={deliveryBadgeVariant(delivery.status)}>
                    {delivery.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {delivery.channel} · {delivery.attempts}{' '}
                    {delivery.attempts === 1 ? 'attempt' : 'attempts'}
                  </span>
                </div>
              </div>
              <div className="lg:justify-self-end">
                {['failed', 'dead_letter'].includes(delivery.status) ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full lg:w-auto"
                    isLoading={busy === delivery.id}
                    loadingText="Retrying"
                    onClick={() => void retry(delivery.id)}
                  >
                    Retry delivery
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <RiSendPlaneLine
            aria-hidden="true"
            className="size-8 text-gray-400"
          />
          <h3 className="mt-3 font-semibold">No delivery jobs yet</h3>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Notification delivery activity will appear here when jobs are
            created.
          </p>
        </div>
      )}
      <Pagination
        currentPage={deliveryPage}
        itemCount={deliveries.length}
        label="Delivery operations"
        onPageChange={setDeliveryPage}
      />
    </Card>
  );

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="mt-6 flex items-start gap-3">
        <span className="rounded-lg bg-guardsman-red-50 p-2 text-guardsman-red-600 dark:bg-guardsman-red-950/30 dark:text-guardsman-red-400">
          <RiNotification3Line aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Stay up to date with account activity. Payment confirmations appear
            after reconciliation.
          </p>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">In-app notifications</h2>
            <Badge variant={enabled ? 'success' : 'neutral'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Receive payment, reversal, contribution, and arrears updates.
          </p>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          variant={enabled ? 'secondary' : 'primary'}
          isLoading={busy === 'preference'}
          loadingText="Saving"
          onClick={() => void setPreference(!enabled)}
        >
          {enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </Card>
      {role === 'administrator' ? (
        <Tabs defaultValue="inbox">
          <TabsList
            variant="solid"
            aria-label="Notification views"
            className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto"
          >
            <TabsTrigger value="inbox" className="gap-2">
              <RiInbox2Line aria-hidden="true" className="size-4" />
              <span>Inbox</span>
              {unreadCount ? (
                <span className="rounded-full bg-guardsman-red-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                  {unreadCount}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="deliveries" className="gap-2">
              <RiSendPlaneLine aria-hidden="true" className="size-4" />
              <span className="sm:hidden">Deliveries</span>
              <span className="hidden sm:inline">Delivery operations</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inbox" className="mt-4">
            {inbox}
          </TabsContent>
          <TabsContent value="deliveries" className="mt-4">
            {deliveryOperations}
          </TabsContent>
        </Tabs>
      ) : (
        <section aria-labelledby="inbox-heading">{inbox}</section>
      )}
    </div>
  );
}

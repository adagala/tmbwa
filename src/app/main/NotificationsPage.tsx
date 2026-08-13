import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import useUser from '@/hooks/useUser';
import {
  markNotificationRead, MemberNotification, NotificationDelivery, retryNotificationDelivery,
  subscribeToMemberNotifications, subscribeToNotificationDeliveries, subscribeToNotificationPreference,
  updateNotificationPreference,
} from '@/lib/firebase/notifications';

export default function NotificationsPage() {
  const { user, role } = useUser();
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!user) return;
    const unsubscribeNotifications = subscribeToMemberNotifications(user.uid, setNotifications);
    const unsubscribePreference = subscribeToNotificationPreference(user.uid, setEnabled);
    const unsubscribeDeliveries = role === 'administrator' ? subscribeToNotificationDeliveries(setDeliveries) : undefined;
    return () => { unsubscribeNotifications(); unsubscribePreference(); unsubscribeDeliveries?.(); };
  }, [role, user]);

  const setPreference = async (next: boolean) => {
    if (!user) return;
    setBusy('preference'); setError(undefined);
    try { await updateNotificationPreference(user.uid, next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your preference.'); }
    finally { setBusy(undefined); }
  };

  const retry = async (deliveryId: string) => {
    setBusy(deliveryId); setError(undefined);
    try { await retryNotificationDelivery(deliveryId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retry delivery.'); }
    finally { setBusy(undefined); }
  };

  return <div className="flex flex-col gap-6">
    <div><h1 className="mt-6 text-xl font-bold text-guardsman-red-600">Notifications</h1>
      <p className="mt-1 text-sm text-gray-600">Payment confirmations appear only after reconciliation is complete.</p></div>
    {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    <Card className="flex items-center justify-between gap-4">
      <div><h2 className="font-semibold">In-app notifications</h2><p className="text-sm text-gray-500">Receive payment, reversal, contribution, and arrears updates.</p></div>
      <Button variant={enabled ? 'secondary' : 'primary'} isLoading={busy === 'preference'} onClick={() => void setPreference(!enabled)}>{enabled ? 'Disable' : 'Enable'}</Button>
    </Card>
    <section className="space-y-3"><h2 className="font-semibold">Your inbox</h2>
      {notifications.map((notification) => <Card key={notification.id} className={notification.read ? 'opacity-70' : ''}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{notification.title}</h3><p className="mt-1 text-sm">{notification.body}</p><p className="mt-2 text-xs text-gray-500">{notification.createdAt?.toDate().toLocaleString('en-KE') ?? 'Sending'}</p></div>
          {!notification.read && user ? <Button variant="secondary" onClick={() => void markNotificationRead(user.uid, notification.id)}>Mark read</Button> : null}</div>
      </Card>)}
      {!notifications.length ? <p className="text-sm text-gray-500">No notifications yet.</p> : null}
    </section>
    {role === 'administrator' ? <section className="space-y-3"><h2 className="font-semibold">Delivery operations</h2>
      {deliveries.map((delivery) => <Card key={delivery.id} className="grid items-center gap-2 text-sm sm:grid-cols-5">
        <span className="break-all font-medium">{delivery.eventId}</span><span>Member: {delivery.memberId}</span><span>{delivery.channel}</span><span>{delivery.status} · {delivery.attempts} attempt(s)</span>
        <span>{['failed', 'dead_letter'].includes(delivery.status) ? <Button variant="secondary" isLoading={busy === delivery.id} onClick={() => void retry(delivery.id)}>Retry</Button> : null}</span>
      </Card>)}
      {!deliveries.length ? <p className="text-sm text-gray-500">No delivery jobs yet.</p> : null}
    </section> : null}
  </div>;
}

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/clientApp';
import { Card } from '@/components/Card';
import useUser from '@/hooks/useUser';
import { Navigate } from 'react-router-dom';

type AuditEvent = {
  requestId: string;
  actorId: string;
  action: string;
  memberId: string;
  targetId: string;
  createdAt?: Timestamp;
};

export default function AuditPage() {
  const { role } = useUser();
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    if (role !== 'administrator') return;
    return onSnapshot(
      query(collection(db, 'audit_events'), orderBy('createdAt', 'desc'), limit(100)),
      (snapshot) => setEvents(snapshot.docs.map((item) => item.data() as AuditEvent)),
    );
  }, [role]);

  if (role && role !== 'administrator') return <Navigate to="/profile" replace />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="mt-6 text-xl font-bold text-guardsman-red-600">Audit trail</h1>
      <div className="space-y-3">
        {events.map((event) => (
          <Card key={event.requestId} className="grid gap-2 sm:grid-cols-4 text-sm">
            <span className="font-semibold">{event.action}</span>
            <span>Member: {event.memberId}</span>
            <span>Actor: {event.actorId}</span>
            <span>{event.createdAt?.toDate().toLocaleString('en-KE') ?? 'Pending'}</span>
          </Card>
        ))}
        {events.length === 0 ? <p className="text-sm text-gray-500">No audit events found.</p> : null}
      </div>
    </div>
  );
}

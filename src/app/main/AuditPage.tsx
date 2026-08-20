import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/clientApp';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import useUser from '@/hooks/useUser';
import { Navigate } from 'react-router-dom';
import { AuditEvent, auditEventSchema } from 'tmbwa-shared/firebase';
import { parseDocument } from 'tmbwa-shared';

export default function AuditPage() {
  const { role } = useUser();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [pageSize, setPageSize] = useState(100);

  useEffect(() => {
    if (role !== 'administrator') return;
    return onSnapshot(
      query(
        collection(db, 'audit_events'),
        orderBy('createdAt', 'desc'),
        limit(pageSize),
      ),
      (snapshot) =>
        setEvents(
          snapshot.docs.map((item) =>
            parseDocument(auditEventSchema, item.data(), item.ref.path),
          ),
        ),
    );
  }, [pageSize, role]);

  if (role && role !== 'administrator')
    return <Navigate to="/profile" replace />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="mt-6 text-xl font-bold text-guardsman-red-600">
        Audit trail
      </h1>
      <div className="space-y-3">
        {events.map((event) => (
          <Card
            key={event.requestId}
            className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5"
          >
            <span className="font-semibold">{event.action}</span>
            <span>Member: {event.memberId}</span>
            <span>Target: {event.targetId}</span>
            <span>Actor: {event.actorId}</span>
            <span>
              {event.createdAt?.toDate().toLocaleString('en-KE') ?? 'Pending'}
            </span>
            <dl className="grid gap-1 sm:col-span-2 lg:col-span-5">
              {Object.entries(event.changes ?? {}).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="font-medium">{key}:</dt>
                  <dd className="break-all">
                    {Array.isArray(value) ? value.join(', ') : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No audit events found.</p>
        ) : null}
        {events.length === pageSize ? (
          <Button
            type="button"
            onClick={() => setPageSize((current) => current + 100)}
          >
            Load older events
          </Button>
        ) : null}
      </div>
    </div>
  );
}

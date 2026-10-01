import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { subscribePendingBeneficiaryRequestCount } from '@/lib/firebase/beneficiaries';

// Live count of beneficiary change requests awaiting review. Rendered only in
// administrator navigation; the rules deny the query to everyone else.
export function PendingBeneficiaryRequestCount() {
  const [count, setCount] = useState(0);
  useEffect(() => subscribePendingBeneficiaryRequestCount(setCount), []);
  if (count === 0) return null;
  return (
    <Badge variant="warning" className="ml-auto tabular-nums">
      {count}
      <span className="sr-only"> pending</span>
    </Badge>
  );
}

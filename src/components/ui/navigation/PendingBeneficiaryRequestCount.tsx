import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { subscribePendingBeneficiaryRequestCount } from '@/lib/firebase/beneficiaries';

// Live count of beneficiary change requests awaiting review. Rendered only in
// navigation for officers with beneficiaries.review; the rules deny the query
// to everyone without beneficiaries.read.
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

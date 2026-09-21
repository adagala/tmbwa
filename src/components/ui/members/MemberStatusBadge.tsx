import { Badge, type BadgeProps } from '@/components/Badge';
import { Member } from 'tmbwa-shared/firebase';

const statusVariants: Record<
  Member['status'],
  NonNullable<BadgeProps['variant']>
> = {
  active: 'success',
  inactive: 'neutral',
  suspended: 'warning',
  resigned: 'error',
  deceased: 'error',
};

export function MemberStatusBadge({ status }: { status: Member['status'] }) {
  return (
    <Badge variant={statusVariants[status]} className="capitalize">
      {status}
    </Badge>
  );
}

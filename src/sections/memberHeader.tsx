import React from 'react';
import { Member } from 'tmbwa-shared/firebase';
import { Avatar } from '@/components/Avatar';
import { MemberStatusBadge } from '@/components/ui/members/MemberStatusBadge';

const initials = (member: Member) =>
  `${member.firstname.charAt(0)}${member.lastname.charAt(0)}`.toUpperCase();

export function MemberHeader({
  member,
  actions,
}: {
  member: Member;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar
          initial={initials(member)}
          className="size-11 border-guardsman-red-500/15 bg-guardsman-red-500/10 text-sm text-guardsman-red-600 dark:border-guardsman-red-400/20 dark:bg-guardsman-red-400/10"
        />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-50">
            {member.firstname} {member.lastname}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <MemberStatusBadge status={member.status} />
            <span className="capitalize">{member.role}</span>
            <span aria-hidden="true">·</span>
            <span>{member.membernumber}</span>
            <span aria-hidden="true">·</span>
            <span>{member.win}</span>
          </div>
        </div>
      </div>
      {actions ? (
        <div className="flex items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}

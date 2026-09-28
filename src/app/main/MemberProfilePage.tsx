import { Member } from 'tmbwa-shared/firebase';
import {
  RiArrowLeftSLine,
  RiDeleteBinLine,
  RiLoaderLine,
  RiMoreFill,
} from '@remixicon/react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIconWrapper,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/Dropdown';
import { DialogDeleteMember } from '@/components/ui/members/DialogDeleteMember';
import { DialogMemberForm } from '@/components/ui/members/DialogMemberForm';
import { DialogMemberStatus } from '@/components/ui/members/DialogMemberStatus';
import { MemberStatusBadge } from '@/components/ui/members/MemberStatusBadge';
import { Suspense, useEffect, useState } from 'react';
import { getMemberById } from '@/lib/firebase/firestore';
import useUser from '@/hooks/useUser';
import { Link, useParams } from 'react-router-dom';
import { MemberAccount } from '@/sections/memberAccount';

const initials = (member: Member) =>
  `${member.firstname.charAt(0)}${member.lastname.charAt(0)}`.toUpperCase();

export default function MemberProfilePage() {
  const { role } = useUser();
  const { memberId } = useParams<{ memberId: string }>();
  const [member, setMember] = useState<Member | null>();
  const [isLoading, setIsLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (memberId) {
      setIsLoading(true);
      const unsubscribe = getMemberById(memberId, (fetchedMember) => {
        setMember(fetchedMember);
        setIsLoading(false);
      });

      return () => unsubscribe();
    }
  }, [memberId]);

  const isAdministrator = role === 'administrator';

  return (
    <Suspense fallback={<div>Loading...</div>}>
      {isLoading ? (
        <div className="flex justify-center items-center h-96">
          <div className="flex flex-col items-center space-y-3">
            <RiLoaderLine className="size-6 animate-spin" />
            <div className="font-medium">Loading Member</div>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <Button
            className="group w-fit text-xs font-normal"
            variant="ghost"
            asChild
          >
            <Link to="/members">
              <RiArrowLeftSLine className="size-4" aria-hidden="true" />
              Back to members
            </Link>
          </Button>

          {member ? (
            <>
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

                {isAdministrator ? (
                  <div className="flex items-center gap-1.5">
                    <DialogMemberStatus member={member} />
                    <DialogMemberForm
                      member={member}
                      triggerButton={
                        <Button variant="secondary">Edit member</Button>
                      }
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" aria-label="More actions">
                          <RiMoreFill className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-red-600 dark:text-red-500"
                          onSelect={() => setDeleteOpen(true)}
                        >
                          <span className="flex items-center gap-x-2">
                            <DropdownMenuIconWrapper>
                              <RiDeleteBinLine className="size-4 text-inherit" />
                            </DropdownMenuIconWrapper>
                            Delete member
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DialogDeleteMember
                      member={member}
                      open={deleteOpen}
                      onOpenChange={setDeleteOpen}
                    />
                  </div>
                ) : null}
              </div>

              <MemberAccount member={member} />
            </>
          ) : null}
        </div>
      )}
    </Suspense>
  );
}

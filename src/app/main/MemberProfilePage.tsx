import { Member } from 'tmbwa-shared/firebase';
import {
  RiArrowLeftSLine,
  RiDeleteBinLine,
  RiLoaderLine,
  RiMoreFill,
} from '@remixicon/react';
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
import { DialogMemberRoles } from '@/components/ui/members/DialogMemberRoles';
import { Suspense, useEffect, useState } from 'react';
import { getMemberById } from '@/lib/firebase/firestore';
import useUser from '@/hooks/useUser';
import { Link, useParams } from 'react-router-dom';
import { MemberAccount } from '@/sections/memberAccount';
import { MemberHeader } from '@/sections/memberHeader';

export default function MemberProfilePage() {
  const { role, can, user } = useUser();
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
  // No one manages their own roles; the backend refuses it too.
  const canManageRoles =
    can('roles.manage') && !!member && member.member_id !== user?.uid;

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
              <MemberHeader
                member={member}
                actions={
                  isAdministrator ? (
                    <>
                      <DialogMemberStatus member={member} />
                      {canManageRoles ? (
                        <DialogMemberRoles member={member} />
                      ) : null}
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
                    </>
                  ) : null
                }
              />

              <MemberAccount member={member} />
            </>
          ) : null}
        </div>
      )}
    </Suspense>
  );
}

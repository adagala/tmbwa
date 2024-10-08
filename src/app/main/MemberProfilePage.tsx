import { Profile } from '@/sections/profile';
import { Member, Contribution } from '@/schemas/member';
import { RiArrowLeftSLine, RiLoaderLine, RiUserLine } from '@remixicon/react';
import { Button } from '@/components/Button';
import { DialogDeleteMember } from '@/components/ui/members/DialogDeleteMember';
import { DialogMemberForm } from '@/components/ui/members/DialogMemberForm';
import { Contributions } from '@/sections/contributions';
import { Suspense, useEffect, useState } from 'react';
import {
  getMemberById,
  getMemberContributions,
} from '@/lib/firebase/firestore';
import useUser from '@/hooks/useUser';
import { Link, useParams } from 'react-router-dom';

export default function MemberProfilePage() {
  const { role } = useUser();
  const { memberId } = useParams<{ memberId: string }>();
  const [member, setMember] = useState<Member | null>();
  const [isLoading, setIsLoading] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);

  useEffect(() => {
    if (memberId) {
      const unsubscribe = getMemberById(memberId, (fetchedMember) => {
        setMember(fetchedMember);
      });

      return () => unsubscribe();
    }
  }, [memberId]);

  useEffect(() => {
    if (memberId) {
      setIsLoading(true);
      const unsubscribe = getMemberContributions(
        (contributions) => {
          setContributions(contributions);
          setIsLoading(false);
        },
        { memberId },
      );
      return () => unsubscribe();
    }
  }, [memberId]);

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
        <div className="flex flex-col gap-8">
          <div className="mt-6 text-xl font-medium flex items-center gap-1">
            <RiUserLine className="size-6 shrink-0" aria-hidden="true" />
            Member Profile
          </div>

          <div className="">
            <div className="px-4 sm:px-0 flex justify-between items-center">
              <div className="max-w-2xl text-sm font-medium leading-6 text-gray-500 dark:text-gray-200">
                Member details.
              </div>
              <Button
                className="group text-xs font-normal"
                variant="secondary"
                asChild
              >
                <Link to="/members">
                  <RiArrowLeftSLine className="size-4" aria-hidden="true" />
                  Back to members
                </Link>
              </Button>
            </div>
            {member ? <Profile member={member} ownProile={false} /> : null}
          </div>

          <div className="flex flex-col sm:flex-row gap-1 sm:justify-end">
            {member ? (
              <>
                {role === 'administrator' ? (
                  <DialogMemberForm member={member} />
                ) : null}
                {role === 'administrator' ? (
                  <DialogDeleteMember member={member} />
                ) : null}
              </>
            ) : null}
          </div>

          {isLoading ? (
            <div className="flex justify-center items-center h-96">
              <div className="flex flex-col items-center space-y-3">
                <RiLoaderLine className="size-6 animate-spin" />
                <div className="font-medium">Loading Contributions</div>
              </div>
            </div>
          ) : (
            <>
              {member ? (
                <Contributions member={member} contributions={contributions} />
              ) : null}{' '}
            </>
          )}
        </div>
      )}
    </Suspense>
  );
}

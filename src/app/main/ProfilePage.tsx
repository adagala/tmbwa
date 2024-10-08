import { Contributions } from '@/sections/contributions';
import { Profile } from '@/sections/profile';
import { Contribution, Member } from '@/schemas/member';
import { RiLoaderLine, RiUserLine } from '@remixicon/react';
import useUser from '@/hooks/useUser';
import { useEffect, useState } from 'react';
import {
  getMemberById,
  getMemberContributions,
} from '@/lib/firebase/firestore';

export default function ProfilePage() {
  const { user } = useUser();
  const [member, setMember] = useState<Member | null>();
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user?.uid) {
      const unsubscribe = getMemberById(user.uid, (fetchedMember) => {
        setMember(fetchedMember);
      });

      return () => unsubscribe();
    }
  }, [user?.uid]);

  useEffect(() => {
    if (user?.uid) {
      setIsLoading(true);
      const unsubscribe = getMemberContributions(
        (contributions) => {
          setContributions(contributions);
          setIsLoading(false);
        },
        { memberId: user.uid },
      );
      return () => unsubscribe();
    }
  }, [user?.uid]);

  return (
    <div className="flex flex-col gap-8">
      <div className="mt-6 text-xl font-bold flex items-center gap-1 text-guardsman-red-600 dark:text-gray-200">
        <RiUserLine className="size-6 shrink-0" aria-hidden="true" />
        Profile
      </div>

      <div>
        <div className="px-4 sm:px-0">
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-200">
            Personal details.
          </p>
        </div>
        {member ? <Profile member={member} ownProile={true} /> : null}
        {isLoading ? (
          <div className="flex justify-center items-center h-96">
            <div className="flex flex-col items-center space-y-3">
              <RiLoaderLine className="size-6 animate-spin" />
              <div className="font-medium">Loading Contribution history</div>
            </div>
          </div>
        ) : (
          <>
            {member ? (
              <Contributions
                className="mt-8"
                member={member}
                contributions={contributions}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

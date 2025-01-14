import { Profile } from '@/sections/profile';
import { Member } from '@/schemas/member';
import { RiUserLine } from '@remixicon/react';
import useUser from '@/hooks/useUser';
import { useEffect, useState } from 'react';
import { getMemberById } from '@/lib/firebase/firestore';
import { ContributionsAndTransactions } from '@/sections/contributionsAndTansactions';

export default function ProfilePage() {
  const { user } = useUser();
  const [member, setMember] = useState<Member | null>();

  useEffect(() => {
    if (user?.uid) {
      const unsubscribe = getMemberById(user.uid, (fetchedMember) => {
        setMember(fetchedMember);
      });

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
        {member ? (
          <>
            <Profile member={member} ownProile={true} />
            <ContributionsAndTransactions member={member} />
          </>
        ) : null}
      </div>
    </div>
  );
}

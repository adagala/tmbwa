import { Member } from 'tmbwa-shared/firebase';
import { RiEdit2Line, RiLoaderLine } from '@remixicon/react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import useUser from '@/hooks/useUser';
import { useEffect, useState } from 'react';
import { getMemberById } from '@/lib/firebase/firestore';
import { MemberAccount } from '@/sections/memberAccount';
import { MemberHeader } from '@/sections/memberHeader';

export default function ProfilePage() {
  const { user, role, roles } = useUser();
  const [member, setMember] = useState<Member | null>();

  useEffect(() => {
    if (user?.uid && role) {
      const unsubscribe = getMemberById(
        user.uid,
        (fetchedMember) => {
          setMember(fetchedMember);
        },
        { role, roles, user },
      );

      return () => unsubscribe();
    }
  }, [user?.uid]);

  if (member === undefined) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="flex flex-col items-center space-y-3">
          <RiLoaderLine className="size-6 animate-spin" />
          <div className="font-medium">Loading profile</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {member ? (
        <>
          <MemberHeader
            member={member}
            actions={
              <Button variant="secondary" asChild>
                <Link to="/settings" className="gap-1.5">
                  <RiEdit2Line className="size-4" aria-hidden="true" />
                  Edit personal details
                </Link>
              </Button>
            }
          />
          <MemberAccount member={member} ownProfile />
        </>
      ) : null}
    </div>
  );
}

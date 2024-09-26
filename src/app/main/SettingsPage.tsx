import {
  RiLockPasswordLine,
  RiSettings5Line,
  RiUserLine,
} from '@remixicon/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import React from 'react';
import { UpdatePassword } from '@/components/ui/settings/UpdatePassword';
import { UpdatePersonalDetails } from '@/components/ui/settings/UpdatePersonalDetails';
import useUser from '@/hooks/useUser';
import { getMemberById } from '@/lib/firebase/firestore';
import { Member } from '@/schemas/member';

export default function SettingsPage() {
  const { user } = useUser();
  const [member, setMember] = React.useState<Member | null>();

  React.useEffect(() => {
    if (user?.uid) {
      const unsubscribe = getMemberById(user?.uid, (fetchedMember) => {
        setMember(fetchedMember);
      });

      return () => unsubscribe();
    }
  }, [user?.uid]);
  return (
    <div className="flex flex-col gap-8">
      <div className="mt-6 text-xl font-medium flex items-center gap-1">
        <RiSettings5Line className="size-6 shrink-0" aria-hidden="true" />
        Settings
      </div>
      <Tabs defaultValue="tab1">
        <TabsList variant="line">
          <TabsTrigger value="tab1" className="inline-flex gap-2">
            <RiUserLine className="-ml-1 size-4" aria-hidden="true" />
            General
          </TabsTrigger>
          <TabsTrigger value="tab2" className="inline-flex gap-2">
            <RiLockPasswordLine className="-ml-1 size-4" aria-hidden="true" />
            Authentication
          </TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="tab1">
            {member ? <UpdatePersonalDetails member={member} /> : null}
          </TabsContent>
          <TabsContent value="tab2">
            <UpdatePassword />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

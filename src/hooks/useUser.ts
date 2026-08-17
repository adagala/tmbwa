import { User, onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from '@/lib/firebase/clientApp';
import { MemberRole } from 'tmbwa-shared';

export default function useUser() {
  const [user, setUser] = useState<User | null>();
  const [role, setRole] = useState<MemberRole>();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      const idTokenResult = await authUser?.getIdTokenResult();
      const role = idTokenResult?.claims.role as MemberRole;
      setRole(role);
      setUser(authUser);
    });

    return () => unsubscribe();
  }, []);

  return { user, role };
}

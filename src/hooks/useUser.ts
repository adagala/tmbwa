import { User, onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from '@/lib/firebase/clientApp';
import { Role } from '@/schemas/member';

export default function useUser() {
  const [user, setUser] = useState<User | null>();
  const [role, setRole] = useState<Role>();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      const idTokenResult = await authUser?.getIdTokenResult();
      const role = idTokenResult?.claims.role as Role;
      setRole(role);
      setUser(authUser);
    });

    return () => unsubscribe();
  }, []);

  return { user, role };
}

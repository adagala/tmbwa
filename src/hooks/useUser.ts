import { User, onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from '@/lib/firebase/clientApp';
import {
  Permission,
  Role,
  roleHasPermission,
  rolesFromClaims,
} from 'tmbwa-shared';

// `user` is undefined until the auth state is known, null when signed out.
export default function useUser() {
  const [user, setUser] = useState<User | null>();
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      const idTokenResult = await authUser?.getIdTokenResult();
      setRoles(rolesFromClaims(idTokenResult?.claims));
      setUser(authUser);
    });

    return () => unsubscribe();
  }, []);

  // Interface hint only: trusted commands and Firestore rules enforce access.
  const can = (permission: Permission) => roleHasPermission(roles, permission);

  return { user, roles, can };
}

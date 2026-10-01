import { User, onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from '@/lib/firebase/clientApp';
import {
  MemberRole,
  Permission,
  Role,
  roleHasPermission,
  rolesFromClaims,
} from 'tmbwa-shared';

export default function useUser() {
  const [user, setUser] = useState<User | null>();
  const [role, setRole] = useState<MemberRole>();
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      const idTokenResult = await authUser?.getIdTokenResult();
      const claims = idTokenResult?.claims;
      setRole(claims?.role as MemberRole);
      setRoles(rolesFromClaims(claims));
      setUser(authUser);
    });

    return () => unsubscribe();
  }, []);

  // Interface hint only: trusted commands and Firestore rules enforce access.
  const can = (permission: Permission) => roleHasPermission(roles, permission);

  return { user, role, roles, can };
}

import { Navigate } from 'react-router-dom';
import { Permission } from 'tmbwa-shared';
import Loader from '@/sections/Loader';
import useUser from '@/hooks/useUser';
import { landingPath } from '@/lib/access';

// Interface guard only: Firestore rules and trusted commands enforce access.
const PermissionRoute = ({
  permission,
  element,
}: {
  permission: Permission;
  element: JSX.Element;
}) => {
  const { user, roles, can } = useUser();

  if (user === undefined) {
    return <Loader />;
  }

  if (!can(permission)) {
    return <Navigate to={landingPath(roles)} replace />;
  }

  return element;
};

export default PermissionRoute;

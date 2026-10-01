import useUser from '@/hooks/useUser';
import Loader from '@/sections/Loader';
import { Navigate } from 'react-router-dom';
import { landingPath } from '@/lib/access';

export default function RoleLandingRoute() {
  const { user, roles } = useUser();

  if (user === undefined) {
    return <Loader />;
  }

  if (!user) {
    return <Navigate to="/auth/signin" replace />;
  }

  return <Navigate to={landingPath(roles)} replace />;
}

import useUser from '@/hooks/useUser';
import Loader from '@/sections/Loader';
import { Navigate } from 'react-router-dom';

export default function RoleLandingRoute() {
  const { user, role } = useUser();

  if (user === undefined || (user && role === undefined)) {
    return <Loader />;
  }

  if (!user) {
    return <Navigate to="/auth/signin" replace />;
  }

  return (
    <Navigate
      to={role === 'administrator' ? '/overview' : '/profile'}
      replace
    />
  );
}

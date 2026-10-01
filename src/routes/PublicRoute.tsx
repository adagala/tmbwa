import { Navigate, useLocation } from 'react-router-dom';
import useUser from '../hooks/useUser';
import Loader from '@/sections/Loader';
import { getPostSignInPath } from './authRedirect';
import { landingPath } from '@/lib/access';

const PublicRoute = ({ element }: { element: JSX.Element }) => {
  const { user, roles } = useUser();
  const location = useLocation();

  if (user === undefined) {
    return <Loader />;
  }

  if (user) {
    const requestedPath = getPostSignInPath(location.state);

    return <Navigate to={requestedPath ?? landingPath(roles)} replace />;
  }

  return element;
};

export default PublicRoute;

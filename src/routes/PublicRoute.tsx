import { Navigate, useLocation } from 'react-router-dom';
import useUser from '../hooks/useUser';
import Loader from '@/sections/Loader';
import { getPostSignInPath } from './authRedirect';

const PublicRoute = ({ element }: { element: JSX.Element }) => {
  const { user, role } = useUser();
  const location = useLocation();

  if (user === undefined || (user && role === undefined)) {
    return <Loader />;
  }

  if (user) {
    const requestedPath = getPostSignInPath(location.state);

    return (
      <Navigate
        to={
          requestedPath ?? (role === 'administrator' ? '/overview' : '/profile')
        }
        replace
      />
    );
  }

  return element;
};

export default PublicRoute;

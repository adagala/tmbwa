import { Navigate } from 'react-router-dom';
import useUser from '../hooks/useUser';
import Loader from '@/sections/Loader';

const PublicRoute = ({ element }: { element: JSX.Element }) => {
  const { user, role } = useUser();

  if (user === undefined || (user && role === undefined)) {
    return <Loader />;
  }

  if (user) {
    return (
      <Navigate
        to={role === 'administrator' ? '/overview' : '/profile'}
        replace
      />
    );
  }

  return element;
};

export default PublicRoute;

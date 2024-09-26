import { Navigate } from 'react-router-dom';
import useUser from '../hooks/useUser';
import Loader from '@/sections/Loader';

const PublicRoute = ({ element }: { element: JSX.Element }) => {
  const { user } = useUser();

  if (user === undefined) {
    return <Loader />;
  }

  if (user) {
    return <Navigate to="/overview" replace />;
  }

  return element;
};

export default PublicRoute;

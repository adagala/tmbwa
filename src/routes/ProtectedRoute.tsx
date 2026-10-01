import { Navigate, useLocation } from 'react-router-dom';
import useUser from '../hooks/useUser';
import Loader from '@/sections/Loader';

const ProtectedRoute = ({ element }: { element: JSX.Element }) => {
  const { user } = useUser();
  const location = useLocation();

  if (user === undefined) {
    return <Loader />;
  }

  if (user === null) {
    return <Navigate to="/auth/signin" replace state={{ from: location }} />;
  }

  return element;
};

export default ProtectedRoute;

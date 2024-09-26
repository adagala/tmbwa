import { Navigate } from 'react-router-dom';
import useUser from '../hooks/useUser';
import Loader from '@/sections/Loader';

const ProtectedRoute = ({ element }: { element: JSX.Element }) => {
  const { user } = useUser();

  if (user === undefined) {
    return <Loader />;
  }

  if (user === null) {
    return <Navigate to="/auth/signin" replace />;
  }

  return element;
};

export default ProtectedRoute;

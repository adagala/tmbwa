import { Navigate } from 'react-router-dom';
import Loader from '@/sections/Loader';
import useUser from '@/hooks/useUser';

const AdministratorRoute = ({ element }: { element: JSX.Element }) => {
  const { role } = useUser();

  if (role === undefined) {
    return <Loader />;
  }

  if (role !== 'administrator') {
    return <Navigate to="/profile" replace />;
  }

  return element;
};

export default AdministratorRoute;

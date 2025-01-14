import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthLayout from '../app/auth/AuthLayout';
import ResetPassword from '../app/auth/ResetPassword';
import LogIn from '../app/auth/SignIn';
import OverviewPage from '../app/main/OverviewPage';
import MainLayout from '../app/main/MainLayout';
import MembersPage from '../app/main/MembersPage';
import ContributionsPage from '../app/main/ContributionsPage';
import ProfilePage from '../app/main/ProfilePage';
import SettingsPage from '../app/main/SettingsPage';
import MemberProfilePage from '../app/main/MemberProfilePage';
import ProtectedRoute from './ProtectedRoute';
import PublicRoute from './PublicRoute';
import ReportPage from '../app/main/ReportPage';

export const router = createBrowserRouter([
  {
    path: 'auth',
    element: <PublicRoute element={<AuthLayout />} />,
    children: [
      {
        index: true,
        element: <Navigate to="signin" replace />,
      },
      {
        path: 'signin',
        element: <LogIn />,
      },
      {
        path: 'reset-password',
        element: <ResetPassword />,
      },
    ],
  },
  {
    path: '/',
    element: <ProtectedRoute element={<MainLayout />} />,
    children: [
      {
        index: true,
        element: <Navigate to="overview" replace />,
      },
      {
        path: 'overview',
        element: <OverviewPage />,
      },
      {
        path: 'members',
        element: <MembersPage />,
      },
      {
        path: 'members/:memberId',
        element: <MemberProfilePage />,
      },
      {
        path: 'contributions',
        element: <ContributionsPage />,
      },
      {
        path: 'profile',
        element: <ProfilePage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: 'report',
        element: <ReportPage />,
      },
    ],
  },
]);

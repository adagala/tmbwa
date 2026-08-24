import { RouterProvider } from 'react-router-dom';
import { Toaster } from './components/Toaster';
import { router } from './routes/routes';

export default function Application() {
  return (
    <div className="mx-auto min-h-screen max-w-screen-2xl antialiased dark:bg-gray-950 dark:text-gray-200">
      <RouterProvider router={router} />
      <Toaster />
    </div>
  );
}

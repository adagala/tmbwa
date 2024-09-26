import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/routes.tsx';
import { Toaster } from './components/Toaster';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div
      className={`antialiased min-h-screen mx-auto max-w-screen-2xl dark:bg-gray-950 dark:text-gray-200`}
    >
      <RouterProvider router={router} />
      <Toaster />
    </div>
  </React.StrictMode>,
);

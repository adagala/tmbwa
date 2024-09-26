import { Sidebar } from '@/components/ui/navigation/sidebar';
import { Outlet } from 'react-router-dom';

export default function MainLayout() {
  return (
    <div className="relative">
      <Sidebar />
      <main className="lg:pl-80 p-4 sm:px-6 sm:pb-10 sm:pt-10 lg:px-10 lg:pt-7">
        <Outlet />
      </main>
    </div>
  );
}

import { Sidebar } from '@/components/ui/navigation/sidebar';
import { Outlet, useMatches } from 'react-router-dom';
import {
  isMaintenanceMode,
  isRouteAvailableDuringMaintenance,
} from '@/lib/maintenance';
import MaintenancePage from '@/sections/MaintenancePage';

export default function MainLayout() {
  const matches = useMatches();
  const showMaintenance =
    isMaintenanceMode && !isRouteAvailableDuringMaintenance(matches);

  return (
    <div className="relative">
      <Sidebar />
      <main className="lg:pl-80 p-4 sm:px-6 sm:pb-10 sm:pt-10 lg:px-10 lg:pt-7">
        {showMaintenance ? <MaintenancePage embedded /> : <Outlet />}
      </main>
    </div>
  );
}

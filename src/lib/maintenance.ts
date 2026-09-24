import type { UIMatch } from 'react-router-dom';

export const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true';

export type MaintenanceRouteHandle = {
  availableDuringMaintenance?: boolean;
};

// Opt a route into staying reachable while maintenance mode is on.
export const availableDuringMaintenance: MaintenanceRouteHandle = {
  availableDuringMaintenance: true,
};

export function isRouteAvailableDuringMaintenance(matches: UIMatch[]) {
  const leaf = matches[matches.length - 1];
  const handle = leaf?.handle as MaintenanceRouteHandle | undefined;

  return handle?.availableDuringMaintenance === true;
}

import {
  RemixiconComponentType,
  RiBookOpenLine,
  RiUserLine,
} from '@remixicon/react';
import { matchPath, type UIMatch } from 'react-router-dom';

export const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE === 'true';

export type MaintenanceAvailablePage = {
  label: string;
  to: string;
  icon: RemixiconComponentType;
};

// Pages that stay reachable while maintenance mode is on. They are also listed
// on the maintenance screen.
export const maintenanceAvailablePages: MaintenanceAvailablePage[] = [
  { label: 'User guide', to: '/help/user-guide', icon: RiBookOpenLine },
  { label: 'Profile', to: '/profile', icon: RiUserLine },
];

export function isRouteAvailableDuringMaintenance(matches: UIMatch[]) {
  const leaf = matches[matches.length - 1];
  if (!leaf) return false;

  return maintenanceAvailablePages.some((page) =>
    matchPath({ path: page.to, end: true }, leaf.pathname),
  );
}

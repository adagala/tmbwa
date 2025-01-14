import {
  RiHome2Line,
  RiGroupLine,
  RiWalletLine,
  RiUserLine,
  RiSettings5Line,
  RiFileTextLine,
} from '@remixicon/react';

export const siteConfig = {
  name: 'Dashboard',
  url: '',
  description: 'The only dashboard you will ever need.',
  baseLinks: {
    home: '/',
    overview: '/overview',
    members: '/members',
    contributions: '/contributions',
    profile: '/profile',
    settings: '/settings',
  },
  externalLink: {},
};

export type siteConfig = typeof siteConfig;

export const navigation = [
  { name: 'Overview', href: siteConfig.baseLinks.overview, icon: RiHome2Line },
  { name: 'Members', href: siteConfig.baseLinks.members, icon: RiGroupLine },
  {
    name: 'Contributions',
    href: siteConfig.baseLinks.contributions,
    icon: RiWalletLine,
  },
  { name: 'Profile', href: siteConfig.baseLinks.profile, icon: RiUserLine },
  {
    name: 'Settings',
    href: siteConfig.baseLinks.settings,
    icon: RiSettings5Line,
  },
  {
    name: 'Report',
    href: '/report',
    icon: RiFileTextLine,
  },
] as const;

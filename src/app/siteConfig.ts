import {
  RiHome2Line,
  RiGroupLine,
  RiWalletLine,
  RiUserLine,
  RiSettings5Line,
  RiFileTextLine,
  RiHistoryLine,
  RiNotification3Line,
  RiBookOpenLine,
  RiExchange2Line,
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
    userGuide: '/help/user-guide',
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
    administratorOnly: true,
  },
  {
    name: 'Audit trail',
    href: '/audit',
    icon: RiHistoryLine,
    administratorOnly: true,
  },
  {
    name: 'KCB Reconciliation',
    href: '/kcb-reconciliation',
    icon: RiExchange2Line,
    administratorOnly: true,
  },
  {
    name: 'Notifications',
    href: '/notifications',
    icon: RiNotification3Line,
  },
  {
    name: 'Help & User Guides',
    href: siteConfig.baseLinks.userGuide,
    icon: RiBookOpenLine,
  },
] as const;

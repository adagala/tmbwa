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
  RiHeartsLine,
} from '@remixicon/react';
import { pagePermissions } from '@/lib/access';

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
  {
    name: 'Overview',
    href: siteConfig.baseLinks.overview,
    icon: RiHome2Line,
    permission: pagePermissions.overview,
  },
  {
    name: 'Members',
    href: siteConfig.baseLinks.members,
    icon: RiGroupLine,
    permission: pagePermissions.members,
  },
  {
    name: 'Contributions',
    href: siteConfig.baseLinks.contributions,
    icon: RiWalletLine,
    permission: pagePermissions.contributions,
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
    permission: pagePermissions.report,
  },
  {
    name: 'Audit trail',
    href: '/audit',
    icon: RiHistoryLine,
    permission: pagePermissions.audit,
  },
  {
    name: 'KCB Reconciliation',
    href: '/kcb-reconciliation',
    icon: RiExchange2Line,
    permission: pagePermissions.kcbReconciliation,
  },
  {
    name: 'Beneficiary requests',
    href: '/beneficiary-requests',
    icon: RiHeartsLine,
    permission: pagePermissions.beneficiaryRequests,
    showPendingBeneficiaryCount: true,
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

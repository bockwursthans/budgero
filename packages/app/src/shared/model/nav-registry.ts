import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import {
  Activity,
  User,
  CreditCard,
  Shield,
  Users,
  Inbox,
  Tag,
  ArchiveRestore,
  History,
  Database,
  SlidersHorizontal,
  Coins,
  Layers,
  RefreshCw,
  Plug,
  Bot,
  Building2,
  Palette,
  Info,
  FileText,
  SquarePlus,
  LayoutGrid,
  Scale,
  type LucideIcon,
} from 'lucide-react';

export interface NavRouteItem {
  to: string;
  icon: LucideIcon;
  label: MessageDescriptor;
  exact?: boolean;
  selfHostHidden?: boolean;
  devOnly?: boolean;
  beta?: boolean;
}

/** Household settlement: who owes whom for shared expenses (a report). */
export const NAV_HOUSEHOLD_SETTLEMENT: NavRouteItem = {
  to: '/reports/settlement',
  icon: Scale,
  label: msg`Household settlement`,
  beta: true,
};

/** Reports submenu links (all indented `ml-4 mr-2`). */
export const NAV_REPORTS: NavRouteItem[] = [
  { to: '/reports', icon: FileText, label: msg`All reports` },
  { to: '/reports/question/new', icon: SquarePlus, label: msg`New question` },
  { to: '/reports/dashboards', icon: LayoutGrid, label: msg`Custom Dashboards`, exact: false },
  NAV_HOUSEHOLD_SETTLEMENT,
];

/** Settings → Account & Access links (only shown when not a self-hostable build). */
export const NAV_SETTINGS_ACCOUNT: NavRouteItem[] = [
  {
    to: '/settings/account',
    icon: User,
    label: msg({ message: 'Account', context: 'settings-section' }),
  },
  { to: '/settings/subscription', icon: CreditCard, label: msg`Subscription` },
  { to: '/settings/security', icon: Shield, label: msg`Security & Privacy` },
];

/** Settings → Workspaces: members and invites. */
export const NAV_WORKSPACES: NavRouteItem = {
  to: '/settings/workspaces',
  icon: Users,
  label: msg`Workspaces`,
};

/** Settings → Budgets & Data links. */
export const NAV_SETTINGS_DATA: NavRouteItem[] = [
  NAV_WORKSPACES,
  { to: '/settings/imports', icon: Inbox, label: msg`Imports` },
  { to: '/settings/payees', icon: User, label: msg`Payees` },
  { to: '/settings/labels', icon: Tag, label: msg`Labels` },
  { to: '/settings/audit-log', icon: History, label: msg`Audit Log` },
  { to: '/settings/data', icon: Database, label: msg`Data Management` },
  { to: '/settings/sync', icon: Activity, label: msg`Sync status` },
  { to: '/settings/sync/history', icon: ArchiveRestore, label: msg`Earlier versions`, beta: true },
  { to: '/settings/budget', icon: SlidersHorizontal, label: msg`Budget Settings` },
  { to: '/settings/currencies', icon: Coins, label: msg`Currencies` },
];

/** Settings → Automation & Integrations links. */
export const NAV_SETTINGS_AUTOMATION: NavRouteItem[] = [
  { to: '/settings/rules', icon: Layers, label: msg`Rules` },
  { to: '/settings/recurring', icon: RefreshCw, label: msg`Recurring` },
  { to: '/settings/api', icon: Plug, label: msg`Push API` },
  { to: '/settings/ai', icon: Bot, label: msg`AI Assistant` },
  { to: '/settings/bank-sync', icon: Building2, label: msg`Bank sync`, beta: true },
];

/** Settings → Preferences links. */
export const NAV_SETTINGS_PREFERENCES: NavRouteItem[] = [
  { to: '/settings/appearance', icon: Palette, label: msg`Appearance` },
  { to: '/settings/about', icon: Info, label: msg`About` },
];

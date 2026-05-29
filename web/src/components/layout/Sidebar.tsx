// Sidebar navigation entries consumed by Layout and other navigation surfaces.
// Keeping entries as data lets the command palette and admin index share the
// same source of truth.

import type { ComponentType, SVGProps } from 'react';
import { Activity, ScrollText, ShieldCheck } from 'lucide-react';

/**
 * Stable shape for a single sidebar nav entry. The `to` field is the
 * route-registry path (matches `ROUTE_REGISTRY[].path`); the
 * `i18nKey` mirrors the registry's `i18nKey` so labels stay in sync.
 */
export interface SidebarNavEntry {
  /** Route path matching ROUTE_REGISTRY. */
  to: string;
  /** i18n key for the visible label. */
  i18nKey: string;
  /** English fallback used when the i18n key is missing. */
  defaultLabel: string;
  /** Lucide-react icon component. */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * Logical section the entry belongs to. The Layout splice maps
   * sections onto its existing accordions ("Settings & Admin",
   * "Infrastructure", etc.). New entries default to 'admin'.
   */
  section: 'admin' | 'infrastructure' | 'tools';
}

/** Diagnostic route entry for infrastructure navigation. */
export const DIAGNOSTIC_NAV_ENTRY: SidebarNavEntry = {
  to: '/diagnostic',
  i18nKey: 'diagnostic.title',
  defaultLabel: 'System diagnostic',
  icon: Activity,
  section: 'infrastructure',
};

/** SSE-backed live log viewer with grep and level filters. */
export const LIVE_LOGS_NAV_ENTRY: SidebarNavEntry = {
  to: '/live-logs',
  i18nKey: 'liveLogs.title',
  defaultLabel: 'Live logs',
  icon: ScrollText,
  section: 'infrastructure',
};

/** RBAC matrix admin entry; the page explains open-auth mode limitations. */
export const RBAC_NAV_ENTRY: SidebarNavEntry = {
  to: '/admin/rbac',
  i18nKey: 'rbac.title',
  defaultLabel: 'RBAC matrix',
  icon: ShieldCheck,
  section: 'admin',
};

/** Sidebar nav entries exported as a shared registry. */
export const SIDEBAR_NAV_ENTRIES: readonly SidebarNavEntry[] = [
  DIAGNOSTIC_NAV_ENTRY,
  LIVE_LOGS_NAV_ENTRY,
  RBAC_NAV_ENTRY,
];

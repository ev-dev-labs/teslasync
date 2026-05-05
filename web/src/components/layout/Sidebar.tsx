// Sidebar — Phase-46 / Prompt 33
//
// The actual sidebar markup lives in `Layout.tsx` (outside the
// allowed-files regex for this prompt). This module exports a typed
// "nav entry" shape plus the diagnostic entry so a follow-up prompt
// can splice it into the Layout's "Settings & Admin" section without
// re-deriving the icon import or the i18n key path.
//
// Treating the nav entries as data (rather than JSX) also lets the
// command palette and the admin index page consume the same source
// of truth in the future.

import type { ComponentType, SVGProps } from 'react';
import { Activity, ScrollText } from 'lucide-react';

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

/**
 * The diagnostic entry. Imported by a future Layout.tsx splice —
 * for this prompt we ship the data only.
 */
export const DIAGNOSTIC_NAV_ENTRY: SidebarNavEntry = {
  to: '/diagnostic',
  i18nKey: 'diagnostic.title',
  defaultLabel: 'System diagnostic',
  icon: Activity,
  section: 'infrastructure',
};

/**
 * Live log tail viewer (Phase-46 / Prompt 34). SSE-backed admin
 * surface that streams structured zerolog events with grep + level
 * filters. Lives under "Infrastructure" alongside the diagnostic.
 */
export const LIVE_LOGS_NAV_ENTRY: SidebarNavEntry = {
  to: '/live-logs',
  i18nKey: 'liveLogs.title',
  defaultLabel: 'Live logs',
  icon: ScrollText,
  section: 'infrastructure',
};

/**
 * All sidebar nav entries this prompt contributes. Kept as an array
 * so future prompts can append without changing the call signature.
 */
export const SIDEBAR_NAV_ENTRIES: readonly SidebarNavEntry[] = [
  DIAGNOSTIC_NAV_ENTRY,
  LIVE_LOGS_NAV_ENTRY,
];

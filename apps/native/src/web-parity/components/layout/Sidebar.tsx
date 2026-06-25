// Native parity port of web/src/components/layout/Sidebar.tsx.
//
// Sidebar navigation entries consumed by Layout and other navigation surfaces.
// Keeping entries as data lets the command palette and admin index share the
// same source of truth. This is a pure data/types module — there is no JSX,
// no state, and no browser API to port; the only web-only dependency is the
// lucide-react icon component reference on each entry.
//
// Native adaptation (documented in the .parity.json sidecar):
//   - The web `icon: ComponentType<SVGProps<SVGSVGElement>>` field held an
//     actual lucide-react component (Activity / ScrollText / ShieldCheck).
//     SVGProps is a DOM type and lucide-react is a DOM-only icon set, so the
//     field type becomes `SemanticIconName` (the native icon contract used by
//     Layout's NavItem) and each value is the matching SemanticIcon glyph the
//     native <SemanticIcon /> renders for the same visual intent:
//       Activity    -> 'activity'      (matches Layout's Diagnostics section icon)
//       ScrollText  -> 'fileText'      (a lined text document — the log scroll)
//       ShieldCheck -> 'securityCheck' (a shield with a check mark)
//   - Everything else (route `to` paths, `i18nKey`, `defaultLabel`, `section`,
//     and the exported entry/registry shape) is preserved verbatim.

import type {SemanticIconName} from '../../../components/icons/SemanticIcon';

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
  /**
   * Native icon name. The web source used a lucide-react component here; the
   * native parity layer renders the matching glyph via <SemanticIcon />.
   */
  icon: SemanticIconName;
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
  icon: 'activity',
  section: 'infrastructure',
};

/** SSE-backed live log viewer with grep and level filters. */
export const LIVE_LOGS_NAV_ENTRY: SidebarNavEntry = {
  to: '/live-logs',
  i18nKey: 'liveLogs.title',
  defaultLabel: 'Live logs',
  icon: 'fileText',
  section: 'infrastructure',
};

/** RBAC matrix admin entry; the page explains open-auth mode limitations. */
export const RBAC_NAV_ENTRY: SidebarNavEntry = {
  to: '/admin/rbac',
  i18nKey: 'rbac.title',
  defaultLabel: 'RBAC matrix',
  icon: 'securityCheck',
  section: 'admin',
};

/** Sidebar nav entries exported as a shared registry. */
export const SIDEBAR_NAV_ENTRIES: readonly SidebarNavEntry[] = [
  DIAGNOSTIC_NAV_ENTRY,
  LIVE_LOGS_NAV_ENTRY,
  RBAC_NAV_ENTRY,
];

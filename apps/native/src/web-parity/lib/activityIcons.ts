/**
 * Maps audit-log action strings (as written by the Go API into
 * `audit_logs.action`) to a visual + i18n key for the per-user activity
 * feed.
 *
 * The lookup is best-effort: many actions follow `domain.verb` or
 * `domain.entity.verb` conventions (`vehicle.command.wake`, `api_key.create`,
 * `alert.rule.update`), so we walk from the most-specific prefix down to a
 * sensible fallback. If nothing matches we still render the entry — it just
 * shows the raw action name with a generic icon.
 */

// Native parity port of web/src/lib/activityIcons.ts.
//
// This is non-visual logic/data — a REGISTRY map keyed by audit-action prefix
// plus the pure getActivityVisual() resolver. The REGISTRY, the FALLBACK, and
// the resolver are ported verbatim: every color / i18nKey / fallback string and
// every lookup branch is preserved.
//
// Two browser-only boundaries are made native-safe:
//
//   - web L13-14 `import type { LucideIcon } from 'lucide-react'` +
//     `import { Icons } from '@/lib/icons'` are dropped. lucide-react is
//     browser-only and must never enter native output, and the registry's
//     `icon` field carried a live Lucide component. Following the established
//     native idiom (CommandSelectDialog.tsx / featureCatalog.ts /
//     registry/battery.ts: `icon: LucideIcon` -> a glyph-name string), the
//     field becomes `iconName: SemanticIconName` — a stable reference resolved
//     by the shared native <SemanticIcon>. Each web `Icons.<key>` maps 1:1 to
//     the identically-named SemanticIconName (the native semantic-icon registry
//     mirrors the web icon-registry keys), so which icon each action uses is
//     preserved exactly.
//
//   - `color` keeps the web Tailwind text-color class strings verbatim (the
//     same idiom as the converted featureCatalog.ts); a native consumer maps
//     them to a tint at the render boundary.
//
// No DOM, lucide-react, Recharts, Leaflet, or old web UI components are
// imported.

import type {SemanticIconName} from '../../components/icons/SemanticIcon';

export interface ActivityVisual {
  /** Native glyph reference rendered by <SemanticIcon> (web: icon: LucideIcon). */
  iconName: SemanticIconName;
  /** Tailwind text/border color class, e.g. `text-cyan-300`. */
  color: string;
  /** i18n key (no namespace) used to look up a translated label. */
  i18nKey: string;
  /** English fallback when the i18n key is missing. */
  fallback: string;
}

const REGISTRY: Record<string, ActivityVisual> = {
  // ── Vehicle commands ──────────────────────────────────────────────────────
  'vehicle.command': {
    iconName: 'gamepad',
    color: 'text-fuchsia-400',
    i18nKey: 'activity.action.vehicleCommand',
    fallback: 'Vehicle command',
  },
  'vehicle.command.wake': {
    iconName: 'power',
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandWake',
    fallback: 'Wake vehicle',
  },
  'vehicle.command.honk': {
    iconName: 'notificationsActive',
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandHonk',
    fallback: 'Honk horn',
  },
  'vehicle.command.flash': {
    iconName: 'power',
    color: 'text-yellow-300',
    i18nKey: 'activity.action.vehicleCommandFlash',
    fallback: 'Flash lights',
  },
  'vehicle.command.lock': {
    iconName: 'locked',
    color: 'text-emerald-300',
    i18nKey: 'activity.action.vehicleCommandLock',
    fallback: 'Lock vehicle',
  },
  'vehicle.command.unlock': {
    iconName: 'unlocked',
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandUnlock',
    fallback: 'Unlock vehicle',
  },
  'vehicle.command.climate': {
    iconName: 'climate',
    color: 'text-sky-300',
    i18nKey: 'activity.action.vehicleCommandClimate',
    fallback: 'Climate command',
  },
  'vehicle.command.charge': {
    iconName: 'bolt',
    color: 'text-emerald-300',
    i18nKey: 'activity.action.vehicleCommandCharge',
    fallback: 'Charging command',
  },

  // ── Settings / preferences ────────────────────────────────────────────────
  'settings.update': {
    iconName: 'settings',
    color: 'text-indigo-300',
    i18nKey: 'activity.action.settingsUpdate',
    fallback: 'Settings updated',
  },
  settings: {
    iconName: 'settings',
    color: 'text-indigo-300',
    i18nKey: 'activity.action.settings',
    fallback: 'Settings change',
  },

  // ── Alerts ────────────────────────────────────────────────────────────────
  'alert.rule.create': {
    iconName: 'notificationsAdd',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleCreate',
    fallback: 'Alert rule created',
  },
  'alert.rule.update': {
    iconName: 'notifications',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleUpdate',
    fallback: 'Alert rule updated',
  },
  'alert.rule.delete': {
    iconName: 'notificationsMuted',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleDelete',
    fallback: 'Alert rule deleted',
  },
  alert: {
    iconName: 'notifications',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alert',
    fallback: 'Alert change',
  },

  // ── Automations ───────────────────────────────────────────────────────────
  'automation.create': {
    iconName: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationCreate',
    fallback: 'Automation created',
  },
  'automation.update': {
    iconName: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationUpdate',
    fallback: 'Automation updated',
  },
  'automation.delete': {
    iconName: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationDelete',
    fallback: 'Automation deleted',
  },
  automation: {
    iconName: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automation',
    fallback: 'Automation change',
  },

  // ── Dashboard / layout ────────────────────────────────────────────────────
  'dashboard.layout.save': {
    iconName: 'layoutGrid',
    color: 'text-violet-300',
    i18nKey: 'activity.action.dashboardLayoutSave',
    fallback: 'Dashboard layout saved',
  },
  dashboard: {
    iconName: 'layoutDashboard',
    color: 'text-violet-300',
    i18nKey: 'activity.action.dashboard',
    fallback: 'Dashboard change',
  },

  // ── Data exports ──────────────────────────────────────────────────────────
  'data_export.create': {
    iconName: 'download',
    color: 'text-teal-300',
    i18nKey: 'activity.action.dataExportCreate',
    fallback: 'Data export requested',
  },
  data_export: {
    iconName: 'download',
    color: 'text-teal-300',
    i18nKey: 'activity.action.dataExport',
    fallback: 'Data export',
  },

  // ── API keys ──────────────────────────────────────────────────────────────
  'api_key.create': {
    iconName: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyCreate',
    fallback: 'API key created',
  },
  'api_key.update': {
    iconName: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyUpdate',
    fallback: 'API key updated',
  },
  'api_key.delete': {
    iconName: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyDelete',
    fallback: 'API key revoked',
  },
  api_key: {
    iconName: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKey',
    fallback: 'API key change',
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth.login': {
    iconName: 'user',
    color: 'text-emerald-300',
    i18nKey: 'activity.action.authLogin',
    fallback: 'Signed in',
  },
  'auth.logout': {
    iconName: 'user',
    color: 'text-[var(--text-muted)]',
    i18nKey: 'activity.action.authLogout',
    fallback: 'Signed out',
  },
  auth: {
    iconName: 'user',
    color: 'text-[var(--text-muted)]',
    i18nKey: 'activity.action.auth',
    fallback: 'Authentication',
  },
};

const FALLBACK: ActivityVisual = {
  iconName: 'history',
  color: 'text-[var(--text-muted)]',
  i18nKey: 'activity.action.unknown',
  fallback: 'Activity',
};

/**
 * Resolves an action string to its visual descriptor, falling back to
 * progressively shorter prefixes. `vehicle.command.wake` matches first;
 * if absent, `vehicle.command`, then `vehicle`, then the generic fallback.
 */
export function getActivityVisual(action: string): ActivityVisual {
  if (!action) {
    return FALLBACK;
  }
  const normalized = action.trim();
  if (REGISTRY[normalized]) {
    return REGISTRY[normalized];
  }

  const parts = normalized.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.');
    if (REGISTRY[prefix]) {
      return REGISTRY[prefix];
    }
  }
  return FALLBACK;
}

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

import type { LucideIcon } from 'lucide-react';
import { Icons } from '@/lib/icons';

export interface ActivityVisual {
  /** Icon to render in the timeline dot. */
  icon: LucideIcon;
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
    icon: Icons.gamepad,
    color: 'text-fuchsia-400',
    i18nKey: 'activity.action.vehicleCommand',
    fallback: 'Vehicle command',
  },
  'vehicle.command.wake': {
    icon: Icons.power,
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandWake',
    fallback: 'Wake vehicle',
  },
  'vehicle.command.honk': {
    icon: Icons.notificationsActive,
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandHonk',
    fallback: 'Honk horn',
  },
  'vehicle.command.flash': {
    icon: Icons.power,
    color: 'text-yellow-300',
    i18nKey: 'activity.action.vehicleCommandFlash',
    fallback: 'Flash lights',
  },
  'vehicle.command.lock': {
    icon: Icons.locked,
    color: 'text-emerald-300',
    i18nKey: 'activity.action.vehicleCommandLock',
    fallback: 'Lock vehicle',
  },
  'vehicle.command.unlock': {
    icon: Icons.unlocked,
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandUnlock',
    fallback: 'Unlock vehicle',
  },
  'vehicle.command.climate': {
    icon: Icons.climate,
    color: 'text-sky-300',
    i18nKey: 'activity.action.vehicleCommandClimate',
    fallback: 'Climate command',
  },
  'vehicle.command.charge': {
    icon: Icons.bolt,
    color: 'text-emerald-300',
    i18nKey: 'activity.action.vehicleCommandCharge',
    fallback: 'Charging command',
  },

  // ── Settings / preferences ────────────────────────────────────────────────
  'settings.update': {
    icon: Icons.settings,
    color: 'text-indigo-300',
    i18nKey: 'activity.action.settingsUpdate',
    fallback: 'Settings updated',
  },
  'settings': {
    icon: Icons.settings,
    color: 'text-indigo-300',
    i18nKey: 'activity.action.settings',
    fallback: 'Settings change',
  },

  // ── Alerts ────────────────────────────────────────────────────────────────
  'alert.rule.create': {
    icon: Icons.notificationsAdd,
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleCreate',
    fallback: 'Alert rule created',
  },
  'alert.rule.update': {
    icon: Icons.notifications,
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleUpdate',
    fallback: 'Alert rule updated',
  },
  'alert.rule.delete': {
    icon: Icons.notificationsMuted,
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleDelete',
    fallback: 'Alert rule deleted',
  },
  'alert': {
    icon: Icons.notifications,
    color: 'text-rose-300',
    i18nKey: 'activity.action.alert',
    fallback: 'Alert change',
  },

  // ── Automations ───────────────────────────────────────────────────────────
  'automation.create': {
    icon: Icons.workflow,
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationCreate',
    fallback: 'Automation created',
  },
  'automation.update': {
    icon: Icons.workflow,
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationUpdate',
    fallback: 'Automation updated',
  },
  'automation.delete': {
    icon: Icons.workflow,
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationDelete',
    fallback: 'Automation deleted',
  },
  'automation': {
    icon: Icons.workflow,
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automation',
    fallback: 'Automation change',
  },

  // ── Dashboard / layout ────────────────────────────────────────────────────
  'dashboard.layout.save': {
    icon: Icons.layoutGrid,
    color: 'text-violet-300',
    i18nKey: 'activity.action.dashboardLayoutSave',
    fallback: 'Dashboard layout saved',
  },
  'dashboard': {
    icon: Icons.layoutDashboard,
    color: 'text-violet-300',
    i18nKey: 'activity.action.dashboard',
    fallback: 'Dashboard change',
  },

  // ── Data exports ──────────────────────────────────────────────────────────
  'data_export.create': {
    icon: Icons.download,
    color: 'text-teal-300',
    i18nKey: 'activity.action.dataExportCreate',
    fallback: 'Data export requested',
  },
  'data_export': {
    icon: Icons.download,
    color: 'text-teal-300',
    i18nKey: 'activity.action.dataExport',
    fallback: 'Data export',
  },

  // ── API keys ──────────────────────────────────────────────────────────────
  'api_key.create': {
    icon: Icons.key,
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyCreate',
    fallback: 'API key created',
  },
  'api_key.update': {
    icon: Icons.key,
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyUpdate',
    fallback: 'API key updated',
  },
  'api_key.delete': {
    icon: Icons.key,
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyDelete',
    fallback: 'API key revoked',
  },
  'api_key': {
    icon: Icons.key,
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKey',
    fallback: 'API key change',
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth.login': {
    icon: Icons.user,
    color: 'text-emerald-300',
    i18nKey: 'activity.action.authLogin',
    fallback: 'Signed in',
  },
  'auth.logout': {
    icon: Icons.user,
    color: 'text-[var(--text-muted)]',
    i18nKey: 'activity.action.authLogout',
    fallback: 'Signed out',
  },
  'auth': {
    icon: Icons.user,
    color: 'text-[var(--text-muted)]',
    i18nKey: 'activity.action.auth',
    fallback: 'Authentication',
  },
};

const FALLBACK: ActivityVisual = {
  icon: Icons.history,
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
  if (!action) return FALLBACK;
  const normalized = action.trim();
  if (REGISTRY[normalized]) return REGISTRY[normalized];

  const parts = normalized.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.');
    if (REGISTRY[prefix]) return REGISTRY[prefix];
  }
  return FALLBACK;
}

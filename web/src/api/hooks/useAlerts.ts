/**
 * Phase-45 / Prompt 15 — Domain re-export shim.
 *
 * Alert-related hooks live in `useNotifications.ts` (alerts and
 * notification channels share the same backend `notifications` package
 * and TanStack Query namespace). This file re-exports the alert-specific
 * hooks under a domain-named module so call sites that only care about
 * alerts can import from `@/api/hooks/useAlerts` without pulling in the
 * notification-channel types and helpers.
 *
 * No new logic lives here — every export is a straight passthrough.
 */
export {
  notificationKeys as alertKeys,
  useAlerts,
  useMarkAlertRead,
  useAlertRules,
  useAlertMetrics,
  usePreviewComputedMetric,
  useSaveAlertRule,
  useDeleteAlertRule,
  useToggleAlertRule,
  useBulkEnableRules,
  useBulkDisableRules,
  useTestAlertRule,
  useSnoozeAlertRule,
} from './useNotifications';

export type {
  Alert,
  AlertRule,
  AlertRuleInput,
  AlertRuleSaveRequest,
  AlertRuleSnoozeRequest,
  AlertRuleTriggerMode,
  AlertRuleUpdate,
  AlertTestRequest,
  AlertTestTarget,
  ComputedMetricPreview,
  ComputedMetricSummary,
} from './useNotifications';

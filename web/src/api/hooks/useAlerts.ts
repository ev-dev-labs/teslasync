/**
 * Domain re-export shim for alert-related hooks.
 *
 * Alert hooks live in `useNotifications.ts` because alerts and notification
 * channels share the backend package and TanStack Query namespace. This module
 * gives alert-only call sites a focused import path without pulling in
 * channel types and helpers.
 *
 * No logic lives here; every export is a passthrough.
 */
export {
  notificationKeys as alertKeys,
  useAlerts,
  usePriorityAlerts,
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
  // Alert acknowledgment and audit timeline.
  useAlertDetail,
  useAcknowledgeAlert,
  useCommentAlert,
  useReopenAlert,
} from './useNotifications';

export type {
  Alert,
  AlertDetail,
  AlertEvent,
  AlertRule,
  AlertRuleInput,
  AlertRuleSaveRequest,
  AlertRuleSnoozeRequest,
  AlertRuleTriggerMode,
  AlertRuleUpdate,
  PriorityAlertsSnapshot,
  AlertTestRequest,
  AlertTestTarget,
  ComputedMetricPreview,
  ComputedMetricSummary,
  // Alert acknowledgment and audit timeline.
  AcknowledgeAlertInput,
  CommentAlertInput,
} from './useNotifications';

// Message-template editor hooks.
export {
  alertMessageKeys,
  useAlertMessagePresets,
  useAlertMessagePlaceholders,
  useAlertMessagePreview,
} from './useAlertMessageHelpers';

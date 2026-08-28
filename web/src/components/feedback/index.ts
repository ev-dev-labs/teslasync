export { Spinner } from './Spinner';
export { EmptyState } from './EmptyState';
export {
  ActionableEmptyState,
  type ActionableEmptyStateProps,
} from './ActionableEmptyState';
export { ErrorDisplay } from './ErrorDisplay';
export { ErrorBoundary } from './ErrorBoundary';
export { SectionErrorBoundary } from './SectionErrorBoundary';
export { PageErrorBoundary } from './PageErrorBoundary';
export { Skeleton } from './Skeleton';
export { ChartSkeleton } from './ChartSkeleton';
export { StatSkeleton } from './StatSkeleton';
export { ListSkeleton, type ListSkeletonProps } from './ListSkeleton';
export {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ChartBlockSkeleton,
  TableSkeleton,
} from './PageSkeleton';
export { PageLoader, type PageLoaderProps } from './PageLoader';
export { PageLoadSkeleton } from './PageLoadSkeleton';
export { QueryError } from './QueryError';
export { AlertBanner, type AlertBannerProps, type AlertVariant } from './AlertBanner';
export { InlineCallout, type InlineCalloutProps, type CalloutVariant } from './InlineCallout';
export { DraftRecoveryBanner, type DraftRecoveryBannerProps } from './DraftRecoveryBanner';
export { DraftRestorePrompt } from './DraftRestorePrompt';
export { OfflineBanner } from './OfflineBanner';
export {
  OperationalWriteNotice,
  type OperationalWriteNoticeProps,
} from './OperationalWriteNotice';
export { LiveStaleDataBanner } from './LiveStaleDataBanner';
export { DataStateNotice, type DataStateKind, type DataStateNoticeProps } from './DataStateNotice';
export {
  DataUnavailableNotice,
  type DataUnavailableNoticeProps,
} from './DataUnavailableNotice';
export { ErrorHelpLinks, type ErrorHelpLinksProps } from './ErrorHelpLinks';
export {
  PermissionGuidanceNotice,
  type PermissionGuidanceNoticeProps,
} from './PermissionGuidanceNotice';
export { DemoModeBanner, type DemoModeBannerProps } from './DemoModeBanner';
export { ProblemReportModal, type ProblemReportModalProps } from './ProblemReportModal';
export {
  StaleRefreshWarning,
  type StaleRefreshWarningProps,
} from './StaleRefreshWarning';
export {
  DataSourceNotice,
  resolveDataSourceStatus,
  type DataSourceDescriptor,
  type DataSourceNoticeProps,
  type DataSourceQuery,
  type DataSourceStatus,
} from './DataSourceNotice';
export { RuntimeHealthBanner } from './RuntimeHealthBanner';
export { TeslaReauthBanner } from './TeslaReauthBanner';
export { RateLimitBanner } from './RateLimitBanner';
export { MaintenanceBanner } from './MaintenanceBanner';
export { ImpersonationBanner } from './ImpersonationBanner';
export { RequiresAuth, requiresAuthEmptyTestId, type RequiresAuthProps, type RequiresAuthCapability } from './RequiresAuth';
export { GotoIndicator } from './GotoIndicator';
export { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
export { TourOverlay } from './TourOverlay';
export { JobProgressDrawer } from './JobProgressDrawer';
export { AchievementUnlockedToast, AchievementUnlockedToastStack, type AchievementUnlockedToastProps } from './AchievementUnlockedToast';
export { AchievementUnlockListener } from './AchievementUnlockListener';
export { ToastProvider, useToast, useOptionalToast, type ToastAction } from './Toast';
export { ChangelogModal } from './ChangelogModal';
export { TopProgress } from './TopProgress';
export { SuspenseProgressBoundary } from './SuspenseProgressBoundary';
export { SkipToContent } from './SkipToContent';
export { BrowserCompatBanner } from './BrowserCompatBanner';
export { TimeMachineBanner, TIME_MACHINE_OPEN_PICKER_EVENT } from './TimeMachineBanner';
export { EditConflictBanner, type EditConflictBannerProps } from './EditConflictBanner';
export { CookieConsentBanner } from './CookieConsentBanner';
export { GuardedLink, GuardedNavLink } from './GuardedLink';
export { NavigationGuardProvider } from './NavigationGuardProvider';

// ── PWA / device surfaces ───────────────────────────────────────────────────
// `InstallPrompt` and `ReloadPrompt` stay default-exported and are imported by
// path from `main.tsx`; the three below are ordinary components any page may
// mount, so they belong on the category barrel.
export { UpdatePrompt, type UpdatePromptProps } from './UpdatePrompt';
export { CachedDataNotice, type CachedDataNoticeProps } from './CachedDataNotice';
export {
  LowBandwidthControl,
  type LowBandwidthControlProps,
} from './LowBandwidthControl';

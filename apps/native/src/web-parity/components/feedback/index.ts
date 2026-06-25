// Native parity port of web/src/components/feedback/index.ts.
//
// The web feedback barrel re-exports 40+ DOM-bound primitives (spinners,
// skeletons, error boundaries, toast/banner widgets, modals, route overlays).
// In the file-by-file web-to-native conversion only the modules already ported
// into this parity tree may be re-exported here; pointing at a not-yet-ported
// sibling would break the native typecheck. EmptyState (web L2) and AlertBanner
// (web L19) are the two feedback primitives currently present under
// apps/native/src/web-parity/components/feedback, so they are the only live
// re-exports, mirroring the web barrel's component-only surface for those two
// lines. Every remaining web export is enumerated in
// `nativeFeedbackBarrelCapabilities.pending` with an explicit unavailable
// reason so the gap stays discoverable and the source public API remains
// documented, matching the capability-record convention used by the native
// charts barrel. EmptyState (web L2), Skeleton (web L7), and AlertBanner
// (web L19) are the feedback primitives currently ported into this parity tree,
// so they are the live re-exports.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

export { EmptyState } from './EmptyState';
export { Skeleton } from './Skeleton';
export { AlertBanner } from './AlertBanner';

export const NATIVE_FEEDBACK_PENDING_REASON =
  'This web feedback export has not yet been ported into the React Native ' +
  'parity tree. It will be re-exported from this barrel once its source ' +
  'module is converted by the file-by-file web-to-native loop; until then ' +
  'importing it from the native feedback barrel is intentionally unavailable.';

/**
 * Explicit availability record for the native feedback barrel.
 *
 * `available` lists the web feedback exports already ported into this parity
 * tree (and therefore re-exported above). `pending.exports` enumerates every
 * other identifier exported by web/src/components/feedback/index.ts — including
 * value, const, and type exports — that has not yet been converted. Each is
 * intentionally absent from the live re-exports until its own source module is
 * ported, so this record documents the unavailable state instead of silently
 * dropping the symbol.
 */
export const nativeFeedbackBarrelCapabilities = {
  available: ['EmptyState', 'Skeleton', 'AlertBanner'],
  pending: {
    reason: NATIVE_FEEDBACK_PENDING_REASON,
    exports: [
      'Spinner',
      'ErrorDisplay',
      'ErrorBoundary',
      'SectionErrorBoundary',
      'PageErrorBoundary',
      'ChartSkeleton',
      'StatSkeleton',
      'PageHeaderSkeleton',
      'StatGridSkeleton',
      'ChartBlockSkeleton',
      'TableSkeleton',
      'PageLoader',
      'PageLoadSkeleton',
      'QueryError',
      'InlineCallout',
      'InlineCalloutProps',
      'CalloutVariant',
      'DraftRecoveryBanner',
      'DraftRecoveryBannerProps',
      'DraftRestorePrompt',
      'OfflineBanner',
      'LiveStaleDataBanner',
      'TeslaReauthBanner',
      'RateLimitBanner',
      'MaintenanceBanner',
      'ImpersonationBanner',
      'RequiresAuth',
      'requiresAuthEmptyTestId',
      'RequiresAuthProps',
      'RequiresAuthCapability',
      'GotoIndicator',
      'KeyboardShortcutsModal',
      'TourOverlay',
      'JobProgressDrawer',
      'AchievementUnlockedToast',
      'AchievementUnlockedToastStack',
      'AchievementUnlockedToastProps',
      'AchievementUnlockListener',
      'ChangelogModal',
      'TopProgress',
      'SuspenseProgressBoundary',
      'SkipToContent',
      'BrowserCompatBanner',
      'TimeMachineBanner',
      'TIME_MACHINE_OPEN_PICKER_EVENT',
      'EditConflictBanner',
      'EditConflictBannerProps',
      'CookieConsentBanner',
    ],
  },
} as const;

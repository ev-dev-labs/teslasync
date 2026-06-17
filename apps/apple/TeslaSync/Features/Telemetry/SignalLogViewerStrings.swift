import SwiftUI

// MARK: - Parity string keys (web `t(key, default)` — Localizable.xcstrings)

/// Every visible literal the Signal Log Viewer page resolves, centralized so the views and the
/// parity evidence agree on the web key names (verbatim). The web page
/// (`web/src/features/telemetry/pages/SignalLogViewerPage.tsx`) uses i18next with the English copy
/// itself as the key for the bare strings (`t('Per Page')`, `t('Query')`, …) and dotted keys with a
/// default for the rest (`t('signalLog.noVehicle', 'Select a vehicle to begin')`); both forms are
/// reproduced verbatim here and shipped in `Localizable.xcstrings`.
///
/// The keys are computed (not stored) properties because `LocalizedStringKey` is not `Sendable`;
/// under the app's Swift 6 `complete` strict-concurrency mode a stored `static let` of it would be a
/// non-concurrency-safe global. Computed accessors hold no shared state, so they are safe.
public enum SignalLogViewerStrings {
    /// Web `usePageTitle(t('Signal Log'))` — the route / window title (≈ `document.title`).
    public static var navTitle: LocalizedStringKey {
        "Signal Log"
    }

    /// Web `PageContainer title={t('Signal Log Viewer')}` — the on-screen page heading.
    public static var title: LocalizedStringKey {
        "Signal Log Viewer"
    }

    /// Web `PageContainer subtitle={t('Query signal history from Postgres')}`.
    public static var subtitle: LocalizedStringKey {
        "Query signal history from Postgres"
    }

    /// Web range label `t('Time Range')`.
    public static var timeRange: LocalizedStringKey {
        "Time Range"
    }

    /// Web rows-per-page select label `t('Per Page')`.
    public static var perPage: LocalizedStringKey {
        "Per Page"
    }

    /// Web primary submit button `t('Query')`.
    public static var query: LocalizedStringKey {
        "Query"
    }

    /// Web records-count word `t('records')` (rendered as `{total} records`).
    public static var records: LocalizedStringKey {
        "records"
    }

    /// Web pre-query empty-state title `t('Select signals and click Query')`.
    public static var selectAndQuery: LocalizedStringKey {
        "Select signals and click Query"
    }

    /// Web pre-query empty-state message.
    public static var selectAndQueryMessage: LocalizedStringKey {
        "Choose one or more signals, set a date range, then hit Query to browse signal history."
    }

    /// Web error banner prefix `t('error.loadFailed', 'Failed to load data')`.
    public static var loadFailed: LocalizedStringKey {
        "error.loadFailed"
    }

    /// Web no-vehicle empty-state title `t('signalLog.noVehicle', 'Select a vehicle to begin')`.
    public static var noVehicle: LocalizedStringKey {
        "signalLog.noVehicle"
    }

    /// Web no-vehicle empty-state message `t('signalLog.noVehicleDesc', …)`.
    public static var noVehicleDesc: LocalizedStringKey {
        "signalLog.noVehicleDesc"
    }

    /// The 12 web key names this page renders, for the parity evidence cross-check.
    public static let rawKeys: [String] = [
        "Choose one or more signals, set a date range, then hit Query to browse signal history.",
        "Per Page",
        "Query",
        "Query signal history from Postgres",
        "Select signals and click Query",
        "Signal Log",
        "Signal Log Viewer",
        "Time Range",
        "error.loadFailed",
        "records",
        "signalLog.noVehicle",
        "signalLog.noVehicleDesc"
    ]
}

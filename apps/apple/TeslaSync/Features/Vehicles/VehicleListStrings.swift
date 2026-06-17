import SwiftUI

// MARK: - Parity string keys (web `t(key, default)` — Localizable.xcstrings)

/// Every visible literal the Fleet (vehicle list) page resolves, centralized so the views and the
/// parity tests agree on the web key names (verbatim). Defaults ship in `Localizable.xcstrings`. The
/// keys are computed (not stored) properties because `LocalizedStringKey` is not `Sendable` — under
/// the app's Swift 6 `complete` strict-concurrency mode a stored `static let` of it would be a
/// non-concurrency-safe global; computed accessors hold no shared state, so they are safe. The shared
/// `MetricCard` takes a resolved `String` label, so the four summary-card labels resolve eagerly via
/// `String(localized:)`; the interpolated remove-confirmation copy is a pure `static func` formatter.
public enum VehicleListStrings {
    // MARK: Page chrome (web `PageContainer title` / `subtitle`)

    /// Web `t('nav.vehicles', 'Fleet')` — the navigation title.
    public static var title: LocalizedStringKey { "nav.vehicles" }

    /// Web `t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')`.
    public static var subtitle: LocalizedStringKey { "vehicles.subtitle" }

    // MARK: Summary stat cards (web `MetricCard label` — resolved Strings)

    /// Web `t('vehicles.totalVehicles', 'Total Vehicles')`.
    public static var totalVehicles: String { String(localized: "vehicles.totalVehicles") }

    /// Web `t('vehicles.avgBattery', 'Avg Battery')`.
    public static var avgBattery: String { String(localized: "vehicles.avgBattery") }

    /// Web bare `t('vehicles.totalRange', 'Total Range')`.
    public static var totalRange: String { String(localized: "vehicles.totalRange") }

    /// Web Total-Range card label `${t('vehicles.totalRange')} (${unit})` — unit-suffixed.
    public static func totalRangeLabel(unit: String) -> String { "\(totalRange) (\(unit))" }

    /// Web `t('vehicles.chargingOnline', 'Charging / Online')`.
    public static var chargingOnline: String { String(localized: "vehicles.chargingOnline") }

    // MARK: Fleet battery panel (web GlassPanel "Fleet Battery Status")

    /// Web `t('vehicles.batteryStatus', 'Fleet Battery Status')` — the panel title.
    public static var batteryStatus: LocalizedStringKey { "vehicles.batteryStatus" }

    /// Web `t('vehicles.avgLabel', 'avg')` — the trailing word after the `{n}%` average.
    public static var avgLabel: LocalizedStringKey { "vehicles.avgLabel" }

    /// Web `t('common.noData', 'No data available')` — the panel's empty state.
    public static var commonNoData: LocalizedStringKey { "common.noData" }

    // MARK: Vehicle cards (web GlassPanel "All Vehicles")

    /// Web `t('vehicles.allVehicles', 'All Vehicles')` — the section heading.
    public static var allVehicles: LocalizedStringKey { "vehicles.allVehicles" }

    // MARK: Empty state (web `vehicleList.length === 0`)

    /// Web `t('vehicles.emptyTitle', 'No vehicles yet')`.
    public static var emptyTitle: LocalizedStringKey { "vehicles.emptyTitle" }

    /// Web `t('vehicles.emptyMessage', 'Connect your Tesla account …')`.
    public static var emptyMessage: LocalizedStringKey { "vehicles.emptyMessage" }

    // MARK: Error state (web `error` → load-error panel)

    /// Web `t('vehicles.loadError', 'Failed to load vehicles.')`.
    public static var loadError: LocalizedStringKey { "vehicles.loadError" }

    // MARK: Header actions (web `Button`s)

    /// Web `t('vehicles.compareButton', 'Compare vehicles')` — shown when ≥ 2 vehicles.
    public static var compareButton: LocalizedStringKey { "vehicles.compareButton" }

    /// Web `t('vehicles.syncButton', 'Sync from Tesla')` — the sync button + empty-state action.
    public static var syncButton: LocalizedStringKey { "vehicles.syncButton" }

    // MARK: Sync feedback (web banners + toasts)

    /// Web `t('vehicles.syncSuccess', 'Vehicles synced successfully.')` — the success banner.
    public static var syncSuccess: LocalizedStringKey { "vehicles.syncSuccess" }

    /// Web `t('vehicles.syncError', 'Sync failed. Please try again.')` — the error banner.
    public static var syncError: LocalizedStringKey { "vehicles.syncError" }

    /// Web `t('vehicles.syncToast', 'Vehicles synced successfully')` — the success toast.
    public static var syncToast: LocalizedStringKey { "vehicles.syncToast" }

    /// Web `t('vehicles.syncFailed', 'Failed to sync vehicles')` — the failure toast.
    public static var syncFailed: LocalizedStringKey { "vehicles.syncFailed" }

    // MARK: Delete feedback + confirmation (web `ConfirmDialog` + toasts)

    /// Web `t('vehicles.deleteSuccess', 'Vehicle removed')` — the delete success toast.
    public static var deleteSuccess: LocalizedStringKey { "vehicles.deleteSuccess" }

    /// Web `t('vehicles.deleteFailed', 'Failed to remove vehicle')` — the delete failure toast.
    public static var deleteFailed: LocalizedStringKey { "vehicles.deleteFailed" }

    /// Web `t('vehicles.removeTitle', 'Remove Vehicle')` — the confirm-dialog title.
    public static var removeTitle: LocalizedStringKey { "vehicles.removeTitle" }

    /// Web `t('common.delete', 'Remove')` — the confirm-dialog destructive action.
    public static var commonDelete: LocalizedStringKey { "common.delete" }

    /// Web `t('vehicles.removeMessage', { name, defaultValue })` — the confirm-dialog body with the
    /// vehicle name interpolated (`%@`). Resolved eagerly so the dialog binds a `String`.
    public static func removeMessage(name: String) -> String {
        String(format: String(localized: "vehicles.removeMessage"), name)
    }

    // MARK: Parity coverage

    /// The 24 web key names, for the parity coverage test.
    public static let rawKeys: [String] = [
        "common.delete",
        "common.noData",
        "nav.vehicles",
        "vehicles.allVehicles",
        "vehicles.avgBattery",
        "vehicles.avgLabel",
        "vehicles.batteryStatus",
        "vehicles.chargingOnline",
        "vehicles.compareButton",
        "vehicles.deleteFailed",
        "vehicles.deleteSuccess",
        "vehicles.emptyMessage",
        "vehicles.emptyTitle",
        "vehicles.loadError",
        "vehicles.removeMessage",
        "vehicles.removeTitle",
        "vehicles.subtitle",
        "vehicles.syncButton",
        "vehicles.syncError",
        "vehicles.syncFailed",
        "vehicles.syncSuccess",
        "vehicles.syncToast",
        "vehicles.totalRange",
        "vehicles.totalVehicles"
    ]
}

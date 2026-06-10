//
//  DashboardSettingsModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The dependency seams the DashboardSettingsModal view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the action seam (web `onRename` +
//  `onChangeIcon` + `onUpdate` collapsed into one commit, plus `onClose`), the coalesced source
//  snapshot (the edited dashboard + the fleet vehicle list + freshness), the P1/S8 source protocol,
//  the in-memory source for previews/tests, the P1/S10 i18n facade (web routes copy through
//  `t('dashSettings…')`; native routes every string through a key), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol DashboardSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogDashboardSettingsTelemetry: DashboardSettingsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `onRename` / `onChangeIcon` / `onUpdate` + `onClose`)

/// The two commands the modal drives — committing the chosen settings (web `handleSave`: the rename /
/// icon / update deltas) and cancelling (web `onClose()`). The default logs the intent without
/// networking so previews render safely; the production app injects an adapter over the real
/// dashboard-store mutations + the sheet dismissal.
public protocol DashboardSettingsActions: Sendable {
    func commit(_ change: DashboardSettingsCommit)
    func cancel()
}

/// `os.Logger`-backed default that records the intents without networking or dismissal.
public struct OSLogDashboardSettingsActions: DashboardSettingsActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "telemetry")
    }

    public func commit(_ change: DashboardSettingsCommit) {
        logger.info(
            """
            dashboard.settings.commit surface=\(DashboardSettingsSurface.slug, privacy: .public) \
            renamed=\(change.renamedName != nil, privacy: .public) \
            icon=\(change.changedIcon != nil, privacy: .public)
            """
        )
    }

    public func cancel() {
        logger.info("dashboard.settings.cancel surface=\(DashboardSettingsSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `DashboardSettingsSource`: the load status, the dashboard being
/// edited (web `dashboard` prop; `nil` once resolved means it was not found), the fleet vehicle list
/// (web `vehicles` prop), the live-state freshness, the in-flight refresh flag, and the last-updated
/// timestamp.
public struct DashboardSettingsUpdate: Sendable, Equatable {
    public var status: DashboardSettingsLoadStatus
    public var dashboard: DashboardDescriptor?
    public var vehicles: [DashboardVehicleOption]
    public var connection: DashboardSettingsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: DashboardSettingsLoadStatus = .loading,
        dashboard: DashboardDescriptor? = nil,
        vehicles: [DashboardVehicleOption] = [],
        connection: DashboardSettingsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.dashboard = dashboard
        self.vehicles = vehicles
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }

    /// A stable identity for the edited dashboard — the model rebuilds the editable draft only when
    /// this changes, so a pure freshness flip (live → stale) preserves the operator's edits.
    public var dashboardIdentity: String? {
        dashboard?.id
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// the selected dashboard plus the fleet vehicle-list query — and reports live-state freshness.
/// Previews/tests use `InMemoryDashboardSettingsSource`. The view never talks to the network.
@MainActor
public protocol DashboardSettingsSource: AnyObject {
    var onUpdate: (@MainActor (DashboardSettingsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the vehicle-list query (the error-state retry / the stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryDashboardSettingsSource: DashboardSettingsSource {
    public var onUpdate: (@MainActor (DashboardSettingsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DashboardSettingsUpdate?

    public init(initial: DashboardSettingsUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: DashboardSettingsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t('dashSettings…')` → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "DashboardSettingsModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum DashboardSettingsStrings {
    public static let table = "DashboardSettingsModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{icon}}` etc.): resolves then substitutes one token.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum DashboardSettingsAccessibility {
    /// The dialog's container label (web Modal `title`).
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("dashSettings.title", "Dashboard Settings")
    }

    /// One icon swatch's VoiceOver label: the emoji, plus a "selected" suffix when it is the chosen
    /// icon (web `aria-label={emoji}` widened with selection state).
    public static func iconLabel(
        icon: String,
        selected: Bool,
        localize: (String, String) -> String
    ) -> String {
        guard selected else { return icon }
        let state = localize("dashSettings.iconSelected", "Selected")
        return "\(icon), \(state)"
    }

    /// The vehicle-scope picker's current-value summary (the chosen vehicle name, or "All Vehicles").
    public static func scopeValueLabel(
        vehicleName: String?,
        localize: (String, String) -> String
    ) -> String {
        vehicleName ?? localize("dashSettings.allVehicles", "All Vehicles")
    }
}

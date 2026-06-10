//
//  WidgetSettingsModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  The dependency seams the WidgetSettingsModal view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the action seam (web `onSave` collapsed into
//  one commit, plus `onClose`), the coalesced source snapshot (the edited widget + the fleet vehicle
//  list + freshness), the P1/S8 source protocol, the in-memory source for previews/tests, the P1/S10
//  i18n facade (web routes copy through `t('dashboard.settings…')` / `t('common…')`; native routes
//  every string through a key), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there).
public protocol WidgetSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a static,
/// non-identifying constant.
public struct OSLogWidgetSettingsTelemetry: WidgetSettingsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `onSave` + `onClose`)

/// The two commands the modal drives — committing the chosen config (web `handleSave`: `onSave(config)`)
/// and cancelling (web `onClose()`). The default logs the intent without networking so previews render
/// safely; the production app injects an adapter over the real widget-config mutation (merging the
/// edited subset onto the persisted config so extra keys survive) + the sheet dismissal.
public protocol WidgetSettingsActions: Sendable {
    func commit(_ change: WidgetSettingsCommit)
    func cancel()
}

/// `os.Logger`-backed default that records the intents without networking or dismissal.
public struct OSLogWidgetSettingsActions: WidgetSettingsActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "telemetry")
    }

    public func commit(_ change: WidgetSettingsCommit) {
        logger.info(
            """
            widget.settings.commit surface=\(WidgetSettingsSurface.slug, privacy: .public) \
            scoped=\(change.config.vehicleID != nil, privacy: .public) \
            refresh=\(change.config.refreshRate != nil, privacy: .public)
            """
        )
    }

    public func cancel() {
        logger.info("widget.settings.cancel surface=\(WidgetSettingsSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `WidgetSettingsSource`: the load status, the widget being edited
/// (web `widget` + `def`; `nil` once resolved means it was removed), the fleet vehicle list (web
/// `useVehicles`), the live-state freshness, the in-flight refresh flag, and the last-updated
/// timestamp.
public struct WidgetSettingsUpdate: Sendable, Equatable {
    public var status: WidgetSettingsLoadStatus
    public var widget: WidgetDescriptor?
    public var vehicles: [WidgetVehicleOption]
    public var connection: WidgetSettingsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: WidgetSettingsLoadStatus = .loading,
        widget: WidgetDescriptor? = nil,
        vehicles: [WidgetVehicleOption] = [],
        connection: WidgetSettingsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.widget = widget
        self.vehicles = vehicles
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }

    /// A stable identity for the edited widget — the model rebuilds the editable draft only when this
    /// changes, so a pure freshness flip (live → stale) preserves the operator's edits.
    public var widgetIdentity: String? {
        widget?.id
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// the selected widget instance plus the fleet vehicle-list query (web `useVehicles`) — and reports
/// live-state freshness. Previews/tests use `InMemoryWidgetSettingsSource`. The view never talks to
/// the network.
@MainActor
public protocol WidgetSettingsSource: AnyObject {
    var onUpdate: (@MainActor (WidgetSettingsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the vehicle-list query (the error-state retry / the stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryWidgetSettingsSource: WidgetSettingsSource {
    public var onUpdate: (@MainActor (WidgetSettingsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WidgetSettingsUpdate?

    public init(initial: WidgetSettingsUpdate? = nil) {
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
    public func push(_ update: WidgetSettingsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t('dashboard.settings…')` → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "WidgetSettingsModal" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum WidgetSettingsStrings {
    public static let table = "WidgetSettingsModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{name}}` / `{{id}}` etc.): resolves then substitutes one
    /// token.
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
public enum WidgetSettingsAccessibility {
    /// The dialog's container label (web Modal `title` = `\`${def.name} Settings\``).
    public static func dialogLabel(
        widgetName: String,
        localize: (String, String, String, String) -> String
    ) -> String {
        localize("widgetSettings.title", "{{name}} Settings", "{{name}}", widgetName)
    }

    /// The vehicle-scope picker's current-value summary (the chosen vehicle name, or "All Vehicles").
    public static func scopeValueLabel(
        vehicleName: String?,
        localize: (String, String) -> String
    ) -> String {
        vehicleName ?? localize("dashboard.settings.allVehicles", "All Vehicles (first)")
    }
}

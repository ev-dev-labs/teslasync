//
//  KioskSettingsModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The dependency seams the KioskSettingsModal view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the action seam (web `onUpdateConfig`
//  persistence + `onEnterKiosk` + `onClose`), the coalesced source snapshot (the saved-dashboard
//  list + the persisted config + freshness), the P1/S8 source protocol, the in-memory source for
//  previews / tests, the P1/S10 i18n facade (web hardcodes English; native routes every string
//  through a key), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol KioskSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogKioskSettingsTelemetry: KioskSettingsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `onUpdateConfig` + `onEnterKiosk` + `onClose`)

/// The three commands the modal drives — persisting an edited config (web `onUpdateConfig`, saved to
/// localStorage on every change), entering kiosk mode with the committed config (web `onEnterKiosk`),
/// and cancelling (web `onClose`). The default logs the intents without persistence so previews
/// render safely; the production app injects an adapter over the real kiosk-config store + the sheet
/// dismissal.
public protocol KioskSettingsActions: Sendable {
    func persist(_ config: KioskConfig)
    func enterKiosk(_ config: KioskConfig)
    func cancel()
}

/// `os.Logger`-backed default that records the intents without persistence or dismissal. Logs only
/// non-identifying scalars (the rotation cadence + the rotation count), never dashboard names.
public struct OSLogKioskSettingsActions: KioskSettingsActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "telemetry")
    }

    public func persist(_ config: KioskConfig) {
        let slug = KioskSettingsSurface.slug
        logger.info("kiosk.persist surface=\(slug, privacy: .public) count=\(config.dashboardIds.count)")
    }

    public func enterKiosk(_ config: KioskConfig) {
        let slug = KioskSettingsSurface.slug
        logger.info("kiosk.enter surface=\(slug, privacy: .public) count=\(config.dashboardIds.count)")
    }

    public func cancel() {
        logger.info("kiosk.cancel surface=\(KioskSettingsSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `KioskSettingsSource`: the load status, the saved-dashboard
/// list to rotate (web `dashboards`), the persisted kiosk config (web `config`), the live-state
/// freshness, the in-flight refresh flag, and the last-updated timestamp.
public struct KioskSettingsUpdate: Sendable, Equatable {
    public var status: KioskLoadStatus
    public var dashboards: [KioskDashboard]
    public var config: KioskConfig
    public var connection: KioskConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: KioskLoadStatus = .loading,
        dashboards: [KioskDashboard] = [],
        config: KioskConfig = .default,
        connection: KioskConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.dashboards = dashboards
        self.config = config
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }

    /// A stable identity for the saved-dashboard set — the model re-sanitizes the rotation selection
    /// only when this changes, so a pure freshness flip (live → stale) preserves the operator's edits.
    public var dashboardSignature: [String] {
        dashboards.map(\.id)
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// the saved-dashboard query plus the persisted kiosk-config store — and reports live-state
/// freshness. Previews / tests use `InMemoryKioskSettingsSource`. The view never talks to the network.
@MainActor
public protocol KioskSettingsSource: AnyObject {
    var onUpdate: (@MainActor (KioskSettingsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the dashboards / config query (the error-state retry / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryKioskSettingsSource: KioskSettingsSource {
    public var onUpdate: (@MainActor (KioskSettingsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: KioskSettingsUpdate?

    public init(initial: KioskSettingsUpdate? = nil) {
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
    public func push(_ update: KioskSettingsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web hardcoded copy → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "KioskSettingsModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum KioskSettingsStrings {
    public static let table = "KioskSettingsModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{name}}` etc.): resolves then substitutes one token.
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
public enum KioskSettingsAccessibility {
    /// The dialog's container label (web Modal `title`).
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("kiosk.settings", "Kiosk Settings")
    }

    /// One rotation-dashboard row's VoiceOver label: the name, its selection state, and the optional
    /// "Default" marker.
    public static func dashboardRowLabel(
        name: String,
        selected: Bool,
        isDefault: Bool,
        localize: (String, String) -> String
    ) -> String {
        let state = selected
            ? localize("kiosk.selected", "Selected")
            : localize("kiosk.notSelected", "Not selected")
        var parts = [name, state]
        if isDefault {
            parts.append(localize("kiosk.default", "Default"))
        }
        return parts.joined(separator: ", ")
    }

    /// The "Enter Kiosk Mode" action's VoiceOver label (web primary button).
    public static func enterLabel(localize: (String, String) -> String) -> String {
        localize("kiosk.enter", "Enter Kiosk Mode")
    }
}

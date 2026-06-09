//
//  PresetGallery.Seams.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  The dependency seams the AutomationPresetGallery view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n
//  facade (web `useTranslation`), the install-navigation seam (web `useNavigate` →
//  `/automations/new?preset={id}`), the coalesced source snapshot, the P1/S8 source
//  protocol, and the in-memory source for previews/tests. No networking lives in the
//  view.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted
/// there.
public protocol AutomationPresetGalleryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAutomationPresetGalleryTelemetry: AutomationPresetGalleryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "PresetGallery" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings.
public enum AutomationPresetGalleryStrings {
    public static let table = "PresetGallery"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Install navigation seam (web `useNavigate`)

/// The single navigation the gallery drives: installing a preset opens the builder with
/// the preset pre-filled (web `navigate('/automations/new?preset={id}')`). The seam keeps
/// routing out of the view; production injects the app router, previews/tests record the
/// intent.
public protocol AutomationPresetGalleryNavigator: Sendable {
    /// Opens the automation builder seeded with the given preset (web Install action).
    func installPreset(id: String)
}

/// `os.Logger`-backed default that records the install intent without routing, so
/// previews render the Install affordance safely.
public struct OSLogAutomationPresetGalleryNavigator: AutomationPresetGalleryNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "automations")
    }

    public func installPreset(id: String) {
        logger.info("automations.preset.install id=\(id, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `AutomationPresetGallerySource`: the load status, the
/// resolved preset items, the live-state freshness, and the in-flight flag.
public struct AutomationPresetGalleryUpdate: Sendable, Equatable {
    public var status: AutomationPresetGalleryLoadStatus
    public var items: [AutomationPresetItem]
    public var connection: AutomationPresetGalleryConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AutomationPresetGalleryLoadStatus = .loading,
        items: [AutomationPresetItem] = [],
        connection: AutomationPresetGalleryConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.items = items
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// automation-presets state holder (web `useAutomationPresets(category)`); previews/tests
/// use `InMemoryAutomationPresetGallerySource`. The view never talks to the network directly.
@MainActor
public protocol AutomationPresetGallerySource: AnyObject {
    var onUpdate: (@MainActor (AutomationPresetGalleryUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch) — the error-state retry + the stale
    /// auto-refresh.
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAutomationPresetGallerySource: AutomationPresetGallerySource {
    public var onUpdate: (@MainActor (AutomationPresetGalleryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AutomationPresetGalleryUpdate?

    public init(initial: AutomationPresetGalleryUpdate? = nil) {
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
    public func push(_ update: AutomationPresetGalleryUpdate) {
        onUpdate?(update)
    }
}

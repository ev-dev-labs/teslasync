//
//  AutopilotSection.Model.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  driving-dynamics "Autopilot & Cruise" section. The view binds through `AutopilotSectionModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/driving/components/driving-dynamics/AutopilotSection.tsx.
//
//  The web component reads current speed from `useVehicleState` (a 5s `refetchInterval`) and the cruise
//  set-speed + follow distance from two `useSignalObservations` reads, plus the display unit from
//  `useUnits`. The native surface composes all of that behind an `AutopilotSectionSource` so every
//  prompt-required state (loading / empty / error / stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol AutopilotSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogAutopilotSectionTelemetry: AutopilotSectionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "AutopilotSection" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum AutopilotSectionStrings {
    public static let table = "AutopilotSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog (the labels the web reads
    /// via `t()`, plus the em-dash the web embeds inline).
    public static func copy() -> AutopilotCopy {
        AutopilotCopy(
            currentSpeedLabel: string("dynamics.currentSpeed", "Current Speed"),
            cruiseSetSpeedLabel: string("dynamics.cruiseSetSpeed", "Cruise Set Speed"),
            followDistanceLabel: string("dynamics.followDistance", "Follow Distance"),
            emDash: string("dynamics.autopilot.emDash", "—")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `AutopilotSectionSource`: the three telemetry values + the
/// display-unit preference + the load status, the live-state connection, the in-flight flag, and the
/// last-update timestamp.
public struct AutopilotSectionUpdate: Sendable, Equatable {
    public var status: AutopilotLoadStatus
    public var input: AutopilotInput?
    public var unitPrefs: AutopilotUnitPrefs
    public var connection: AutopilotConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AutopilotLoadStatus = .loading,
        input: AutopilotInput? = nil,
        unitPrefs: AutopilotUnitPrefs = AutopilotUnitPrefs(),
        connection: AutopilotConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.unitPrefs = unitPrefs
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — composing the vehicle-state query (web `useVehicleState`) with the two signal-observation
/// reads (web `useSignalObservations` for `CruiseSetSpeed` + `CruiseFollowDistance`) and the
/// unit-preference holder (web `useUnits`). Previews + tests use `InMemoryAutopilotSectionSource`. The
/// view never talks to the network directly.
@MainActor
public protocol AutopilotSectionSource: AnyObject {
    var onUpdate: (@MainActor (AutopilotSectionUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying reads (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `AutopilotSectionSource`, projects each
/// snapshot into the three stat tiles, exposes a render `AutopilotPhase` + freshness for SwiftUI to
/// switch over, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class AutopilotSectionModel {
    public private(set) var phase: AutopilotPhase = .loading
    public private(set) var connection: AutopilotConnection = .live
    public private(set) var projection: AutopilotProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AutopilotSectionSource
    @ObservationIgnored private let telemetry: any AutopilotSectionTelemetry
    @ObservationIgnored private let copy: AutopilotCopy
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AutopilotSectionSource,
        telemetry: any AutopilotSectionTelemetry = OSLogAutopilotSectionTelemetry(),
        copy: AutopilotCopy = AutopilotSectionStrings.copy()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the whole section.
    public var accessibilitySummary: String {
        AutopilotSectionAccessibility.sectionSummary(for: projection, localize: AutopilotSectionStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AutopilotSectionSurface.slug)
        source.start()
    }

    /// Stops observing the upstream reads.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying reads (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: AutopilotSectionUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = AutopilotProjector.project(input: update.input, prefs: update.unitPrefs, copy: copy)
        phase = AutopilotProjector.resolvePhase(update.status, hasAny: projection.hasAny)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached values on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: AutopilotConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAutopilotSectionSource: AutopilotSectionSource {
    public var onUpdate: (@MainActor (AutopilotSectionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AutopilotSectionUpdate?

    public init(initial: AutopilotSectionUpdate? = nil) {
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
    public func push(_ update: AutopilotSectionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension AutopilotSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AutopilotSectionSurface.slug
    }
}

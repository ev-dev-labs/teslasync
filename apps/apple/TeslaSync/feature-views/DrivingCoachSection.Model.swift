//
//  DrivingCoachSection.Model.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  driving-dynamics "Driving Coach" section. The view binds through `DrivingCoachSectionModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/driving/components/driving-dynamics/DrivingCoachSection.tsx.
//
//  The web component is presentational — its parent (the Driving Dynamics page) owns the coach query and
//  the load lifecycle, passing the resolved `coachData` prop down. The native surface reproduces that whole
//  lifecycle through a `DrivingCoachSectionSource` so every prompt-required state (loading / empty / error /
//  stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol DrivingCoachSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event. The
/// slug is a static, non-identifying constant.
public struct OSLogDrivingCoachSectionTelemetry: DrivingCoachSectionTelemetry {
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
/// literals. Keys live in the "DrivingCoachSection" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; the per-surface table keeps each parallel surface prompt self-contained.
public enum DrivingCoachSectionStrings {
    public static let table = "DrivingCoachSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized unit copy from the catalog (the "km" / "Wh/km"
    /// glyphs + em-dash the web embeds inline).
    public static func copy() -> DrivingCoachCopy {
        DrivingCoachCopy(
            distanceUnit: string("dynamics.coach.kmUnit", "km"),
            efficiencyUnit: string("dynamics.coach.whKmUnit", "Wh/km"),
            emDash: string("dynamics.coach.emDash", "—")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `DrivingCoachSectionSource`: the resolved coach payload + its load
/// status, the live-state connection, the in-flight flag, and the last-update timestamp.
public struct DrivingCoachSectionUpdate: Sendable, Equatable {
    public var status: DrivingCoachLoadStatus
    public var data: DrivingCoachData?
    public var connection: DrivingCoachConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: DrivingCoachLoadStatus = .loading,
        data: DrivingCoachData? = nil,
        connection: DrivingCoachConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.data = data
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — running the driving-coach query and projecting it into this surface's payload. Previews +
/// tests use `InMemoryDrivingCoachSectionSource`. The view never talks to the network directly.
@MainActor
public protocol DrivingCoachSectionSource: AnyObject {
    var onUpdate: (@MainActor (DrivingCoachSectionUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh / the error retry).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `DrivingCoachSectionSource`, projects each snapshot
/// into the coach composition, exposes a render `DrivingCoachPhase` + freshness for SwiftUI to bind, and
/// emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class DrivingCoachSectionModel {
    public private(set) var phase: DrivingCoachPhase = .loading
    public private(set) var connection: DrivingCoachConnection = .live
    public private(set) var projection: DrivingCoachProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DrivingCoachSectionSource
    @ObservationIgnored private let telemetry: any DrivingCoachSectionTelemetry
    @ObservationIgnored private let copy: DrivingCoachCopy
    @ObservationIgnored private let localeIdentifier: String
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DrivingCoachSectionSource,
        telemetry: any DrivingCoachSectionTelemetry = OSLogDrivingCoachSectionTelemetry(),
        copy: DrivingCoachCopy = DrivingCoachSectionStrings.copy(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        localeIdentifier = locale.identifier
        self.timeZone = timeZone
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the whole section.
    public var accessibilitySummary: String {
        DrivingCoachAccessibility.sectionSummary(
            for: projection,
            localize: DrivingCoachSectionStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingCoachSectionSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry + header refresh action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DrivingCoachSectionUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = DrivingCoachProjector.project(
            data: update.data,
            copy: copy,
            localeIdentifier: localeIdentifier,
            timeZone: timeZone
        )
        phase = DrivingCoachProjector.resolvePhase(
            update.status,
            hasContent: DrivingCoachProjector.hasContent(update.data)
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached content on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: DrivingCoachConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets a
/// test push further snapshots via `push(_:)`, while recording the start / stop / refresh calls so the
/// wiring can be asserted.
@MainActor
public final class InMemoryDrivingCoachSectionSource: DrivingCoachSectionSource {
    public var onUpdate: (@MainActor (DrivingCoachSectionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingCoachSectionUpdate?

    public init(initial: DrivingCoachSectionUpdate? = nil) {
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
    public func push(_ update: DrivingCoachSectionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension DrivingCoachSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        DrivingCoachSectionSurface.slug
    }
}

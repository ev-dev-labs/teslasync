//
//  SoftwareUpdateHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the canonical registry metadata + the testable accessibility summary. The
//  view binds through `SoftwareUpdateHistoryModel`; no networking lives in the
//  view. Mirrors the established `LocationFavoritesWidget.Model` /
//  `LifetimeStatsWidget.Model` seams so every dashboard surface plugs into the
//  same P4-core state-holder + diagnostics contracts.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which
/// is consent-gated and redacted there.
public protocol SoftwareUpdateHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSoftwareUpdateHistoryTelemetry: SoftwareUpdateHistoryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum SoftwareUpdateHistoryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum SoftwareUpdateHistoryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SoftwareUpdateHistorySource`: the cached
/// update history plus its load/connection status. The model turns this into the
/// render projection.
public struct SoftwareUpdateHistoryUpdate: Sendable, Equatable {
    public var status: SoftwareUpdateHistoryLoadStatus
    public var connection: SoftwareUpdateHistoryConnection
    public var updates: [SoftwareUpdate]
    public var updatedAt: Date?

    public init(
        status: SoftwareUpdateHistoryLoadStatus = .loading,
        connection: SoftwareUpdateHistoryConnection = .live,
        updates: [SoftwareUpdate] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.updates = updates
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useVehicles` + `useSoftwareUpdates` projected
/// from the KMP `VehicleStore` / `VehicleSystemsStore`); previews and tests use
/// `InMemorySoftwareUpdateHistorySource`.
@MainActor
public protocol SoftwareUpdateHistorySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SoftwareUpdateHistoryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a
/// `SoftwareUpdateHistorySource`, recomputes the event-feed + compact-latest
/// projection, and exposes a render `Phase` + freshness for SwiftUI to switch
/// over.
@MainActor
@Observable
public final class SoftwareUpdateHistoryModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SoftwareUpdateHistoryConnection = .live
    public private(set) var feedItems: [SoftwareUpdateFeedItem] = []
    public private(set) var latest: SoftwareUpdateLatest?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SoftwareUpdateHistorySource
    @ObservationIgnored private let telemetry: any SoftwareUpdateHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SoftwareUpdateHistorySource,
        telemetry: any SoftwareUpdateHistoryTelemetry = OSLogSoftwareUpdateHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the feed has at least one row.
    public var hasUpdates: Bool {
        !feedItems.isEmpty
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SoftwareUpdateHistorySurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SoftwareUpdateHistoryUpdate) {
        let now = Date()
        connection = update.connection
        updatedAt = update.updatedAt
        feedItems = SoftwareUpdateProjection.feedItems(from: update.updates, now: now)
        latest = SoftwareUpdateProjection.latest(from: update.updates)
        phase = Self.resolvePhase(update.status, hasData: !update.updates.isEmpty)
    }

    /// Resolves the render phase. Whenever there is cached history to show, the
    /// content renders and stays visible behind refresh/errors (the web keeps the
    /// last feed under the freshness/error dot). The top-level empty/error states
    /// are reserved for a resolved load / failure with nothing cached.
    static func resolvePhase(_ status: SoftwareUpdateHistoryLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .loaded, .empty:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySoftwareUpdateHistorySource: SoftwareUpdateHistorySource {
    public var onUpdate: (@MainActor (SoftwareUpdateHistoryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SoftwareUpdateHistoryUpdate?

    public init(initial: SoftwareUpdateHistoryUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: SoftwareUpdateHistoryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata (slug + canonical registry entry)

/// The surface's stable identity: the P1/S11 diagnostics slug and the canonical
/// dashboard-registry entry (web `registry/vehicle.ts → "software-update-history"`).
/// Decoupled from the SwiftUI view so the model + projection compile/test without
/// the design system.
public enum SoftwareUpdateHistorySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "SoftwareUpdateHistoryWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "software-update-history").
    public static let registration = DashboardWidgetRegistration(
        id: "software-update-history",
        nameKey: "widget.softwareUpdateHistory",
        descriptionKey: "widget.softwareUpdateHistory.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SoftwareUpdateHistoryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum SoftwareUpdateHistoryStrings {
    public static let table = "SoftwareUpdateHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// The localized status label for an update status (`Installed` / `Installing`
    /// / …), the native localization of the raw web enum the source renders.
    public static func label(for status: SoftwareUpdateStatus) -> String {
        string(status.labelKey, status.labelFallback)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget header / compact badge. Pure
/// + public so the a11y label content can be unit-tested without rendering.
public enum SoftwareUpdateHistoryAccessibility {
    /// The compact-badge summary: "{version}, {status}" (e.g. "2024.8.7, Current").
    public static func compactSummary(_ latest: SoftwareUpdateLatest) -> String {
        "\(latest.version), \(latest.statusLabel)"
    }

    /// The full-feed summary: the localized "N updates" count, or the empty hint.
    public static func feedSummary(count: Int) -> String {
        if count > 0 {
            return SoftwareUpdateHistoryStrings.count(
                "widget.softwareUpdateHistory.countA11y",
                "%lld updates in history",
                count
            )
        }
        return SoftwareUpdateHistoryStrings.string("widget.noUpdates", "No update history")
    }

    /// One feed-row spoken label: "{version}. {status}. {time}".
    public static func rowSummary(_ item: SoftwareUpdateFeedItem) -> String {
        "\(item.title). \(item.subtitle). \(item.relativeTime)"
    }
}

//
//  LocationFavoritesWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0059 · LocationFavoritesWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `LocationFavoritesModel`; no networking lives in the view. Mirrors the
//  established `DigitalTwinWidget.Model` seam so every dashboard surface plugs
//  into the same P4-core state-holder + diagnostics contracts.
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
public protocol LocationFavoritesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLocationFavoritesTelemetry: LocationFavoritesTelemetry {
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
public enum LocationFavoritesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum LocationFavoritesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `LocationFavoritesSource`: the cached DTO
/// inputs (favorites list + latest snapshot) plus their load/connection status.
/// The model turns this into the render projection.
public struct LocationFavoritesUpdate: Sendable, Equatable {
    public var status: LocationFavoritesLoadStatus
    public var connection: LocationFavoritesConnection
    public var locations: [LocationFavoritesLocation]
    public var snapshot: LocationFavoritesSnapshot?
    public var updatedAt: Date?

    public init(
        status: LocationFavoritesLoadStatus = .loading,
        connection: LocationFavoritesConnection = .live,
        locations: [LocationFavoritesLocation] = [],
        snapshot: LocationFavoritesSnapshot? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.locations = locations
        self.snapshot = snapshot
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useLocations` / `useVehicles` /
/// `useLocationSnapshotLatest` projected from the KMP `LocationStore` /
/// `VehicleStore`); previews and tests use `InMemoryLocationFavoritesSource`.
@MainActor
public protocol LocationFavoritesSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LocationFavoritesUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `LocationFavoritesSource`,
/// recomputes the presence badge + ranked favorites projection, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class LocationFavoritesModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    /// The number of favorites the full-size list renders — the web
    /// `WidgetRankedList` non-compact default.
    public static let maxRows = 5

    public private(set) var phase: Phase = .loading
    public private(set) var connection: LocationFavoritesConnection = .live
    public private(set) var presence: LocationPresence = .other
    public private(set) var destinationName: String?
    public private(set) var favorites: [LocationRankedItem] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LocationFavoritesSource
    @ObservationIgnored private let telemetry: any LocationFavoritesTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LocationFavoritesSource,
        telemetry: any LocationFavoritesTelemetry = OSLogLocationFavoritesTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the favorites list has at least one row.
    public var hasFavorites: Bool {
        !favorites.isEmpty
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LocationFavoritesWidget.surfaceSlug)
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

    private func apply(_ update: LocationFavoritesUpdate) {
        let now = Date()
        connection = update.connection
        updatedAt = update.updatedAt
        presence = LocationFavoritesProjection.presence(for: update.snapshot)
        destinationName = Self.cleanedDestination(update.snapshot?.destinationName)
        favorites = LocationFavoritesProjection.rankedItems(
            from: update.locations,
            limit: Self.maxRows,
            now: now
        )
        phase = Self.resolvePhase(update, hasSnapshot: update.snapshot != nil, hasFavorites: !favorites.isEmpty)
    }

    /// Resolves the render phase. Whenever there is any data to show — favorites
    /// or a snapshot (which always yields at least the "Other" badge) — the
    /// content renders and cached values stay visible behind refresh/errors. The
    /// top-level empty state is reserved for a resolved load with nothing at all.
    private static func resolvePhase(
        _ update: LocationFavoritesUpdate,
        hasSnapshot: Bool,
        hasFavorites: Bool
    ) -> Phase {
        let hasData = hasSnapshot || hasFavorites
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case .loaded, .empty:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }

    private static func cleanedDestination(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLocationFavoritesSource: LocationFavoritesSource {
    public var onUpdate: (@MainActor (LocationFavoritesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LocationFavoritesUpdate?

    public init(initial: LocationFavoritesUpdate? = nil) {
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
    public func push(_ update: LocationFavoritesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "LocationFavoritesWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum LocationFavoritesStrings {
    public static let table = "LocationFavoritesWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// The localized status label for a presence (`Home` / `Work` / …).
    public static func label(for presence: LocationPresence) -> String {
        string(presence.labelKey, presence.labelFallback)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum LocationFavoritesAccessibility {
    public static func summary(
        presence: LocationPresence,
        favoritesCount: Int,
        destinationName: String?
    ) -> String {
        var parts = [LocationFavoritesStrings.label(for: presence)]
        if let destinationName, !destinationName.isEmpty {
            parts.append(LocationFavoritesStrings.string(
                "widget.locationFavorites.navigatingTo",
                "Navigating to %@"
            ).replacingOccurrences(of: "%@", with: destinationName))
        }
        if favoritesCount > 0 {
            parts.append(LocationFavoritesStrings.count(
                "widget.locationFavorites.favoriteCount",
                "%lld favorite locations",
                favoritesCount
            ))
        } else {
            parts.append(LocationFavoritesStrings.string(
                "widget.locationFavorites.noData",
                "No favorite locations"
            ))
        }
        return parts.joined(separator: ". ")
    }
}

//
//  MediaNowPlayingWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + the i18n facade (P1/S10)
//  + the testable accessibility summary. The view binds through this seam and
//  never touches the network.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol MediaNowPlayingTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogMediaNowPlayingTelemetry: MediaNowPlayingTelemetry {
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
public enum MediaLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web
/// `useMediaLatest(id, 5_000)` polls every 5 s; the production source maps that
/// cadence + reachability into these cases.
public enum MediaConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `MediaNowPlayingSource`: the cached DTO
/// plus its load/connection status. The model turns this into the projection.
public struct MediaNowPlayingUpdate: Sendable, Equatable {
    public var status: MediaLoadStatus
    public var connection: MediaConnection
    public var vehicle: MediaVehicle?
    public var snapshot: MediaSnapshotInput?
    public var updatedAt: Date?

    public init(
        status: MediaLoadStatus = .loading,
        connection: MediaConnection = .live,
        vehicle: MediaVehicle? = nil,
        snapshot: MediaSnapshotInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.snapshot = snapshot
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// `VehicleStore` / `MediaStore`); previews and tests use
/// `InMemoryMediaNowPlayingSource`. The view never talks to the network directly.
@MainActor
public protocol MediaNowPlayingSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (MediaNowPlayingUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `MediaNowPlayingSource`,
/// recomputes the `MediaNowPlaying` projection via `MediaProjectionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class MediaNowPlayingModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: MediaConnection = .live
    public private(set) var media: MediaNowPlaying?
    public private(set) var vehicle: MediaVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MediaNowPlayingSource
    @ObservationIgnored private let telemetry: any MediaNowPlayingTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any MediaNowPlayingSource,
        telemetry: any MediaNowPlayingTelemetry = OSLogMediaNowPlayingTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MediaNowPlayingWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: MediaNowPlayingUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        media = MediaProjectionBuilder.build(from: update.snapshot)
        phase = Self.resolvePhase(update.status, hasMedia: media != nil)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when there is no snapshot; whenever a snapshot is
    /// known the track renders (cached values stay visible behind refresh/errors).
    static func resolvePhase(_ status: MediaLoadStatus, hasMedia: Bool) -> Phase {
        switch status {
        case .loading:
            hasMedia ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasMedia ? .content : .empty
        case let .failed(message):
            hasMedia ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMediaNowPlayingSource: MediaNowPlayingSource {
    public var onUpdate: (@MainActor (MediaNowPlayingUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MediaNowPlayingUpdate?

    public init(initial: MediaNowPlayingUpdate? = nil) {
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
    public func push(_ update: MediaNowPlayingUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "MediaNowPlayingWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum MediaNowPlayingStrings {
    public static let table = "MediaNowPlayingWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the now-playing track. Pure + public so
/// the a11y label content can be unit-tested without rendering the view.
public enum MediaNowPlayingAccessibility {
    public static func summary(for media: MediaNowPlaying?) -> String {
        guard let media else {
            return MediaNowPlayingStrings.string("widget.noMedia", "Nothing playing")
        }
        var parts = [
            MediaNowPlayingStrings.format("widget.media.a11yTrack", "%@ by %@", media.title, media.artist)
        ]
        if media.isPlaying {
            parts.append(MediaNowPlayingStrings.string("widget.playing", "Playing"))
        }
        if let source = media.source {
            parts.append(MediaNowPlayingStrings.format("widget.media.a11ySource", "Source %@", source))
        }
        return parts.joined(separator: ". ")
    }
}

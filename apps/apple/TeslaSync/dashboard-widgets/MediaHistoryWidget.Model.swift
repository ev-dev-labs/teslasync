//
//  MediaHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility/relative-time formatting. The dashboard registry
//  types (DashboardWidgetSize / DashboardWidgetRegistration) are shared across
//  surfaces and declared once by the DigitalTwinWidget sibling — reused here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol MediaHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogMediaHistoryTelemetry: MediaHistoryTelemetry {
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

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum MediaConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `MediaHistorySource`: the cached DTO rows
/// plus their load/connection status. The model turns this into the projection.
public struct MediaHistoryUpdate: Sendable, Equatable {
    public var status: MediaLoadStatus
    public var connection: MediaConnection
    public var tracks: [MediaTrackInput]
    public var updatedAt: Date?

    public init(
        status: MediaLoadStatus = .loading,
        connection: MediaConnection = .live,
        tracks: [MediaTrackInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.tracks = tracks
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the KMP media-history `StateHolderModel<…>` fed by
/// `useMediaHistory` + `useVehicles`); previews and tests use
/// `InMemoryMediaHistorySource`. The view never talks to the network directly.
@MainActor
public protocol MediaHistorySource: AnyObject {
    var onUpdate: (@MainActor (MediaHistoryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `MediaHistorySource`,
/// projects rows via `MediaHistoryBuilder`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class MediaHistoryModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: MediaConnection = .live
    public private(set) var tracks: [MediaTrack] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MediaHistorySource
    @ObservationIgnored private let telemetry: any MediaHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any MediaHistorySource,
        telemetry: any MediaHistoryTelemetry = OSLogMediaHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MediaHistoryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached rows stay visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// The most-recently-played track (web `history[0]`) for the compact view.
    public var latestTrack: MediaTrack? {
        MediaHistoryBuilder.latestTrack(from: tracks)
    }

    /// The newest-first, capped feed rows (web feed sort+slice).
    public var feedTracks: [MediaTrack] {
        MediaHistoryBuilder.feedTracks(from: tracks)
    }

    private func apply(_ update: MediaHistoryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        tracks = MediaHistoryBuilder.makeTracks(from: update.tracks)
        phase = Self.resolvePhase(status: update.status, hasTracks: !tracks.isEmpty)
    }

    /// Resolves the render phase. Like the web shell, the skeleton only shows on
    /// the initial fetch and the empty copy only when there are no tracks; once
    /// any rows are cached they stay visible behind refresh/errors.
    static func resolvePhase(status: MediaLoadStatus, hasTracks: Bool) -> Phase {
        switch status {
        case .loading:
            hasTracks ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasTracks ? .content : .empty
        case let .failed(message):
            hasTracks ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMediaHistorySource: MediaHistorySource {
    public var onUpdate: (@MainActor (MediaHistoryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MediaHistoryUpdate?

    public init(initial: MediaHistoryUpdate? = nil) {
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
    public func push(_ update: MediaHistoryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "MediaHistoryWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum MediaHistoryStrings {
    public static let table = "MediaHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// Localizes a relative-time bucket (web `formatRelativeTime` strings). Shared
    /// by the feed row and the VoiceOver label so the copy lives in one place.
    public static func relativeTimeLabel(_ bucket: MediaRelativeTime) -> String {
        switch bucket {
        case .justNow:
            string("widget.media.justNow", "Just now")
        case let .minutes(value):
            count("widget.media.minutesAgo", "%lldm ago", value)
        case let .hours(value):
            count("widget.media.hoursAgo", "%lldh ago", value)
        case let .absolute(date):
            absoluteFormatter.string(from: date)
        }
    }

    private static let absoluteFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver label spoken for one feed row. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum MediaHistoryAccessibility {
    public static func rowLabel(for track: MediaTrack, now: Date = Date()) -> String {
        var parts: [String] = [track.titleLine]
        if let source = track.sourceLabel { parts.append(source) }
        if track.isPlaying {
            parts.append(MediaHistoryStrings.string("widget.media.nowPlaying", "Now playing"))
        }
        let bucket = MediaHistoryBuilder.relativeTime(for: track.timestamp, now: now)
        parts.append(MediaHistoryStrings.relativeTimeLabel(bucket))
        return parts.joined(separator: ". ")
    }
}

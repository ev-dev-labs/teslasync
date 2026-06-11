//
//  TimelineScrubber.Model.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The contracts + value-types for the trip-replay timeline scrubber — the SwiftUI parity of
//  `web/src/components/data-display/TimelineScrubber.tsx`. The web component is a CONTROLLED
//  presentational track: the host owns `progress / buffered / duration / markers` and the scrubber
//  reports normalized 0…1 positions back through `onSeek` (intermediate emits throttled while
//  dragging by `SCRUB_INTERVAL_MS = 50ms`; the final position always emits on release / click /
//  marker tap). A `getPreviewAt(normalized)` sampler returns pre-formatted speed / power / SoC /
//  elevation for the hover + drag preview bubble. Its only data sources are `useTranslation` (the
//  i18n facade) and `useMotionPreference` (Reduce Motion); there is no fetch, no React-Query cache.
//
//  This file holds the value-types + the P1/S10 i18n facade, the P1/S11 telemetry seam, and the
//  diagnostics metadata. The pure projection / helpers live in `TimelineScrubber.Adapter.swift` +
//  `TimelineScrubber.Projection.swift`; the `@Observable` state-holder (P1/S8) lives in
//  `TimelineScrubber.Store.swift`; the source seams in `TimelineScrubber.Seams.swift`. No networking
//  lives anywhere — the web source has none.
//

import Foundation
import OSLog

// MARK: - Diagnostics metadata (P1/S11)

/// Static, non-identifying metadata for the surface. The slug is the `view.opened` event name.
public enum TimelineScrubberMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TimelineScrubber"
    /// Smooth-scrub emit interval in seconds (web `SCRUB_INTERVAL_MS = 50`).
    public static let scrubInterval: Double = 0.05
    /// VoiceOver adjustable step as a fraction of the timeline (5%), so swipe-to-scrub is usable.
    public static let adjustStep: Double = 0.05
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TimelineScrubberTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default recording the surface open as a redaction-safe `view.opened` event.
public struct OSLogTimelineScrubberTelemetry: TimelineScrubberTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves a localized string by key with an English fallback, so the views, the projection, and the
/// accessibility helpers hold no hardcoded user-facing literals.
public typealias TimelineScrubberResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with its English fallback. Keys live in the
/// "TimelineScrubber" table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings.
public enum TimelineScrubberStrings {
    public static let table = "TimelineScrubber"

    public static let string: TimelineScrubberResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feed — the orthogonal connectivity axis rendered as the freshness chip.
/// `live` hides the chip; `stale` / `offline` show it while the last timeline stays visible.
public enum TimelineScrubberConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Timeline markers (web `TimelineMarker` / `TimelineMarkerKind`)

/// The kind of notable moment a scrubber tick represents — the native mirror of the web
/// `TimelineMarkerKind`. Each maps to a tint + an SF Symbol at the view boundary (not here, so the
/// model stays SwiftUI-free and unit-testable).
public enum TimelineScrubberMarkerKind: String, Sendable, Equatable, CaseIterable {
    case start
    case stop
    case chargeStart
    case chargeStop
    case fastSegment
    case regenPeak
    case lowSoc
    case event
}

/// One notable moment along the timeline — the native mirror of the web `TimelineMarker`. `at` is a
/// normalized 0…1 position (clamped on init); `label` is the (already-localized) tooltip text;
/// `count` surfaces a clustered-event badge when > 1. The web `href` routing variant is intentionally
/// folded into `onSeek` here — a native scrubber tick always seeks to its moment.
public struct TimelineScrubberMarker: Sendable, Equatable, Identifiable {
    public let id: String
    public let at: Double
    public let kind: TimelineScrubberMarkerKind
    public let label: String?
    public let count: Int?

    public init(
        at: Double,
        kind: TimelineScrubberMarkerKind,
        label: String? = nil,
        count: Int? = nil,
        id: String? = nil
    ) {
        self.at = max(0, min(1, at))
        self.kind = kind
        self.label = label
        self.count = count
        self.id = id ?? "\(kind.rawValue)-\(self.at)"
    }
}

// MARK: - Scrub preview (web `TimelinePreviewPoint`)

/// The formatted preview values sampled for a normalized scrubber position — the native mirror of the
/// web `TimelinePreviewPoint`. The host pre-formats every string (the scrubber does no number
/// formatting itself, exactly as the web sampler contract requires).
public struct TimelineScrubberPreview: Sendable, Equatable {
    public let at: Double
    public let speed: String?
    public let power: String?
    public let soc: String?
    public let elevation: String?

    public init(
        at: Double,
        speed: String? = nil,
        power: String? = nil,
        soc: String? = nil,
        elevation: String? = nil
    ) {
        self.at = at
        self.speed = speed
        self.power = power
        self.soc = soc
        self.elevation = elevation
    }
}

// MARK: - Input snapshot (web props + parent lifecycle)

/// One coalesced snapshot of the scrubber's inputs — the native mirror of the web `progress /
/// buffered / duration / markers` props plus the parent's lifecycle (`isLoading`, an error message,
/// connectivity). A value type, so it is `Sendable` & `Equatable` and the projection is a pure
/// function of it. `durationSeconds` is the web `duration` (seconds) used for the spoken value text
/// and the empty-state guard.
public struct TimelineScrubberInput: Sendable, Equatable {
    public var progress: Double
    public var buffered: Double?
    public var durationSeconds: Double
    public var markers: [TimelineScrubberMarker]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TimelineScrubberConnection

    public init(
        progress: Double = 0,
        buffered: Double? = nil,
        durationSeconds: Double = 0,
        markers: [TimelineScrubberMarker] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TimelineScrubberConnection = .live
    ) {
        self.progress = progress
        self.buffered = buffered
        self.durationSeconds = durationSeconds
        self.markers = markers
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Host callbacks (web `onSeek`)

/// The host's seek callback — the native mirror of the web controlled-component `onSeek` prop. Held by
/// the state-holder (not the `Input` snapshot) because closures are not value state. Invoked on click,
/// drag-release, intermediate throttled drag emits, marker taps, and VoiceOver adjustments.
public struct TimelineScrubberActions {
    public var onSeek: @MainActor (Double) -> Void

    public init(onSeek: @escaping @MainActor (Double) -> Void = { _ in }) {
        self.onSeek = onSeek
    }
}

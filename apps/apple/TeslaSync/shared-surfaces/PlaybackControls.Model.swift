//
//  PlaybackControls.Model.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The contracts + value-types for the trip-replay transport bar — the SwiftUI parity of
//  `web/src/components/data-display/PlaybackControls.tsx`. The web component is a CONTROLLED
//  presentational bar: the host owns `isPlaying / speed / progress / elapsed / total` and the bar
//  calls back through `onPlay / onPause / onStop / onSpeedChange / onSeek` (+ the keyboard-only
//  `onSeekBy / onSpeedRelative / onStepFrame`). It composes a Reset / Play-Pause / Stop trio, a
//  `PlaybackSpeedMenu` cycling {1,10,25,50,100}×, a `TimelineScrubber` with marker ticks + a hover /
//  drag preview, a time readout, an optional keyboard-shortcut layer (Space/K, ←/→, J/L, ,/., Home/
//  End, 0–9, +/−) with a transient toast, and a `useShortcut` registration of the cheatsheet.
//
//  This file holds the value-types + the P1/S10 i18n facade, the P1/S11 telemetry seam, and the
//  diagnostics metadata. The @Observable state-holder (P1/S8) lives in `PlaybackControls.Store.swift`;
//  the pure projection / keyboard resolver lives in `PlaybackControls.Projection.swift`. No networking
//  lives anywhere here — the web source has none.
//

import Foundation
import OSLog

// MARK: - Diagnostics metadata (P1/S11)

/// Static, non-identifying metadata for the surface. The slug is the `view.opened` event name.
public enum PlaybackControlsMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PlaybackControls"
    /// How long the inline shortcut toast stays on screen (web `setTimeout(…, 900)`).
    public static let toastDurationMs = 900
    /// Smooth-scrub emit interval in seconds (web `SCRUB_INTERVAL_MS = 50`).
    public static let scrubInterval: Double = 0.05
    /// Default keyboard skip in seconds (web `±5s`, Shift escalates to `±30s`).
    public static let smallSkipSeconds: Double = 5
    public static let largeSkipSeconds: Double = 30
    /// J / L skip in seconds (web `±10s`).
    public static let mediumSkipSeconds: Double = 10
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PlaybackControlsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default recording the surface open as a redaction-safe `view.opened` event.
public struct OSLogPlaybackControlsTelemetry: PlaybackControlsTelemetry {
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
public typealias PlaybackControlsResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with its English fallback. Keys live in the
/// "PlaybackControls" table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings.
public enum PlaybackControlsStrings {
    public static let table = "PlaybackControls"

    public static let string: PlaybackControlsResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feed — the orthogonal connectivity axis rendered as the freshness chip.
/// `live` hides the chip; `stale` / `offline` show it while the last content stays visible.
public enum PlaybackControlsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Replay speed (web `ReplaySpeed` = 1 | 10 | 25 | 50 | 100)

/// The discrete replay speeds — the native mirror of the web `REPLAY_SPEEDS` list. Ordered slow→fast
/// so `shifted(by:)` / `next` step through the same slots the web `shiftSpeed` / `nextSpeed` do.
public enum PlaybackControlsSpeed: Int, Sendable, Equatable, CaseIterable, Comparable, Identifiable {
    case x1 = 1
    case x10 = 10
    case x25 = 25
    case x50 = 50
    case x100 = 100

    public var id: Int {
        rawValue
    }

    /// The numeric multiplier (1, 10, 25, 50, 100).
    public var multiplier: Int {
        rawValue
    }

    /// The compact label the web renders as `${speed}x` (e.g. "10x"). A unit suffix, not prose.
    public var label: String {
        "\(rawValue)x"
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Steps `delta` slots (signed), clamped to the ends — the web `shiftSpeed(current, delta)`.
    public func shifted(by delta: Int) -> PlaybackControlsSpeed {
        let order = Self.allCases
        let idx = order.firstIndex(of: self) ?? 0
        let next = max(0, min(order.count - 1, idx + delta))
        return order[next]
    }

    /// Cycles to the next-fastest speed, wrapping around — the web `nextSpeed(current)`.
    public var next: PlaybackControlsSpeed {
        let order = Self.allCases
        let idx = order.firstIndex(of: self) ?? 0
        return order[(idx + 1) % order.count]
    }
}

// MARK: - Timeline markers (web `TimelineMarker` / `TimelineMarkerKind`)

/// The kind of notable moment a scrubber tick represents — the native mirror of the web
/// `TimelineMarkerKind`. Each maps to a tint + an SF Symbol at the view boundary (not here, so the
/// model stays SwiftUI-free and unit-testable).
public enum PlaybackControlsMarkerKind: String, Sendable, Equatable, CaseIterable {
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
/// normalized 0…1 position; `label` is the (already-localized) tooltip text; `count` surfaces a
/// clustered-event badge when > 1.
public struct PlaybackControlsMarker: Sendable, Equatable, Identifiable {
    public let id: String
    public let at: Double
    public let kind: PlaybackControlsMarkerKind
    public let label: String?
    public let count: Int?

    public init(
        at: Double,
        kind: PlaybackControlsMarkerKind,
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
public struct PlaybackControlsPreview: Sendable, Equatable {
    public let at: Double
    public let speed: String?
    public let power: String?
    public let soc: String?
    public let elevation: String?

    public init(at: Double, speed: String? = nil, power: String? = nil, soc: String? = nil, elevation: String? = nil) {
        self.at = at
        self.speed = speed
        self.power = power
        self.soc = soc
        self.elevation = elevation
    }
}

// MARK: - Shortcut toast (web inline `ShortcutToast`)

/// The transient inline feedback shown after a keyboard action — the native mirror of the web
/// `ShortcutToast`. The `id` is a monotonic tag so a rapid second toast cancels the first cleanly.
public struct PlaybackControlsToast: Sendable, Equatable, Identifiable {
    public let id: Int
    public let label: String

    public init(id: Int, label: String) {
        self.id = id
        self.label = label
    }
}

// MARK: - Input snapshot (web props + parent lifecycle)

/// One coalesced snapshot of the bar's inputs — the native mirror of the web `isPlaying / speed /
/// progress / elapsed / total / durationMs / markers / enableKeyboardShortcuts` props plus the
/// parent's lifecycle (`isLoading`, an error message, connectivity). A value type, so it is
/// `Sendable` & `Equatable` and the projection is a pure function of it.
public struct PlaybackControlsInput: Sendable, Equatable {
    public var isPlaying: Bool
    public var speed: PlaybackControlsSpeed
    public var progress: Double
    public var elapsed: String
    public var total: String
    public var durationMs: Double?
    public var markers: [PlaybackControlsMarker]
    public var enableKeyboardShortcuts: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: PlaybackControlsConnection

    public init(
        isPlaying: Bool = false,
        speed: PlaybackControlsSpeed = .x1,
        progress: Double = 0,
        elapsed: String = "0:00",
        total: String = "0:00",
        durationMs: Double? = nil,
        markers: [PlaybackControlsMarker] = [],
        enableKeyboardShortcuts: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: PlaybackControlsConnection = .live
    ) {
        self.isPlaying = isPlaying
        self.speed = speed
        self.progress = max(0, min(1, progress))
        self.elapsed = elapsed
        self.total = total
        self.durationMs = durationMs
        self.markers = markers
        self.enableKeyboardShortcuts = enableKeyboardShortcuts
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Host callbacks (web `onPlay / onPause / onStop / onSpeedChange / onSeek` + keyboard hooks)

/// The host's transport callbacks — the native mirror of the web controlled-component props. Held by
/// the state-holder (not the `Input` snapshot) because closures are not value state. The keyboard-only
/// hooks are optional, exactly like the web `onSeekBy / onSpeedRelative / onStepFrame`; when absent the
/// model falls back to `onSeek` driven by `durationMs`, reproducing the web `seekBySeconds` fallback.
public struct PlaybackControlsActions {
    public var onPlay: @MainActor () -> Void
    public var onPause: @MainActor () -> Void
    public var onStop: @MainActor () -> Void
    public var onSpeedChange: @MainActor (PlaybackControlsSpeed) -> Void
    public var onSeek: @MainActor (Double) -> Void
    public var onSeekBy: (@MainActor (Double) -> Void)?
    public var onSpeedRelative: (@MainActor (Int) -> Void)?
    public var onStepFrame: (@MainActor (Int) -> Void)?

    public init(
        onPlay: @escaping @MainActor () -> Void = {},
        onPause: @escaping @MainActor () -> Void = {},
        onStop: @escaping @MainActor () -> Void = {},
        onSpeedChange: @escaping @MainActor (PlaybackControlsSpeed) -> Void = { _ in },
        onSeek: @escaping @MainActor (Double) -> Void = { _ in },
        onSeekBy: (@MainActor (Double) -> Void)? = nil,
        onSpeedRelative: (@MainActor (Int) -> Void)? = nil,
        onStepFrame: (@MainActor (Int) -> Void)? = nil
    ) {
        self.onPlay = onPlay
        self.onPause = onPause
        self.onStop = onStop
        self.onSpeedChange = onSpeedChange
        self.onSeek = onSeek
        self.onSeekBy = onSeekBy
        self.onSpeedRelative = onSpeedRelative
        self.onStepFrame = onStepFrame
    }
}

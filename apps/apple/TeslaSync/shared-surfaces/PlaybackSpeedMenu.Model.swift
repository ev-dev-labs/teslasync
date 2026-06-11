//
//  PlaybackSpeedMenu.Model.swift
//  TeslaSync — P4 shared surface · 0097 · PlaybackSpeedMenu (Apple)
//
//  The Foundation-only core of the playback-speed control — the native parity of
//  `components/data-display/PlaybackSpeedMenu.tsx`. The web component is a compact ghost button that
//  shows the current replay speed (`{speed}x`) with a chevron; a primary click cycles to the
//  next-fastest speed (wrapping), and a secondary (right-click) gesture steps one speed slower
//  (clamped). It is purely props-driven: its only data source is `speed` + `onChange`, and its only
//  hook is `useTranslation` (the P1/S10 localisation facade). There is no network and no data-fetch
//  state holder to bind — so this layer mirrors that exactly: the `ReplaySpeed` domain type, the pure
//  step/cycle projection (the verbatim port of `REPLAY_SPEEDS` / `shiftSpeed` / `nextSpeed`), the
//  i18n facade, the diagnostics slug + telemetry seam (P1/S11), and the `@MainActor` action model
//  that owns the host `onChange` callback. View-free so every branch is unit tested without a view.
//
//  Branches reproduced from the web source (every one is exercised — the source is a stateless
//  controlled control, so it has no loading / empty / error / stale / offline data states):
//    • forward cycle — primary click advances to the next-fastest speed and wraps 100x → 1x
//                       (web `onClick` → `onChange(nextSpeed(speed))`).
//    • backward step — secondary gesture steps one speed slower and clamps at 1x
//                       (web `onContextMenu` → `onChange(shiftSpeed(speed, -1))`).
//    • direct select — the native menu picks an exact speed (the HIG-idiomatic superset of the
//                       web secondary gesture; current row is checkmarked).
//

import Foundation
import Observation
import OSLog

// MARK: - Replay speed (web `ReplaySpeed` from @/hooks/useTripReplay)

/// The discrete trip-replay scrub speeds — the native port of the web numeric-literal union
/// `ReplaySpeed`. `allCases` is declared slowest → fastest so it is the verbatim order of the web
/// `REPLAY_SPEEDS` constant; each case's raw value is its on-screen multiplier (`{speed}x`).
public enum ReplaySpeed: Int, Sendable, Equatable, CaseIterable, Identifiable, Comparable {
    case x1 = 1
    case x10 = 10
    case x25 = 25
    case x50 = 50
    case x100 = 100

    public var id: Int {
        rawValue
    }

    /// The numeric multiplier shown on screen — the web numeric literal value (e.g. `10` → "10x").
    public var multiplier: Int {
        rawValue
    }

    public static func < (lhs: ReplaySpeed, rhs: ReplaySpeed) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

// MARK: - Pure step / cycle logic (web `REPLAY_SPEEDS` / `shiftSpeed` / `nextSpeed`)

/// The view-free decision logic ported from the web component: the ordered speed list and the two
/// stepping helpers. Each function is a direct translation of a web export so the view stays a pure
/// function of these and every branch is unit tested in isolation.
public enum PlaybackSpeedMenuLogic {
    /// The ordered selectable speeds — the parity of the web `REPLAY_SPEEDS` constant.
    public static let replaySpeeds: [ReplaySpeed] = ReplaySpeed.allCases

    /// Steps `current` by `delta` slots (signed), clamped to the ends — the verbatim port of the web
    /// `shiftSpeed`. An unknown current resolves to slot 0 (web `idx === -1 ? 0 : idx`).
    public static func shiftSpeed(_ current: ReplaySpeed, by delta: Int) -> ReplaySpeed {
        let speeds = replaySpeeds
        let safeIdx = speeds.firstIndex(of: current) ?? 0
        let nextIdx = max(0, min(speeds.count - 1, safeIdx + delta))
        return speeds[nextIdx]
    }

    /// Cycles to the next-fastest speed, wrapping from the fastest back to the slowest — the verbatim
    /// port of the web `nextSpeed` (`REPLAY_SPEEDS[(idx + 1) % length]`, with an unknown current
    /// treated as `idx === -1`).
    public static func nextSpeed(_ current: ReplaySpeed) -> ReplaySpeed {
        let speeds = replaySpeeds
        let idx = speeds.firstIndex(of: current) ?? -1
        return speeds[(idx + 1) % speeds.count]
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum PlaybackSpeedMenuMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PlaybackSpeedMenu"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PlaybackSpeedMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPlaybackSpeedMenuTelemetry: PlaybackSpeedMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the control appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum PlaybackSpeedMenuDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any PlaybackSpeedMenuTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: PlaybackSpeedMenuMeta.surfaceSlug)
        return true
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "PlaybackSpeedMenu" table (the exact set from the web source
/// `components/data-display/PlaybackSpeedMenu.tsx`), folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum PlaybackSpeedMenuStrings {
    public static let table = "PlaybackSpeedMenu"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The control's accessible label — the web `aria-label={t('replay.controls.speed', …)}`.
    public static var speedControlLabel: String {
        string("replay.controls.speed", "Playback speed")
    }

    /// The visible/spoken value for a speed (web `{speed}x`). A formatted multiplier, not
    /// translatable prose, so it is composed from the numeric value rather than a catalog key.
    public static func speedValueLabel(_ speed: ReplaySpeed) -> String {
        "\(speed.multiplier)x"
    }
}

// MARK: - Action model (@MainActor owner of the host onChange callback)

/// The `@MainActor` action model the view binds through — the home for the host-supplied `onChange`
/// callback (the native shape of the web `onChange` prop) and the once-only `view.opened` emission.
/// The web control is *controlled* (the parent owns `speed`), so the step handlers take the current
/// speed and emit the projected next value — the verbatim shape of the web `onChange(nextSpeed(speed))`
/// / `onChange(shiftSpeed(speed, -1))` handlers. The view stays a pure function of the incoming
/// `speed`; this model carries the change notification off the view.
@MainActor
@Observable
public final class PlaybackSpeedMenuModel {
    @ObservationIgnored private let onChange: @MainActor (ReplaySpeed) -> Void
    @ObservationIgnored private let telemetry: any PlaybackSpeedMenuTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        onChange: @escaping @MainActor (ReplaySpeed) -> Void,
        telemetry: any PlaybackSpeedMenuTelemetry = OSLogPlaybackSpeedMenuTelemetry()
    ) {
        self.onChange = onChange
        self.telemetry = telemetry
    }

    /// Emits `view.opened` exactly once, the first time the control appears (idempotent).
    public func markAppeared() {
        didEmitOpen = PlaybackSpeedMenuDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// Cycles to the next-fastest speed (web `onClick` → `onChange(nextSpeed(speed))`).
    public func cycleForward(from speed: ReplaySpeed) {
        onChange(PlaybackSpeedMenuLogic.nextSpeed(speed))
    }

    /// Steps one speed slower (web `onContextMenu` → `onChange(shiftSpeed(speed, -1))`).
    public func cycleBackward(from speed: ReplaySpeed) {
        onChange(PlaybackSpeedMenuLogic.shiftSpeed(speed, by: -1))
    }

    /// Selects an exact speed — the native menu pick (current row checkmarked in the view).
    public func select(_ speed: ReplaySpeed) {
        onChange(speed)
    }
}

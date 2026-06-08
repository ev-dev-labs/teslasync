//
//  AutopilotSection.Models.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  The Foundation-only value types for the driving-dynamics "Autopilot & Cruise" section: the inbound
//  DTO (the web `state.speed` + the two `signals/observations` reads), the user's speed-unit
//  preference, the injected pre-localized copy, and the phase / status / connection enums. Free of
//  SwiftUI so the projection logic compiles and unit-tests on a plain host. Parity target:
//  features/driving/components/driving-dynamics/AutopilotSection.tsx.
//

import Foundation

// MARK: - Inbound DTO (web `state.speed` + CruiseSetSpeed / CruiseFollowDistance observations)

/// The three values the web `AutopilotSection` reads, each independently optional so the surface can
/// show any subset (the web renders the em-dash sentinel for the missing ones). All speeds are SI
/// metres-per-second — the canonical unit the Tesla pipeline stores both `VehicleSpeed` and
/// `CruiseSetSpeed` in (internal/tesla/units), converted to the display unit only at render.
public struct AutopilotInput: Sendable, Equatable {
    /// Current vehicle speed in SI m/s (web `stateData.state.speed`), or `nil` when unknown.
    public var speedMetersPerSecond: Double?
    /// Cruise set-speed in SI m/s (web `latestNumeric(cruiseSetObs)`), or `nil` when unknown.
    public var cruiseSetMetersPerSecond: Double?
    /// Raw `CruiseFollowDistance` enum text (web `latestText(followObs)`), e.g. "FollowDistance7", or
    /// the stringified numeric fallback, or `nil` when no observation exists.
    public var followDistanceRaw: String?

    public init(
        speedMetersPerSecond: Double? = nil,
        cruiseSetMetersPerSecond: Double? = nil,
        followDistanceRaw: String? = nil
    ) {
        self.speedMetersPerSecond = speedMetersPerSecond
        self.cruiseSetMetersPerSecond = cruiseSetMetersPerSecond
        self.followDistanceRaw = followDistanceRaw
    }
}

// MARK: - Display-unit preference (web `useUnits().unitPrefs.speed`)

/// The speed-unit preference the surface needs (web `useUnits().unitPrefs.speed`), stored as the SI
/// label string the shared enums round-trip through (`"mph"`, `"km/h"`), plus the optional locale used
/// for grouped number formatting (web `fmtNumber` default `en-US`).
public struct AutopilotUnitPrefs: Sendable, Equatable {
    /// The display speed unit label (web `unitPrefs.speed`) — used both for conversion and as the
    /// unit caption shown beside each speed value.
    public var speed: String
    /// Locale identifier for `fmtNumber` grouping (web `fmtNumber` locale), or `nil` for `en-US`.
    public var locale: String?

    public init(speed: String = "km/h", locale: String? = nil) {
        self.speed = speed
        self.locale = locale
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs: the three stat labels the web reads via `t()`, plus
/// the em-dash sentinel the web embeds inline (`'—'`). Injected so the projection stays Foundation-only
/// and host-testable (the view resolves the real catalog copy through the P1/S10 facade).
public struct AutopilotCopy: Sendable, Equatable {
    /// Web `t('dynamics.currentSpeed', 'Current Speed')`.
    public var currentSpeedLabel: String
    /// Web `t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')`.
    public var cruiseSetSpeedLabel: String
    /// Web `t('dynamics.followDistance', 'Follow Distance')`.
    public var followDistanceLabel: String
    /// The em-dash shown for an absent value (web `'—'`).
    public var emDash: String

    public init(
        currentSpeedLabel: String = "Current Speed",
        cruiseSetSpeedLabel: String = "Cruise Set Speed",
        followDistanceLabel: String = "Follow Distance",
        emDash: String = "—"
    ) {
        self.currentSpeedLabel = currentSpeedLabel
        self.cruiseSetSpeedLabel = cruiseSetSpeedLabel
        self.followDistanceLabel = followDistanceLabel
        self.emDash = emDash
    }

    /// English fallbacks (matching the web source literals) — used by previews + tests.
    public static let fallback = AutopilotCopy()
}

// MARK: - Render phase (load envelope around the web content/empty split)

/// What the surface should render. The web `AutopilotSection` is a pure presentational component that
/// renders the stat grid or its empty state; the native surface widens that to the full load envelope
/// so every prompt-required state (loading / empty / error) renders here, with `stale` / `offline`
/// carried separately on the connection.
public enum AutopilotPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web parent `isLoading` / resolved / failure).
public enum AutopilotLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so cached
/// values are clearly labelled while reconnecting / offline. The web reads `state` on a 5s
/// `refetchInterval`, so a stalled stream is surfaced rather than silently shown as current.
public enum AutopilotConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

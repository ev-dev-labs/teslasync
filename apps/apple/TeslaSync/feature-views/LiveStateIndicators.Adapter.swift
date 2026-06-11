//
//  LiveStateIndicators.Adapter.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  The testable projection core for the live state indicators — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx. Pure +
//  dependency-free (no store, no bundle, no rendered view, no KMP `Shared`), so the
//  per-badge value + tone branches and the SI speed formatting (via the sibling
//  `LiveStateIndicators.Format.swift`) are unit tested in isolation.
//
//  Parity notes (presentational leaf — formats verbatim, never rescales upstream). The
//  web renders five `Badge variant dot size="lg"` chips in a `flex flex-wrap gap-2`:
//    • Speed   — `{t('common.speed')}: {formatSpeed(state.speed, { precision: 0 })}`,
//                variant `state.speed > 0 ? 'success' : 'neutral'`.
//    • Lock    — `state.is_locked ? t('common.locked') : t('common.unlocked')`,
//                variant `state.is_locked ? 'success' : 'danger'`.
//    • Sentry  — `{t('common.sentry')}: {state.sentry_mode ? t('common.active')
//                : t('common.off')}`, variant `state.sentry_mode ? 'warning' : 'neutral'`.
//    • Climate — `{t('common.climate')}: {state.is_climate_on ? t('common.on')
//                : t('common.off')}`, variant `state.is_climate_on ? 'info' : 'neutral'`.
//    • Charging — `state.is_charging ? t('common.charging') : t('common.notCharging')`,
//                variant `state.is_charging ? 'warning' : 'neutral'`.
//
//  i18n words (Speed/Locked/Unlocked/Sentry/Active/Off/Climate/On/Charging/Not Charging)
//  are carried as keys+fallbacks via `LiveStateValue.localized` and resolved by the view
//  through the P1/S10 facade, so this core holds no rendered prose. The locale-formatted
//  speed is carried as `LiveStateValue.literal`.
//

import Foundation

// MARK: - Reading (the `VehicleState` fields the indicators consume)

/// The live-state fields the indicators render — the native mirror of the web
/// `state: VehicleState` props the component reads. `speedMetersPerSecond` is SI m/s
/// (web `state.speed`, fed straight to `formatSpeed`); the booleans are the web
/// truthiness reads (`state.is_locked` / `state.sentry_mode` / `state.is_climate_on` /
/// `state.is_charging`). Every field is defaulted so an absent signal is the resting
/// (neutral/false) state, matching the web object contract.
public struct LiveStateReading: Equatable, Sendable {
    /// Current speed in m/s, SI (web `state.speed`).
    public var speedMetersPerSecond: Double
    /// Doors locked (web `state.is_locked`).
    public var isLocked: Bool
    /// Sentry Mode armed (web `state.sentry_mode`).
    public var sentryMode: Bool
    /// Climate/HVAC running (web `state.is_climate_on`).
    public var isClimateOn: Bool
    /// Actively charging (web `state.is_charging`).
    public var isCharging: Bool

    public init(
        speedMetersPerSecond: Double = 0,
        isLocked: Bool = false,
        sentryMode: Bool = false,
        isClimateOn: Bool = false,
        isCharging: Bool = false
    ) {
        self.speedMetersPerSecond = speedMetersPerSecond
        self.isLocked = isLocked
        self.sentryMode = sentryMode
        self.isClimateOn = isClimateOn
        self.isCharging = isCharging
    }

    /// The web `state.speed > 0` "moving" branch that drives the speed badge's success
    /// tone. Non-finite speeds are treated as not moving.
    public var isMoving: Bool {
        speedMetersPerSecond.isFinite && speedMetersPerSecond > 0
    }
}

// MARK: - Indicator value (literal vs localized) — keeps the core free of rendered prose

/// One badge part's display value. `localized` carries an i18n key + web English
/// fallback the view resolves through the P1/S10 facade (the web `t(key, default)`
/// words); `literal` is a pre-formatted string shown verbatim (the locale-formatted
/// speed or the em-dash sentinel).
public enum LiveStateValue: Equatable, Sendable {
    case localized(key: String, fallback: String)
    case literal(String)

    static let speedLabel = LiveStateValue.localized(key: "common.speed", fallback: "Speed")
    static let locked = LiveStateValue.localized(key: "common.locked", fallback: "Locked")
    static let unlocked = LiveStateValue.localized(key: "common.unlocked", fallback: "Unlocked")
    static let sentryLabel = LiveStateValue.localized(key: "common.sentry", fallback: "Sentry")
    static let active = LiveStateValue.localized(key: "common.active", fallback: "Active")
    static let off = LiveStateValue.localized(key: "common.off", fallback: "Off")
    static let climateLabel = LiveStateValue.localized(key: "common.climate", fallback: "Climate")
    static let on = LiveStateValue.localized(key: "common.on", fallback: "On")
    static let charging = LiveStateValue.localized(key: "common.charging", fallback: "Charging")
    static let notCharging = LiveStateValue.localized(key: "common.notCharging", fallback: "Not Charging")
}

// MARK: - Indicator tone (web Badge `variant` → semantic token, resolved in the view)

/// The accent of an indicator badge — the native mirror of the web `Badge variant`
/// prop, mapped to a semantic design token in the view (ADR-006 semantic, not literal):
/// `success` (web `success`/green), `danger` (web `danger`/red), `warning` (web
/// `warning`/amber), `info` (web `info`/blue), `neutral` (web `neutral`/gray).
public enum LiveStateTone: String, Sendable, Equatable, CaseIterable {
    case success
    case danger
    case warning
    case info
    case neutral
}

// MARK: - Indicator kind (stable identity per badge, web source order)

/// The five indicators the surface renders, in web source order. Drives `Identifiable`
/// for the flow layout and pins the ordering in tests.
public enum LiveStateIndicatorKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case speed
    case lock
    case sentry
    case climate
    case charging

    public var id: String {
        rawValue
    }
}

// MARK: - Indicator (kind + optional prefix + value + tone)

/// One resolved indicator badge — the kind (identity), an optional localized prefix
/// (web `{t('common.speed')}: …`), the display value, and the accent tone. The view is
/// a pure function of an ordered list of these.
public struct LiveStateIndicator: Equatable, Sendable, Identifiable {
    public let kind: LiveStateIndicatorKind
    public let prefix: LiveStateValue?
    public let value: LiveStateValue
    public let tone: LiveStateTone

    public var id: String {
        kind.rawValue
    }

    public init(
        kind: LiveStateIndicatorKind,
        prefix: LiveStateValue?,
        value: LiveStateValue,
        tone: LiveStateTone
    ) {
        self.kind = kind
        self.prefix = prefix
        self.value = value
        self.tone = tone
    }
}

// MARK: - Projection (web render values: the five badges)

/// The resolved, view-ready badges for one reading — the native mirror of the web
/// component's five `Badge` chips. Every badge's value + tone is pre-computed so the
/// view is a pure function of this projection.
public struct LiveStateProjection: Equatable, Sendable {
    public let indicators: [LiveStateIndicator]

    public init(indicators: [LiveStateIndicator]) {
        self.indicators = indicators
    }

    /// Builds the display projection from a reading + the user's unit preferences — the
    /// native port of the web component's per-badge value/variant branches, in source
    /// order (Speed, Lock, Sentry, Climate, Charging).
    public static func make(reading: LiveStateReading, units: LiveStateUnits) -> LiveStateProjection {
        LiveStateProjection(indicators: [
            LiveStateIndicator(
                kind: .speed,
                prefix: .speedLabel,
                value: .literal(LiveStateFormat.speed(metersPerSecond: reading.speedMetersPerSecond, units: units)),
                tone: reading.isMoving ? .success : .neutral
            ),
            LiveStateIndicator(
                kind: .lock,
                prefix: nil,
                value: reading.isLocked ? .locked : .unlocked,
                tone: reading.isLocked ? .success : .danger
            ),
            LiveStateIndicator(
                kind: .sentry,
                prefix: .sentryLabel,
                value: reading.sentryMode ? .active : .off,
                tone: reading.sentryMode ? .warning : .neutral
            ),
            LiveStateIndicator(
                kind: .climate,
                prefix: .climateLabel,
                value: reading.isClimateOn ? .on : .off,
                tone: reading.isClimateOn ? .info : .neutral
            ),
            LiveStateIndicator(
                kind: .charging,
                prefix: nil,
                value: reading.isCharging ? .charging : .notCharging,
                tone: reading.isCharging ? .warning : .neutral
            )
        ])
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the spoken/visible badge text from already-localized parts, so the composition
/// is asserted without rendering the view. The visible label and the VoiceOver label are
/// identical for these static (non-interactive) chips, so both flow through here.
public enum LiveStateIndicatorsAccessibility {
    /// One badge's composed text: "{prefix}: {value}" when a prefix is present (web
    /// `{t('common.speed')}: {value}`), else the bare value (web single-word chips).
    public static func badgeLabel(prefix: String?, value: String) -> String {
        guard let prefix, !prefix.isEmpty else { return value }
        return "\(prefix): \(value)"
    }
}

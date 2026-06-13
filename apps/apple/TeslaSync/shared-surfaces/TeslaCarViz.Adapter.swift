//
//  TeslaCarViz.Adapter.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The Foundation-only props → projection adapter for the live vehicle illustration — the SwiftUI parity of
//  `components/data-display/TeslaCarViz.tsx`. It owns the props value type (``TeslaCarVizInput``), the
//  ambient-glow mood, the status-row model, the view-ready ``TeslaCarVizProjection``, and the pure
//  ``TeslaCarVizProjector`` that resolves them. No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation. The static catalog (model / layout / size / battery band) lives in
//  TeslaCarViz.Catalog.swift; this file is the "state → projection" half the acceptance calls for.
//
//  Faithful-parity note: the web `<TeslaCarViz>` is a PURE presentational primitive. It takes its data as
//  plain props (`batteryLevel`, `isCharging`, `isLocked`, `isClimateOn`, `sentryMode`, `speed`, plus the
//  `size` / `model` styling) and renders an animated SVG car — there is no fetch, no React-Query cache, and
//  no Promise, so it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age,
//  or lose connectivity to; the hosting page owns those data states and feeds this surface resolved values).
//  Inventing such chrome would fabricate states the source does not have, so this surface reproduces only the
//  source's REAL branches — exactly as the sibling presentational primitives Accordion (0203), Delta (0081),
//  and MetricCard (0095) did. The real branches: the five model bodies, the three sizes, parked vs driving
//  (the web `speed > 0`), charging on/off, locked vs unlocked, climate on/off, sentry on/off, the three
//  battery bands, and the four ambient-glow moods.
//

import Foundation

// MARK: - Ambient mood (web ambient-glow selector)

/// The mood of the soft glow behind the car — the native peer of the web ambient selector `sentryMode ?
/// sentry : isCharging ? charging : driving ? driving : idle`. The precedence is significant: sentry wins
/// over charging wins over driving wins over idle.
public enum TeslaCarVizAmbientMode: String, Sendable, Equatable {
    case sentry
    case charging
    case driving
    case idle
}

// MARK: - Status-row roles (web status dots)

/// The semantic role of a status dot beneath the car — maps to a theme-stable semantic token in the view
/// (`success` stays green, `info` stays cyan, `danger` stays red) so the meaning survives every theme.
public enum TeslaCarVizStatusRole: String, Sendable, Equatable {
    case success
    case info
    case danger
}

/// One status dot beneath the car — the native peer of the web `<StatusDot active color label>`: a coloured
/// dot (or a muted dot when inactive) and a localized label. `labelKey` resolves through the P1/S10 facade.
public struct TeslaCarVizStatusDot: Sendable, Equatable, Identifiable {
    public let id: String
    /// Whether the dot is lit (web `active` — drives the dot colour + glow vs the muted resting state).
    public let active: Bool
    /// The semantic role used to pick the lit colour token.
    public let role: TeslaCarVizStatusRole
    /// The P1/S10 localization key for the label (the web literal label, lifted to a catalog key).
    public let labelKey: String
    /// The English fallback for the label, kept beside the key so the facade is deterministic in test bundles.
    public let labelFallback: String

    public init(
        id: String,
        active: Bool,
        role: TeslaCarVizStatusRole,
        labelKey: String,
        labelFallback: String
    ) {
        self.id = id
        self.active = active
        self.role = role
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }
}

// MARK: - TeslaCarVizInput (web props, closure-free)

/// The component's props — the native peer of `TeslaCarVizProps`. A value type so the view, the state-holder,
/// and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply
/// when the host rebinds (e.g. a new live battery level streams in).
public struct TeslaCarVizInput: Sendable, Equatable {
    /// The state of charge, 0…100 (web `batteryLevel`).
    public let batteryLevel: Double
    /// Whether a charge session is active (web `isCharging`).
    public let isCharging: Bool
    /// Whether the vehicle is locked (web `isLocked`).
    public let isLocked: Bool
    /// Whether climate / pre-conditioning is running (web `isClimateOn`).
    public let isClimateOn: Bool
    /// Whether Sentry Mode is armed (web `sentryMode`).
    public let sentryMode: Bool
    /// The current speed in the host's units — only its sign matters here (web `speed`; `speed > 0` ⇒
    /// driving). The illustration is unit-agnostic; the host formats any spoken speed.
    public let speed: Double
    /// The render size preset (web `size`).
    public let size: TeslaCarVizSize
    /// The model variant (web `model`).
    public let model: TeslaCarModel

    public init(
        batteryLevel: Double,
        isCharging: Bool = false,
        isLocked: Bool = false,
        isClimateOn: Bool = false,
        sentryMode: Bool = false,
        speed: Double = 0,
        size: TeslaCarVizSize = .md,
        model: TeslaCarModel = .model3
    ) {
        self.batteryLevel = batteryLevel
        self.isCharging = isCharging
        self.isLocked = isLocked
        self.isClimateOn = isClimateOn
        self.sentryMode = sentryMode
        self.speed = speed
        self.size = size
        self.model = model
    }
}

// MARK: - TeslaCarVizProjection (view-ready)

/// The resolved, view-ready illustration — everything the SwiftUI body needs as a pure function of the props
/// (no derivation in the view). It carries the resolved geometry (frame size + the design-space layout), the
/// battery band + fraction + percent, the boolean decoration flags, the ambient mood, and the status row.
public struct TeslaCarVizProjection: Sendable, Equatable {
    public let model: TeslaCarModel
    public let layout: TeslaCarLayout
    /// The rendered frame width in points (web `w`).
    public let width: Double
    /// The rendered frame height in points (web `h = w * aspect`).
    public let height: Double
    /// Whether the vehicle is moving (web `driving = speed > 0`) — gates the rolling wheels, the lit
    /// headlight + beam, the speed lines, and the driving ambient.
    public let isDriving: Bool
    public let isCharging: Bool
    public let isLocked: Bool
    public let isClimateOn: Bool
    public let sentryMode: Bool
    public let batteryBand: TeslaCarVizBatteryBand
    /// The battery bar fill fraction, clamped 0…1 (web `(batteryLevel / 100) * 260` width).
    public let batteryFraction: Double
    /// The battery percentage shown in the bar label + the accessibility value (web `{batteryLevel}%`).
    public let batteryPercent: Int
    public let ambientMode: TeslaCarVizAmbientMode
    /// The status row beneath the car (web status dots), in render order.
    public let statusDots: [TeslaCarVizStatusDot]

    public init(
        model: TeslaCarModel,
        layout: TeslaCarLayout,
        width: Double,
        height: Double,
        isDriving: Bool,
        isCharging: Bool,
        isLocked: Bool,
        isClimateOn: Bool,
        sentryMode: Bool,
        batteryBand: TeslaCarVizBatteryBand,
        batteryFraction: Double,
        batteryPercent: Int,
        ambientMode: TeslaCarVizAmbientMode,
        statusDots: [TeslaCarVizStatusDot]
    ) {
        self.model = model
        self.layout = layout
        self.width = width
        self.height = height
        self.isDriving = isDriving
        self.isCharging = isCharging
        self.isLocked = isLocked
        self.isClimateOn = isClimateOn
        self.sentryMode = sentryMode
        self.batteryBand = batteryBand
        self.batteryFraction = batteryFraction
        self.batteryPercent = batteryPercent
        self.ambientMode = ambientMode
        self.statusDots = statusDots
    }
}

// MARK: - TeslaCarVizProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the "state →
/// projection" sense the acceptance calls for: it takes the props the host already holds (no fetch, no clock)
/// and derives the rendered illustration. Unit tested across the size→frame mapping, the battery band +
/// clamping, the driving flag, the ambient precedence, and the status-row composition.
public enum TeslaCarVizProjector {
    public static let chargingDotID = "charging"
    public static let lockDotID = "lock"
    public static let climateDotID = "climate"
    public static let sentryDotID = "sentry"

    /// The vehicle is driving when its speed is strictly positive (web `speed > 0`).
    public static func isDriving(speed: Double) -> Bool {
        speed > 0
    }

    /// Clamps a 0…100 charge level to a 0…1 bar fraction (the web bar width `(level / 100) * 260`, bounded).
    public static func batteryFraction(level: Double) -> Double {
        min(max(level / 100, 0), 1)
    }

    /// The integer percentage shown in the bar + spoken as the accessibility value, clamped to 0…100.
    public static func batteryPercent(level: Double) -> Int {
        Int(min(max(level, 0), 100).rounded())
    }

    /// The ambient mood — the verbatim port of the web precedence `sentry > charging > driving > idle`.
    public static func ambientMode(
        sentryMode: Bool,
        isCharging: Bool,
        isDriving: Bool
    ) -> TeslaCarVizAmbientMode {
        if sentryMode { return .sentry }
        if isCharging { return .charging }
        if isDriving { return .driving }
        return .idle
    }

    /// The status row beneath the car — the native peer of the web dots. Charging + Lock always render (lit
    /// when active, muted otherwise); Climate + Sentry render only when on (the web `{isClimateOn && …}` /
    /// `{sentryMode && …}`). The lock dot is lit-green when locked (web `boolColor(true)`) and muted when
    /// unlocked (the web inactive-dot tint overrides `boolColor(false)`'s amber).
    public static func statusDots(
        isCharging: Bool,
        isLocked: Bool,
        isClimateOn: Bool,
        sentryMode: Bool
    ) -> [TeslaCarVizStatusDot] {
        var dots: [TeslaCarVizStatusDot] = [
            TeslaCarVizStatusDot(
                id: chargingDotID,
                active: isCharging,
                role: .success,
                labelKey: isCharging ? "teslaCarViz.status.charging" : "teslaCarViz.status.notCharging",
                labelFallback: isCharging ? "Charging" : "Not Charging"
            ),
            TeslaCarVizStatusDot(
                id: lockDotID,
                active: isLocked,
                role: .success,
                labelKey: isLocked ? "teslaCarViz.status.locked" : "teslaCarViz.status.unlocked",
                labelFallback: isLocked ? "Locked" : "Unlocked"
            )
        ]
        if isClimateOn {
            dots.append(TeslaCarVizStatusDot(
                id: climateDotID,
                active: true,
                role: .info,
                labelKey: "teslaCarViz.status.climate",
                labelFallback: "Climate"
            ))
        }
        if sentryMode {
            dots.append(TeslaCarVizStatusDot(
                id: sentryDotID,
                active: true,
                role: .danger,
                labelKey: "teslaCarViz.status.sentry",
                labelFallback: "Sentry"
            ))
        }
        return dots
    }

    /// Resolves the whole illustration from the props — the native peer of the web component's render.
    public static func resolve(input: TeslaCarVizInput) -> TeslaCarVizProjection {
        let driving = isDriving(speed: input.speed)
        let width = input.size.width
        let height = width * input.model.aspectRatio
        return TeslaCarVizProjection(
            model: input.model,
            layout: TeslaCarLayout.layout(for: input.model),
            width: width,
            height: height,
            isDriving: driving,
            isCharging: input.isCharging,
            isLocked: input.isLocked,
            isClimateOn: input.isClimateOn,
            sentryMode: input.sentryMode,
            batteryBand: TeslaCarVizBatteryBand.forLevel(input.batteryLevel),
            batteryFraction: batteryFraction(level: input.batteryLevel),
            batteryPercent: batteryPercent(level: input.batteryLevel),
            ambientMode: ambientMode(
                sentryMode: input.sentryMode,
                isCharging: input.isCharging,
                isDriving: driving
            ),
            statusDots: statusDots(
                isCharging: input.isCharging,
                isLocked: input.isLocked,
                isClimateOn: input.isClimateOn,
                sentryMode: input.sentryMode
            )
        )
    }
}

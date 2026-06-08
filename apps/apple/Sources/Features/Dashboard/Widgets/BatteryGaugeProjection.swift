import Foundation

// Pure, KMP-free display model for the BatteryRadialGauge dashboard widget —
// the testable core of `web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx`.
// No SwiftUI and no shared-core types, so every value and visual branch is
// constructible (and unit-tested) from primitives.

// MARK: - Color band

/// Battery charge bands matching the web `getBatteryColor` thresholds.
public enum BatteryGaugeBand: Equatable, Sendable {
    /// `> 50%` — green.
    case high
    /// `> 20%` — amber.
    case medium
    /// `≤ 20%` — red.
    case low
    /// No vehicle state available yet — neutral.
    case unknown

    /// The band for [level], or [unknown] when no vehicle state is present
    /// (the web `state ? getBatteryColor(level) : '#374151'` branch).
    public static func forLevel(_ level: Double, hasState: Bool) -> BatteryGaugeBand {
        guard hasState else { return .unknown }
        if level > 50 { return .high }
        if level > 20 { return .medium }
        return .low
    }
}

// MARK: - Stat row item

/// One supporting stat beneath the gauge (web `GaugeHeroStat`). [labelKey] is a
/// localization-catalog key; [value]/[unit] are caller-formatted display strings.
public struct BatteryGaugeStat: Equatable, Identifiable, Sendable {
    public let id: String
    public let labelKey: String
    public let value: String
    public let unit: String

    public init(id: String, labelKey: String, value: String, unit: String) {
        self.id = id
        self.labelKey = labelKey
        self.value = value
        self.unit = unit
    }
}

// MARK: - Projection

/// Pure display model derived from a vehicle's last-known state. Mirrors the web
/// component's data derivation: clamped level, color band, optional charge-limit
/// overlay, charging flag, and the stat list shown on expanded tiles.
public struct BatteryGaugeProjection: Equatable, Sendable {
    public let batteryLevel: Double
    public let chargeLimitSoc: Double?
    public let isCharging: Bool

    public init(batteryLevel: Double, chargeLimitSoc: Double?, isCharging: Bool) {
        self.batteryLevel = batteryLevel
        self.chargeLimitSoc = chargeLimitSoc
        self.isCharging = isCharging
    }

    /// Battery level clamped to the gauge's 0…100 domain.
    public var clampedLevel: Double {
        min(max(batteryLevel, 0), 100)
    }

    /// Color band for the gauge arc.
    public var band: BatteryGaugeBand {
        .forLevel(batteryLevel, hasState: true)
    }

    /// Integer percentage for display + accessibility value.
    public var levelPercent: Int {
        Int(clampedLevel.rounded())
    }

    /// Whether the thin charge-limit ring overlay is shown (web `ChargeLimitRing`).
    public var showsChargeLimit: Bool {
        chargeLimitSoc != nil
    }

    /// Charge-limit position as a 0…1 fraction for the overlay ring.
    public var chargeLimitFraction: Double {
        guard let soc = chargeLimitSoc else { return 0 }
        return min(max(soc, 0), 100) / 100
    }

    /// Supporting stats shown on expanded tiles (web `stats` memo): Level always,
    /// Limit only when a charge-limit SOC is present.
    public var stats: [BatteryGaugeStat] {
        var result = [
            BatteryGaugeStat(
                id: "level",
                labelKey: "translation.widget.level",
                value: "\(levelPercent)",
                unit: "%"
            )
        ]
        if let soc = chargeLimitSoc {
            let limit = Int(min(max(soc, 0), 100).rounded())
            result.append(
                BatteryGaugeStat(
                    id: "limit",
                    labelKey: "translation.widget.chargeLimit",
                    value: "\(limit)",
                    unit: "%"
                )
            )
        }
        return result
    }
}

// MARK: - Load error classification

/// A KMP-free classification of a load failure, so render-state derivation stays
/// testable without constructing a `FacadeError`/KMP throwable. The model maps a
/// `FacadeError` into this; `offline` drives the offline chip + cached fallback.
public enum BatteryGaugeLoadError: Equatable, Sendable {
    case offline
    case retryable
    case fatal

    /// Whether a retry could plausibly succeed (drives the retry affordance).
    public var isRetryable: Bool {
        self != .fatal
    }
}

// MARK: - Render state

/// The fully-resolved render input for `BatteryRadialGaugeContent`. The model
/// produces it from a `LoadableState`, but it is free of any KMP type so every
/// visual branch is constructible — and testable — from primitives.
public struct BatteryRadialGaugeRenderState: Equatable, Sendable {
    /// The mutually-exclusive top-level branches.
    public enum Phase: Equatable, Sendable {
        /// First load with nothing cached yet → full-tile skeleton.
        case loading
        /// Load failed with no value to show → QueryError-equivalent + retry.
        case failure(retryable: Bool)
        /// A reading resolved; body shows the gauge, or the empty state when the
        /// vehicle reported no decodable state.
        case content
    }

    public let phase: Phase
    public let projection: BatteryGaugeProjection?
    public let isStale: Bool
    public let isOffline: Bool
    public let isFetching: Bool

    public init(
        phase: Phase,
        projection: BatteryGaugeProjection?,
        isStale: Bool,
        isOffline: Bool,
        isFetching: Bool
    ) {
        self.phase = phase
        self.projection = projection
        self.isStale = isStale
        self.isOffline = isOffline
        self.isFetching = isFetching
    }

    /// Derives the render state from the resolved loadable flags (pure). Mirrors
    /// the web precedence: a first load (no cached value) shows the skeleton; a
    /// failure with nothing cached shows the retryable error surface; everything
    /// else shows the body (gauge when a projection exists, else the empty state).
    public static func resolve(
        projection: BatteryGaugeProjection?,
        isLoading: Bool,
        error: BatteryGaugeLoadError?,
        isStale: Bool,
        isFetching: Bool
    ) -> BatteryRadialGaugeRenderState {
        let offline = error == .offline
        let phase: Phase = if projection == nil, isLoading {
            .loading
        } else if projection == nil, let error {
            .failure(retryable: error.isRetryable)
        } else {
            .content
        }
        return BatteryRadialGaugeRenderState(
            phase: phase,
            projection: projection,
            isStale: isStale,
            isOffline: offline,
            isFetching: isFetching
        )
    }
}

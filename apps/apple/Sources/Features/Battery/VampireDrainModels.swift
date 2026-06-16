import Foundation

// Value types + pure derivations for the Vampire Drain surface (web `VampireDrainPage.tsx`,
// route `/charging/vampire-drain`). Phantom-loss percentages, %/hr drain rates, parked
// hours, and kWh energy are unit-system-independent, so they format at the SwiftUI render
// boundary directly (ADR-005). Field names mirror the snake_case wire (`drain_rate_pct_hr`,
// `energy_lost_kwh`, `hours_parked`) so the production KMP-backed data source maps straight
// across. Every value the web page derives inline (the Loss% badge band, the score colour
// band + gauge fraction, the per-section "has data" guards, the session count) lives here as
// a pure, unit-tested function — never recomputed in the view.

// MARK: - Drain session (web `VampireDrainEntry`)

/// One recorded parked vampire-drain session (web `VampireDrainEntry`). `date` is the raw
/// wire timestamp; battery levels / drain are raw percents, `drainRatePctHr` is %/hr,
/// `durationHours` is hours, `energyLostKwh` is kWh.
public struct VampireDrainSession: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let date: String
    public let startBattery: Double
    public let endBattery: Double
    public let drainPct: Double
    public let drainRatePctHr: Double
    public let durationHours: Double
    public let energyLostKwh: Double
    public let sentryActive: Bool

    public init(
        id: Int64,
        date: String,
        startBattery: Double,
        endBattery: Double,
        drainPct: Double,
        drainRatePctHr: Double,
        durationHours: Double,
        energyLostKwh: Double,
        sentryActive: Bool
    ) {
        self.id = id
        self.date = date
        self.startBattery = startBattery
        self.endBattery = endBattery
        self.drainPct = drainPct
        self.drainRatePctHr = drainRatePctHr
        self.durationHours = durationHours
        self.energyLostKwh = energyLostKwh
        self.sentryActive = sentryActive
    }

    /// Web `drain_pct > 5 ? 'danger' : drain_pct > 2 ? 'warning' : 'success'` — the Loss%
    /// badge band shown in the sessions table.
    public var drainSeverity: BatterySeverity {
        if drainPct > 5 { return .danger }
        if drainPct > 2 { return .warning }
        return .success
    }
}

// MARK: - Daily drain bucket (web `daily[]`)

/// One day of parked drain (web `daily` entry): the day's total drain percent and the
/// hours the vehicle spent parked. Drives the Daily-Drain grouped bar chart.
public struct VampireDrainDay: Identifiable, Hashable, Sendable {
    public let date: String
    public let drainPct: Double
    public let hoursParked: Double

    public var id: String { date }

    public init(date: String, drainPct: Double, hoursParked: Double) {
        self.date = date
        self.drainPct = drainPct
        self.hoursParked = hoursParked
    }
}

// MARK: - Vampire drain snapshot (web `VampireDrainStats` → /vampire-drain/stats)

/// The per-vehicle vampire-drain snapshot (web `useQuery` `data`). Its presence drives the
/// page's loading / empty / error / success phases. Holds the four summary scalars (avg
/// drain rate, total phantom loss, worst session, drain score), the recorded sessions, and
/// the daily buckets, plus the pure derivations the web computes inline.
public struct VampireDrainData: Hashable, Sendable {
    public let avgDrainRate: Double
    public let totalEnergyLost: Double
    public let worstDrainPct: Double
    public let drainScore: Double
    public let entries: [VampireDrainSession]
    public let daily: [VampireDrainDay]

    public init(
        avgDrainRate: Double,
        totalEnergyLost: Double,
        worstDrainPct: Double,
        drainScore: Double,
        entries: [VampireDrainSession],
        daily: [VampireDrainDay]
    ) {
        self.avgDrainRate = avgDrainRate
        self.totalEnergyLost = totalEnergyLost
        self.worstDrainPct = worstDrainPct
        self.drainScore = drainScore
        self.entries = entries
        self.daily = daily
    }

    /// Web `RadialGauge value={Math.round(drain_score)} max={100}` — the gauge's 0…1
    /// fraction (the native gauge renders the rounded percent inside).
    public var scoreFraction: Double {
        min(max(drainScore / 100, 0), 1)
    }

    /// Web `scoreColor`: `drain_score >= 80 ? CHART_COLORS[1] : >= 50 ? CHART_COLORS[3] :
    /// CHART_COLORS[5]` — the gauge tint, mapped onto the shared chart palette index.
    public var scoreColorIndex: Int {
        if drainScore >= 80 { return 1 }
        if drainScore >= 50 { return 3 }
        return 5
    }

    /// Web `data?.entries && data.entries.length > 0` — whether the trend line + the
    /// sessions table have rows (else each renders its own empty state).
    public var hasEntries: Bool {
        !entries.isEmpty
    }

    /// Web `data?.daily && data.daily.length > 0` — whether the daily bar chart has bars.
    public var hasDaily: Bool {
        !daily.isEmpty
    }

    /// Web `data?.entries?.length ?? 0` — the count shown in the sessions-panel badge.
    public var sessionCount: Int {
        entries.count
    }
}

// MARK: - Recommendation tip (web `tips` useMemo)

/// One vampire-drain reduction tip (web `tips` entry): an SF Symbol glyph (the web Lucide
/// icon) plus the localized advice. The four tips are static copy, ported verbatim from the
/// web string keys.
public struct VampireDrainTip: Identifiable, Hashable, Sendable {
    public let id: Int
    public let systemImage: String
    public let textKey: String

    public init(id: Int, systemImage: String, textKey: String) {
        self.id = id
        self.systemImage = systemImage
        self.textKey = textKey
    }

    /// The four tips the web page lists, in order (icon ← web Lucide glyph; text ← web key).
    public static let all: [VampireDrainTip] = [
        VampireDrainTip(
            id: 0,
            systemImage: "exclamationmark.shield.fill",
            textKey: "Disable Sentry Mode when parked at home to save 1–2 % per day."
        ),
        VampireDrainTip(
            id: 1,
            systemImage: "clock.fill",
            textKey: "Reduce third-party app polling intervals to let the car sleep faster."
        ),
        VampireDrainTip(
            id: 2,
            systemImage: "minus.plus.batteryblock.fill",
            textKey: "Avoid opening the app frequently — each wake cycle costs battery."
        ),
        VampireDrainTip(
            id: 3,
            systemImage: "waveform.path.ecg",
            textKey: "Enable energy-saving mode in vehicle settings for better standby."
        )
    ]
}

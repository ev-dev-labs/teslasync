import Foundation

// Value types + pure derivations for the Sleep Efficiency surface (web
// `SleepEfficiencyPage.tsx`, route `/sleep-efficiency`). Every measurement stays SI
// exactly as the `/analytics/sleep` handler serves it — efficiency / drain rates /
// battery-lost are raw percents, `outside_temp` is SI Celsius, energy is kWh, cost is a
// currency amount — and the user's unit / currency preference is applied only at the
// SwiftUI render boundary (ADR-005). Field names mirror the snake_case wire
// (`sleep_efficiency_pct`, `sentry_on_drain_rate`, `state_distribution`) so the
// production KMP-backed data source maps straight across. Every derivation the web page
// computes with `useMemo` (the donut slices, the sentry comparison bars, the on/off
// lookups, the per-section "has data" guards) lives here as a pure, unit-tested function.

// MARK: - State distribution slice (web `state_distribution[]` → `pieData`)

/// One vehicle-state share of parked time (web `state_distribution` entry). `state` is
/// the raw wire key (`asleep` / `online` / …); `totalMinutes` is its dwell time. The
/// donut renders `roundedMinutes`, the legend renders `hours`.
public struct SleepStateShare: Identifiable, Hashable, Sendable {
    public let state: String
    public let totalMinutes: Double

    public var id: String { state }

    public init(state: String, totalMinutes: Double) {
        self.state = state
        self.totalMinutes = totalMinutes
    }

    /// Web `Math.round(s.total_minutes)` — the donut slice value.
    public var roundedMinutes: Double {
        totalMinutes.rounded()
    }

    /// Web `s.total_minutes / 60` — the per-state hours shown in the legend.
    public var hours: Double {
        totalMinutes / 60
    }
}

// MARK: - Sentry comparison (web `sentry_comparison[]`)

/// One Sentry-on/off drain comparison bucket (web `sentry_comparison` entry). Drain rate
/// is %/hr, battery lost is a raw percent.
public struct SleepSentryComparison: Hashable, Sendable {
    public let sentryMode: Bool
    public let avgDrainRate: Double
    public let avgBatteryLost: Double

    public init(sentryMode: Bool, avgDrainRate: Double, avgBatteryLost: Double) {
        self.sentryMode = sentryMode
        self.avgDrainRate = avgDrainRate
        self.avgBatteryLost = avgBatteryLost
    }
}

// MARK: - Drain event (web `SleepDrainEvent`)

/// One recorded vampire-drain event (web `SleepDrainEvent`). `startDate` is the raw wire
/// timestamp; `outsideTempC` is SI Celsius (nullable, web `outside_temp | null`) and
/// converts to the user's unit only at the render boundary.
public struct SleepDrainEvent: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let startDate: String
    public let durationHours: Double
    public let batteryLost: Double
    public let drainRate: Double
    public let sentryMode: Bool
    public let outsideTempC: Double?

    public init(
        id: Int64,
        startDate: String,
        durationHours: Double,
        batteryLost: Double,
        drainRate: Double,
        sentryMode: Bool,
        outsideTempC: Double?
    ) {
        self.id = id
        self.startDate = startDate
        self.durationHours = durationHours
        self.batteryLost = batteryLost
        self.drainRate = drainRate
        self.sentryMode = sentryMode
        self.outsideTempC = outsideTempC
    }

    /// Web `event.drain_rate > 1.5 ? danger : success` — the drain-rate cell tint band.
    public var drainRateSeverity: BatterySeverity {
        drainRate > 1.5 ? .danger : .success
    }
}

// MARK: - One comparison bar category (web `comparisonData` rows)

/// One grouped-bar category in the Sentry comparison chart (web `comparisonData` row):
/// a metric with its Sentry-on and Sentry-off values. `index` positions it on the
/// numeric x-axis (0 = drain rate, 1 = battery lost).
public struct SleepComparisonBar: Identifiable, Hashable, Sendable {
    public let index: Int
    public let metric: SleepComparisonMetric
    public let sentryOn: Double
    public let sentryOff: Double

    public var id: Int { index }

    public init(index: Int, metric: SleepComparisonMetric, sentryOn: Double, sentryOff: Double) {
        self.index = index
        self.metric = metric
        self.sentryOn = sentryOn
        self.sentryOff = sentryOff
    }
}

/// The two metrics the Sentry comparison chart groups by (web `Drain Rate (%/hr)` /
/// `Avg Battery Lost (%)`), each carrying its web i18n key.
public enum SleepComparisonMetric: String, CaseIterable, Sendable {
    case drainRate
    case batteryLost

    /// The web i18n key (`sleep.drainRate` / `sleep.avgBatteryLost`) for the axis label.
    public var i18nKey: String {
        switch self {
        case .drainRate: "sleep.drainRate"
        case .batteryLost: "sleep.avgBatteryLost"
        }
    }

    /// The web default copy (the chart-axis category label).
    public var defaultLabel: String {
        switch self {
        case .drainRate: "Drain Rate (%/hr)"
        case .batteryLost: "Avg Battery Lost (%)"
        }
    }
}

// MARK: - Sleep efficiency snapshot (web `SleepEfficiencyData` → /analytics/sleep)

/// The per-vehicle sleep-efficiency snapshot (web `useSleepEfficiency` `data`). Its
/// presence drives the page's loading / empty / error / success phases. Holds the four
/// summary scalars (efficiency, time-to-sleep, Sentry drain rate, Sentry monthly cost),
/// the Sentry-impact extras, and the three collections (state distribution, Sentry
/// comparison, recent drain events), plus the pure derivations the web computes inline.
public struct SleepEfficiencyData: Hashable, Sendable {
    public let sleepEfficiencyPct: Double
    public let timeToSleepAvgMin: Double
    public let sentryOnDrainRate: Double
    public let sentryOffDrainRate: Double
    public let sentryMonthlyCost: Double
    public let sentryMonthlyKwh: Double
    public let sentryExtraDrainRate: Double
    public let sentryExtraMonthlyKwh: Double
    public let sentryExtraMonthlyCost: Double
    public let stateDistribution: [SleepStateShare]
    public let sentryComparison: [SleepSentryComparison]
    public let recentEvents: [SleepDrainEvent]

    public init(
        sleepEfficiencyPct: Double,
        timeToSleepAvgMin: Double,
        sentryOnDrainRate: Double,
        sentryOffDrainRate: Double,
        sentryMonthlyCost: Double,
        sentryMonthlyKwh: Double,
        sentryExtraDrainRate: Double,
        sentryExtraMonthlyKwh: Double,
        sentryExtraMonthlyCost: Double,
        stateDistribution: [SleepStateShare],
        sentryComparison: [SleepSentryComparison],
        recentEvents: [SleepDrainEvent]
    ) {
        self.sleepEfficiencyPct = sleepEfficiencyPct
        self.timeToSleepAvgMin = timeToSleepAvgMin
        self.sentryOnDrainRate = sentryOnDrainRate
        self.sentryOffDrainRate = sentryOffDrainRate
        self.sentryMonthlyCost = sentryMonthlyCost
        self.sentryMonthlyKwh = sentryMonthlyKwh
        self.sentryExtraDrainRate = sentryExtraDrainRate
        self.sentryExtraMonthlyKwh = sentryExtraMonthlyKwh
        self.sentryExtraMonthlyCost = sentryExtraMonthlyCost
        self.stateDistribution = stateDistribution
        self.sentryComparison = sentryComparison
        self.recentEvents = recentEvents
    }

    /// Web `sentry_comparison.find((s) => s.sentry_mode)` — the Sentry-on bucket.
    public var sentryOn: SleepSentryComparison? {
        sentryComparison.first { $0.sentryMode }
    }

    /// Web `sentry_comparison.find((s) => !s.sentry_mode)` — the Sentry-off bucket.
    public var sentryOff: SleepSentryComparison? {
        sentryComparison.first { !$0.sentryMode }
    }

    /// Web `pieData.length > 0` — whether the donut has any state slices to draw.
    public var hasStateDistribution: Bool {
        !stateDistribution.isEmpty
    }

    /// Web `recentEvents.length > 0` — whether the drain-events table has rows.
    public var hasDrainEvents: Bool {
        !recentEvents.isEmpty
    }

    /// Web `comparisonData` useMemo — the two grouped-bar categories (drain rate,
    /// battery lost) built from the on/off buckets (missing buckets default to 0).
    public var comparisonBars: [SleepComparisonBar] {
        [
            SleepComparisonBar(
                index: 0,
                metric: .drainRate,
                sentryOn: sentryOn?.avgDrainRate ?? 0,
                sentryOff: sentryOff?.avgDrainRate ?? 0
            ),
            SleepComparisonBar(
                index: 1,
                metric: .batteryLost,
                sentryOn: sentryOn?.avgBatteryLost ?? 0,
                sentryOff: sentryOff?.avgBatteryLost ?? 0
            )
        ]
    }

    /// Web `comparisonData.some((d) => d.sentry_on > 0 || d.sentry_off > 0)` — whether
    /// the comparison chart has any non-zero bar (else the no-sentry-data empty shows).
    public var hasSentryComparison: Bool {
        comparisonBars.contains { $0.sentryOn > 0 || $0.sentryOff > 0 }
    }
}

// MARK: - State metadata (web `STATE_LABELS` + `STATE_COLORS`)

/// The label + chart-palette colour for a vehicle state in the donut (web `STATE_LABELS`
/// / `STATE_COLORS`). Kept SwiftUI-free so it is unit-testable; the view resolves the
/// label key through the string catalog and the colour index through `TSChartPalette`.
public enum SleepStateMeta {
    /// Web `STATE_LABELS[state] ?? state` — the i18n key for a known state, or `nil`
    /// when the state is unknown (the view then renders the raw state verbatim, exactly
    /// as the web falls back to `s.state`).
    public static func labelKey(_ state: String) -> String? {
        knownLabels[state]
    }

    /// The web English label for a known state (the string-catalog default + the
    /// plain-text name used for the chart legend / VoiceOver), or the raw state.
    public static func englishLabel(_ state: String) -> String {
        knownEnglish[state] ?? state
    }

    /// A stable categorical-palette index per state, mapping the web `STATE_COLORS` hues
    /// onto the design-token palette (so no hard-coded hex leaks into the view).
    public static func colorIndex(_ state: String) -> Int {
        switch state {
        case "asleep": 6
        case "online": 4
        case "driving": 2
        case "charging": 1
        case "updating": 5
        case "suspended": 0
        default: 7
        }
    }

    private static let knownLabels: [String: String] = [
        "asleep": "sleep.state.asleep",
        "online": "sleep.state.online",
        "driving": "sleep.state.driving",
        "charging": "sleep.state.charging",
        "updating": "sleep.state.updating",
        "suspended": "sleep.state.suspended"
    ]

    private static let knownEnglish: [String: String] = [
        "asleep": "Sleeping",
        "online": "Online/Idle",
        "driving": "Driving",
        "charging": "Charging",
        "updating": "Updating",
        "suspended": "Suspended"
    ]
}

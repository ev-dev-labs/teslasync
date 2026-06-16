import SwiftUI

// The non-chart panels for the Battery Health surface: the metric bars (web GlassPanel2),
// the seven summary metric cards (web State-of-Health … Full-Charge-Complete), the thermal
// monitoring panel (web GlassPanel10 + its four cards), the smart-insights grid (web
// GlassPanel15), the capacity-&-range new-vs-now panel (web GlassPanel19–23), the quick-links
// grid (web GlassPanel26), the recommendations panel (web GlassPanel27), and the loading
// skeleton. Percentages/capacities/cycles format directly via `BatteryHealthFormat`; module
// temperatures and ranges convert through the shared SI `Units` facade at this boundary; each
// panel renders its own empty state (never a blank region). The gauges + trend charts live in
// `BatteryHealthPage.Charts.swift`.

// MARK: - Shared icon card (web `MetricCard` — label + value + tinted icon + optional caption)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` + its `color`/`icon` props).
/// The optional caption surfaces the web subtitle (e.g. the thermal module number).
struct BatteryHealthIconCard: View {
    let title: LocalizedStringKey
    let value: String
    var caption: String?
    var systemImage: String
    var tone: TSTone = .accent

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
                if let caption {
                    Text(verbatim: caption)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Metric bars (web GlassPanel2 — capacity / degradation / cycles)

/// The three metric bars (web GlassPanel2): current capacity, degradation rate, and charge
/// cycles, each a labeled proportion bar with the web supporting caption.
struct BatteryHealthMetricBarsSection: View {
    let analytics: BatteryHealthAnalytics

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.lg)]

    /// Web `degradationColor` band mapped to a tone (≤ 5 success / ≤ 15 warning / else danger).
    private var degradationTone: TSTone {
        switch BatteryHealthBand.degradationColorIndex(analytics.degradationRateYr) {
        case 2: .success
        case 1: .warning
        default: .danger
        }
    }

    var body: some View {
        TSGlassPanel {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                bar(
                    label: "battery.bar.capacity",
                    fraction: analytics.capacityBarValue / 100,
                    tone: .info,
                    caption: capacityCaption
                )
                bar(
                    label: "battery.bar.degradation",
                    fraction: analytics.degradationRateYr / 10,
                    tone: degradationTone,
                    captionView: AnyView(degradationCaption)
                )
                bar(
                    label: "battery.bar.cycles",
                    fraction: Double(analytics.totalCycles) / 1500,
                    tone: .accent,
                    captionView: AnyView(TSCaption("battery.warrantyLimit"))
                )
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var capacityCaption: String {
        "\(BatteryHealthFormat.number(analytics.estimatedCapacityKwh, decimals: 1)) / "
            + "\(BatteryHealthFormat.number(analytics.originalCapacityKwh, decimals: 1)) kWh"
    }

    private var degradationCaption: some View {
        (Text(verbatim: "\(BatteryHealthFormat.number(analytics.degradationRateYr, decimals: 2))% ")
            + Text("battery.perYear"))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func bar(label: LocalizedStringKey, fraction: Double, tone: TSTone, caption: String) -> some View {
        bar(label: label, fraction: fraction, tone: tone, captionView: AnyView(
            Text(verbatim: caption).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        ))
    }

    private func bar(label: LocalizedStringKey, fraction: Double, tone: TSTone, captionView: AnyView) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSSubhead(label)
            TSMetricBar(fraction: fraction, tone: tone)
            captionView
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Summary cards (web State-of-Health … Full-Charge-Complete — 7 MetricCards)

/// The seven summary cards (web section 3): state of health, current + original capacity,
/// degradation rate, total cycles, battery age, and the live full-charge-complete flag.
struct BatteryHealthSummaryCardsSection: View {
    let analytics: BatteryHealthAnalytics
    let live: BatteryHealthLive?
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    private var ageValue: String {
        analytics.batteryAgeMonths > 0
            ? "\(analytics.batteryAgeMonths) \(String(localized: "battery.months"))"
            : BatteryHealthFormat.emptyValue
    }

    private var degradationValue: String {
        "\(BatteryHealthFormat.number(analytics.degradationRateYr, decimals: 2))%/\(String(localized: "battery.yr"))"
    }

    private var fullChargeValue: String {
        guard let complete = live?.bmsFullchargeComplete else { return BatteryHealthFormat.emptyValue }
        return String(localized: complete ? "common.yes" : "common.no")
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            BatteryHealthIconCard(
                title: "battery.metric.soh",
                value: BatteryHealthFormat.percent(analytics.currentSoh, units),
                systemImage: "heart.fill",
                tone: .info
            )
            BatteryHealthIconCard(
                title: "battery.metric.currentCap",
                value: BatteryHealthFormat.kilowattHours(analytics.estimatedCapacityKwh),
                systemImage: "battery.75",
                tone: .success
            )
            BatteryHealthIconCard(
                title: "battery.metric.originalCap",
                value: BatteryHealthFormat.kilowattHours(analytics.originalCapacityKwh),
                systemImage: "battery.100",
                tone: .accent
            )
            BatteryHealthIconCard(
                title: "battery.metric.degradation",
                value: degradationValue,
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .warning
            )
            BatteryHealthIconCard(
                title: "battery.metric.cycles",
                value: BatteryHealthFormat.integer(Double(analytics.totalCycles)),
                systemImage: "arrow.triangle.2.circlepath",
                tone: .accent
            )
            BatteryHealthIconCard(
                title: "battery.metric.age",
                value: ageValue,
                systemImage: "clock.fill",
                tone: .danger
            )
            BatteryHealthIconCard(
                title: "battery.metric.fullChargeComplete",
                value: fullChargeValue,
                systemImage: "checkmark.circle.fill",
                tone: (live?.bmsFullchargeComplete ?? false) ? .success : .info
            )
        }
    }
}

// MARK: - Thermal monitoring (web GlassPanel10 — title + 4 cards + freshness)

/// The thermal-monitoring panel (web GlassPanel10): the module max/min temperatures (with
/// their module numbers), the battery-heater state, and the temperature spread, plus an
/// ADR-013 freshness chip when the live telemetry is stale.
struct BatteryHealthThermalSection: View {
    let live: BatteryHealthLive?
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    private var maxValue: String {
        live?.moduleTempMaxC.map { BatteryHealthFormat.temperature($0, units) } ?? BatteryHealthFormat.emptyValue
    }

    private var minValue: String {
        live?.moduleTempMinC.map { BatteryHealthFormat.temperature($0, units) } ?? BatteryHealthFormat.emptyValue
    }

    private var spreadValue: String {
        guard let maxC = live?.moduleTempMaxC, let minC = live?.moduleTempMinC else {
            return BatteryHealthFormat.emptyValue
        }
        return BatteryHealthFormat.temperatureSpread(maxC: maxC, minC: minC, units)
    }

    private var heaterValue: String {
        guard let heater = live?.batteryHeaterOn else { return BatteryHealthFormat.emptyValue }
        return String(localized: heater ? "common.on" : "common.off")
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    BatteryHealthIconCard(
                        title: "battery.thermal.moduleTempMax",
                        value: maxValue,
                        caption: live?.numModuleTempMax.map(BatteryHealthStrings.moduleNumber),
                        systemImage: "thermometer.sun.fill",
                        tone: .warning
                    )
                    BatteryHealthIconCard(
                        title: "battery.thermal.moduleTempMin",
                        value: minValue,
                        caption: live?.numModuleTempMin.map(BatteryHealthStrings.moduleNumber),
                        systemImage: "thermometer.snowflake",
                        tone: .info
                    )
                    BatteryHealthIconCard(
                        title: "battery.thermal.heater",
                        value: heaterValue,
                        systemImage: "flame.fill",
                        tone: (live?.batteryHeaterOn ?? false) ? .danger : .success
                    )
                    BatteryHealthIconCard(
                        title: "battery.thermal.tempSpread",
                        value: spreadValue,
                        systemImage: "waveform.path.ecg",
                        tone: .accent
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "thermometer.medium")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            TSSubhead("battery.thermal.title")
            Spacer(minLength: TSSpacing.sm)
            if let live, live.hasData, !live.isFresh() {
                TSFreshnessIndicator(isStale: true, label: "live.off")
            }
        }
    }
}

// MARK: - Smart insights (web GlassPanel15 — insight grid / empty)

/// The smart-insights panel (web GlassPanel15): a grid of tinted insight cards derived from
/// the SOH band, charging habits, and degradation rate, or the not-enough-data empty state.
struct BatteryHealthInsightsSection: View {
    let insights: [BatteryHealthInsight]

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "heart.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                TSSectionTitle("battery.insights.title")
            }
            if insights.isEmpty {
                TSGlassPanel {
                    TSEmptyState(title: "battery.insights.empty", systemImage: "info.circle")
                        .frame(maxWidth: .infinity, minHeight: 120)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(insights) { insight in
                        BatteryHealthInsightCard(insight: insight)
                    }
                }
            }
        }
    }
}

/// One smart-insight card (web insight `GlassPanel`): a tinted status icon, the title, and the
/// resolved description, framed with the status tone.
struct BatteryHealthInsightCard: View {
    let insight: BatteryHealthInsight

    private var tone: TSTone {
        insight.severity.tone
    }

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: insight.systemImage)
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(LocalizedStringKey(insight.titleKey))
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: insight.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(tone.color.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

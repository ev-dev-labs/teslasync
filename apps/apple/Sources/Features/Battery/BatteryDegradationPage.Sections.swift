import SwiftUI

// The metric-card grids and text panels for the Battery Degradation surface (web
// summary `MetricCard`s, the Prediction `GlassPanel` with its sub-metrics, the
// Battery-Health-Factors `GlassPanel`, the Recommendations / Charging-Impact panels,
// the Degradation-History `DataTable`, and the loading skeleton). Percentages/scores
// format directly via `BatteryDegradationFormat`; absolute distances/energy convert
// through the shared SI `Units` facade at this boundary; each panel renders its own
// empty state (never a blank region). The gauge + projection + range + risk charts
// live in `BatteryDegradationPage.Charts.swift`.

// MARK: - Metric card (web `MetricCard` — label + value + optional tinted icon)

/// One labeled metric with an optional tinted SF Symbol (web `MetricCard` + its
/// `color`/`icon` props — `color` only tints the icon, so icon-less cards render the
/// value plain, exactly as the web does). Composes the shared `TSCard` + typography.
struct BatteryDegradationMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    var systemImage: String?
    var tone: TSTone = .accent

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    if let systemImage {
                        TSIconBox(systemName: systemImage, tone: tone)
                    }
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary metrics (web 4 MetricCards)

/// The four summary cards (web Current-SOH, Estimated-Capacity, Degradation-Rate,
/// Battery-Age). Labels use the web key names verbatim; the icon tints map the web
/// `color` props (green→success, cyan→info, purple→accent) to the shared tones.
struct BatteryDegradationSummarySection: View {
    let health: BatteryHealthData
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    private var ageValue: String {
        BatteryDegradationFormat.ageLabel(months: health.batteryAgeMonths)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            BatteryDegradationMetricCard(
                title: "Current SOH",
                value: BatteryDegradationFormat.percent(health.currentSoh, units),
                systemImage: "battery.100",
                tone: .success
            )
            BatteryDegradationMetricCard(
                title: "Estimated Capacity",
                value: BatteryDegradationFormat.kilowattHours(health.estimatedCapacityKwh, units),
                systemImage: "bolt.fill",
                tone: .info
            )
            BatteryDegradationMetricCard(
                title: "Degradation Rate",
                value: BatteryDegradationFormat.percentPerYear(health.degradationRateYr, units),
                systemImage: "chart.line.downtrend.xyaxis",
                tone: .accent
            )
            BatteryDegradationMetricCard(
                title: "Battery Age",
                value: ageValue,
                systemImage: "calendar",
                tone: .info
            )
        }
    }
}

// MARK: - Prediction panel (web GlassPanel6 — prediction + 4 sub-metrics, or needs-more)

/// The prediction panel (web GlassPanel6): when there is enough data, the natural-language
/// "reaches 80% in ~N years" sentence plus the Degradation-Rate, Stress-Level,
/// Total-Cycles, and Avg-Depth-of-Discharge sub-cards; otherwise the "need more data"
/// callout. Driven by the optional degradation source (web `degradation.prediction`).
struct BatteryDegradationPredictionSection: View {
    let health: BatteryHealthData
    let detail: BatteryDegradationDetail?
    let units: UnitPreferences

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.md),
        GridItem(.flexible(), spacing: TSSpacing.md)
    ]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if let prediction = detail?.prediction, prediction.hasEnoughData {
                    populated(prediction)
                } else {
                    BatteryDegradationNeedsMore()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.line.downtrend.xyaxis")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSSubhead("battery.degradation.prediction")
        }
    }

    private func populated(_ prediction: BatteryDegradationPrediction) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            predictionSentence(prediction)
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.TS.accent.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.accent.opacity(0.15), lineWidth: 1)
                )
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                BatteryDegradationMetricCard(
                    title: "battery.degradation.rate",
                    value: BatteryDegradationFormat.percentPerYear(abs(prediction.slopePerYear), units)
                )
                BatteryDegradationMetricCard(title: "battery.degradation.stress", value: stressValue)
                BatteryDegradationMetricCard(
                    title: "battery.degradation.totalCycles",
                    value: BatteryDegradationFormat.integer(Double(health.totalCycles))
                )
                BatteryDegradationMetricCard(
                    title: "battery.degradation.avgDoD",
                    value: BatteryDegradationFormat.percent(health.avgDepthOfDischarge, units)
                )
            }
        }
    }

    /// Web `predictionDesc 80% inApprox ~{years} years ({predicted_date})`.
    private func predictionSentence(_ prediction: BatteryDegradationPrediction) -> Text {
        let years = BatteryDegradationFormat.number(
            prediction.yearsTo80Pct,
            decimals: BatteryDegradationFormat
                .defaultDecimals(units)
        )
        let suffix = prediction.predictedDate.map { Text(verbatim: " (\($0))") } ?? Text(verbatim: "")
        let sentence = Text("battery.degradation.predictionDesc")
            + Text(verbatim: " 80% ").fontWeight(.bold).foregroundColor(Color.TS.statusWarning)
            + Text("battery.degradation.inApprox")
            + Text(verbatim: " ~\(years) ").fontWeight(.bold).foregroundColor(Color.TS.accent)
            + Text("battery.degradation.years").fontWeight(.bold).foregroundColor(Color.TS.accent)
            + suffix
        return sentence.font(Font.TS.bodySm).foregroundColor(Color.TS.textSecondary)
    }

    private var stressValue: String {
        let level = detail?.stressLevel ?? .unknown
        return level == .unknown ? BatteryDegradationFormat.emptyValue : level.displayLabel
    }
}

/// The "need more data points" callout (web `needMore` branch).
struct BatteryDegradationNeedsMore: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusWarning.opacity(0.6))
                .accessibilityHidden(true)
            Text("battery.degradation.needMore")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Battery health factors (web GlassPanel16 — 3 sub-panels)

/// The battery-health-factors panel (web GlassPanel16): the Charge-Habits,
/// Temperature-Exposure, and Cycle-Depth sub-cards (web GlassPanel17/18/19), each with
/// a scored badge whose tone follows the web `scoreVariant` bands.
struct BatteryDegradationHealthFactorsSection: View {
    let health: BatteryHealthData
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "shield.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    TSSubhead("Battery Health Factors")
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    chargeHabits
                    temperatureExposure
                    cycleDepth
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var chargeHabits: some View {
        BatteryHealthFactorCard(title: "Charge Habits", score: health.chargeHabitsScore, units: units) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                BatteryFactorRow(
                    label: "Fast Charge",
                    value: BatteryDegradationFormat.percent(health.fastChargePct, units)
                )
                BatteryFactorRow(
                    label: "Full Charge",
                    value: BatteryDegradationFormat.percent(health.fullChargePct, units)
                )
            }
        }
    }

    private var temperatureExposure: some View {
        BatteryHealthFactorCard(title: "Temperature Exposure", score: health.tempExposureScore, units: units) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "thermometer.medium")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text("Lower is better for longevity")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var cycleDepth: some View {
        BatteryHealthFactorCard(title: "Cycle Depth", score: health.cycleDepthScore, units: units) {
            BatteryFactorRow(
                label: "Avg DoD",
                value: BatteryDegradationFormat.percent(health.avgDepthOfDischarge, units)
            )
        }
    }
}

/// One health-factor sub-card (web inner GlassPanel): title + scored badge + content.
struct BatteryHealthFactorCard<Content: View>: View {
    let title: LocalizedStringKey
    let score: Double
    let units: UnitPreferences
    @ViewBuilder let content: () -> Content

    private var badgeText: String {
        "\(BatteryDegradationFormat.number(score, decimals: BatteryDegradationFormat.defaultDecimals(units)))/100"
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    Text(title).font(Font.TS.caption).fontWeight(.medium).foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    TSBadge(LocalizedStringKey(badgeText), tone: BatteryDegradationScore.variant(score).tone)
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One label/value row inside a health-factor card (web flex justify-between row).
struct BatteryFactorRow: View {
    let label: LocalizedStringKey
    let value: String

    var body: some View {
        HStack {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value).font(Font.TS.caption).fontWeight(.medium).foregroundStyle(Color.TS.textSecondary)
        }
    }
}

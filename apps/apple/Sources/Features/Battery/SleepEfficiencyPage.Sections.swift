import SwiftUI

// The metric-card grid, the two native Swift Charts (the State-Distribution donut + the
// Sentry comparison bars, never a WKWebView), the Monthly Sentry Impact callout, the
// Recent-Drain-Events table, and the loading skeleton for the Sleep Efficiency surface
// (web `SleepEfficiencyPage.tsx`). Percentages / rates / energy format directly via
// `SleepEfficiencyFormat`; SI Celsius converts through the shared `Units` facade and the
// cost values apply the user's currency symbol, all at this render boundary (ADR-005).
// Each section renders its own empty state (never a blank region). The series legend is
// shared with the sibling Battery charts (`BatteryChartLegend` / `BatteryLegendItem`).

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` + its `color`/`icon`
/// props — `color` tints the icon). Composes the shared `TSCard` + typography.
struct SleepMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
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
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary metrics (web 4 MetricCards — panels 1-4)

/// The four summary cards (web Sleep-Efficiency, Avg-Time-to-Sleep, Sentry-Drain-Rate,
/// Sentry-Monthly-Cost). Labels use the web key names verbatim; the icon tints map the
/// web `color` props (purple→accent, cyan→info, red→danger) to the shared tones.
struct SleepEfficiencySummarySection: View {
    let sleep: SleepEfficiencyData
    let units: UnitPreferences
    let currencySymbol: String

    private let columns = [GridItem(.adaptive(minimum: 170), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            SleepMetricCard(
                title: "sleep.efficiency",
                value: SleepEfficiencyFormat.percent(sleep.sleepEfficiencyPct, units),
                systemImage: "moon.fill",
                tone: .accent
            )
            SleepMetricCard(
                title: "sleep.avgTimeToSleep",
                value: SleepEfficiencyFormat.minutes(sleep.timeToSleepAvgMin),
                systemImage: "clock.fill",
                tone: .info
            )
            SleepMetricCard(
                title: "sleep.sentryDrainRate",
                value: SleepEfficiencyFormat.percentPerHour(sleep.sentryOnDrainRate, units),
                systemImage: "eye.fill",
                tone: .accent
            )
            SleepMetricCard(
                title: "sleep.sentryMonthlyCost",
                value: SleepEfficiencyFormat.currency(sleep.sentryMonthlyCost, units, symbol: currencySymbol),
                systemImage: "dollarsign.circle.fill",
                tone: .danger
            )
        }
    }
}

// MARK: - Sentry impact callout (web Monthly Sentry Mode Impact — GlassPanel7)

/// The Monthly Sentry Mode Impact callout (web amber GlassPanel7): a header plus three
/// centered figures — the extra drain per hour, the extra monthly kWh, and the extra
/// monthly cost — tinted with the warning accent.
struct SleepSentryImpactCallout: View {
    let sleep: SleepEfficiencyData
    let units: UnitPreferences
    let currencySymbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "eye.fill")
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                Text("sleep.monthlySentryImpact")
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusWarning)
            }
            HStack(alignment: .top, spacing: TSSpacing.md) {
                figure(
                    value: SleepEfficiencyFormat.percent(sleep.sentryExtraDrainRate, units),
                    label: "sleep.extraDrainHr",
                    tone: Color.TS.statusWarning
                )
                figure(
                    value: SleepEfficiencyFormat.kilowattHours(sleep.sentryExtraMonthlyKwh, units),
                    label: "sleep.extraMonthly",
                    tone: Color.TS.statusWarning
                )
                figure(
                    value: SleepEfficiencyFormat.currency(sleep.sentryExtraMonthlyCost, units, symbol: currencySymbol),
                    label: "sleep.extraCostMo",
                    tone: Color.TS.statusDanger
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.statusWarning.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private func figure(value: String, label: LocalizedStringKey, tone: Color) -> some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(tone)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the
/// summary grid, the donut/comparison pair, and the table block, all under SwiftUI
/// redaction (the manifest's `loading → redacted`).
struct SleepEfficiencySkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonGrid(count: 4, minimum: 170)
            HStack(spacing: TSSpacing.lg) {
                skeletonBlock(height: 300)
                skeletonBlock(height: 300)
            }
            skeletonBlock(height: 240)
        }
        .sleepEfficiencyRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("sleep.title"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 96)
            }
        }
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading
    /// state (the manifest's `loading → redacted(reason:)` requirement).
    func sleepEfficiencyRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}

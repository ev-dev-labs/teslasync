import SwiftUI

// The non-chart panels of the Projected-Range surface, built from the shared component library
// with the design tokens (P2/P3): the five hero metric cards, the scenario cards, the personal
// efficiency matrix, the what-if calculator, the range-factor cards, and the tips list. Every
// section renders its own empty state (never a blank region) and an accessible summary; SI metres
// / watt-hours / m·s⁻¹ / Celsius convert to the user's units at this boundary (ADR-005). The
// per-vehicle energy-intensity is pinned to Wh/km to match the matrix panel title, as the web does.

// MARK: - Hero (web Section 1 — the five StaggerItem MetricCards)

/// The hero metric row (web `StaggerContainer` with five `MetricCard`s): Your-Estimate,
/// Tesla-Estimate, Battery, Usable-Capacity, Health-Factor. Reflows from two columns (compact) to
/// a five-up row (regular) like the web `grid-cols-2 lg:grid-cols-5`.
struct ProjectedRangeHeroSection: View {
    let projection: ProjectedRangeSnapshot
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStaggerItem(index: 0) { TSMetricCard(title: "range.yourEstimate", value: yourEstimate) }
            TSStaggerItem(index: 1) { TSMetricCard(title: "range.teslaEstimate", value: teslaEstimate) }
            TSStaggerItem(index: 2) { TSMetricCard(title: "range.battery", value: batteryPercent) }
            TSStaggerItem(index: 3) { TSMetricCard(title: "range.usableCapacity", value: usableCapacity) }
            TSStaggerItem(index: 4) { TSMetricCard(title: "range.healthFactor", value: healthFactor) }
        }
        .accessibilityElement(children: .contain)
    }

    private var yourEstimate: String { Units.formatDistance(projection.yourEstimateM, units) }
    private var teslaEstimate: String { Units.formatDistance(projection.teslaEstimateM, units) }
    private var batteryPercent: String { ProjectedRangePageFormat.batteryPercent(projection.batteryCardPercent) }
    private var usableCapacity: String { Units.formatEnergy(projection.usableCapacityWh, units) }
    private var healthFactor: String { ProjectedRangePageFormat.healthFactorPercent(projection.healthFactor) }
}

// MARK: - Scenarios (web Section 3 — GlassPanel8 outer + GlassPanel9 cards)

/// The range-scenarios panel (web `GlassPanel` + the scenario-card grid): a responsive grid of
/// per-scenario cards, or the no-scenarios empty state.
struct ProjectedRangeScenariosSection: View {
    let projection: ProjectedRangeSnapshot
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("range.scenarios")
                if projection.hasScenarios {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        ForEach(projection.scenarios) { scenario in
                            ProjectedRangeScenarioCard(scenario: scenario, units: units)
                        }
                    }
                } else {
                    TSEmptyState(title: "range.noScenarios", systemImage: "car.fill")
                        .frame(maxWidth: .infinity, minHeight: 160)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One scenario card (web `GlassPanel` per scenario): the icon + name + current badge, the SI
/// range, and the speed / temperature / intensity / sample chips with any extra tags.
struct ProjectedRangeScenarioCard: View {
    let scenario: RangeScenario
    let units: UnitPreferences

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    Image(systemName: ProjectedRangeDerivations.scenarioSymbol(for: scenario))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    Text(verbatim: scenario.name)
                        .font(Font.TS.bodySm).fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.xs)
                    if scenario.isCurrent { TSBadge("range.current", tone: .success) }
                }
                TSMetricValue(Units.formatDistance(scenario.rangeM, units))
                chips
                if !scenario.extras.isEmpty {
                    HStack(spacing: TSSpacing.xs) {
                        ForEach(scenario.extras, id: \.self) { extra in
                            TSBadge(LocalizedStringKey(extra), tone: .neutral)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var chips: some View {
        HStack(spacing: TSSpacing.sm) {
            chip(Units.formatSpeed(scenario.speedMps, units))
            chip(Units.formatTemperature(scenario.tempC, units))
            chip(ProjectedRangePageFormat.efficiencyWhPerKm(scenario.efficiencyWhPerM))
            if scenario.sampleCount > 0 {
                chip(String(format: String(localized: "range.drives"), scenario.sampleCount))
            }
        }
    }

    private func chip(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Efficiency matrix (web Section 4 — GlassPanel10 heatmap)

/// The personal-efficiency-matrix panel (web `GlassPanel` + the Wh/km heatmap): a temperature ×
/// speed grid of energy-intensity cells tinted by efficiency band, or the no-matrix empty state.
struct ProjectedRangeMatrixSection: View {
    let projection: ProjectedRangeSnapshot

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("range.efficiencyMatrix")
                if projection.hasMatrix {
                    matrixGrid
                } else {
                    TSEmptyState(title: "range.noMatrix", systemImage: "thermometer.medium")
                        .frame(maxWidth: .infinity, minHeight: 160)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var matrixGrid: some View {
        Grid(horizontalSpacing: TSSpacing.xs, verticalSpacing: TSSpacing.xs) {
            GridRow {
                Color.clear.frame(width: 80, height: 1)
                ForEach(ProjectedRangeDerivations.speedBuckets, id: \.self) { speed in
                    Text(verbatim: speed.capitalized)
                        .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(ProjectedRangeDerivations.tempBuckets, id: \.self) { temp in
                GridRow {
                    Text(verbatim: temp.capitalized)
                        .font(Font.TS.caption).fontWeight(.medium)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(width: 80, alignment: .leading)
                    ForEach(ProjectedRangeDerivations.speedBuckets, id: \.self) { speed in
                        matrixCell(temp: temp, speed: speed)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func matrixCell(temp: String, speed: String) -> some View {
        if let bucket = projection.matrixBucket(temp: temp, speed: speed) {
            let tone = ProjectedRangeDerivations.efficiencyTone(whPerM: bucket.efficiencyWhPerM)
            VStack(spacing: 0) {
                Text(verbatim: ProjectedRangePageFormat.matrixCellWhPerKm(bucket.efficiencyWhPerM))
                    .font(Font.TS.caption).fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: "(\(bucket.samples))")
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.sm)
            .background(tone.color.opacity(0.18), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        } else {
            Text(verbatim: ProjectedRangePageFormat.emptyValue)
                .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.sm)
                .background(
                    Color.TS.surface.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
        }
    }
}

// MARK: - What-if calculator (web Section 5 — GlassPanel11 sliders + result)

/// The what-if-calculator panel (web `GlassPanel` + two `Slider`s + the projected result): the
/// speed and temperature sliders drive the SI interpolation, and the result shows the projected
/// range / intensity / conditions, or the no-result empty state.
struct ProjectedRangeWhatIfSection: View {
    @Bindable var model: ProjectedRangePageModel
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("range.whatIf")
                sliders
                resultView
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var sliders: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSlider(
                "range.speed",
                value: $model.whatIfSpeedMps,
                in: ProjectedRangeDerivations.speedSliderRangeMps
            ) { Units.formatSpeed($0, units) }
            TSSlider(
                "range.temperature",
                value: $model.whatIfTempC,
                in: ProjectedRangeDerivations.tempSliderRangeC
            ) { Units.formatTemperature($0, units) }
        }
    }

    @ViewBuilder
    private var resultView: some View {
        if let result = model.whatIfResult {
            VStack(spacing: TSSpacing.xs) {
                Text(verbatim: Units.formatDistance(result.rangeM, units))
                    .font(Font.TS.display).fontWeight(.bold).monospacedDigit()
                    .foregroundStyle(Color.TS.accent)
                Text(verbatim: ProjectedRangePageFormat.efficiencyWhPerKm(result.efficiencyWhPerM))
                    .font(Font.TS.bodySm).foregroundStyle(Color.TS.textMuted)
                Text(verbatim: conditions)
                    .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
        } else {
            TSEmptyState(title: "range.noWhatIf", systemImage: "slider.horizontal.3")
                .frame(maxWidth: .infinity, minHeight: 120)
        }
    }

    /// Web `t('range.whatIfConditions', 'at {{speed}}, {{temp}}', { speed, temp })`.
    private var conditions: String {
        String(
            format: String(localized: "range.whatIfConditions"),
            Units.formatSpeed(model.whatIfSpeedMps, units),
            Units.formatTemperature(model.whatIfTempC, units)
        )
    }
}

// MARK: - Range factors (web Section 6 — GlassPanel12 outer + GlassPanel13 cards)

/// The range-factors panel (web `GlassPanel` + the factor-card grid): a responsive grid of
/// per-factor cards (icon, name, signed-impact badge, description), or — when the projection
/// carries no factors — the honest empty state.
struct ProjectedRangeFactorsSection: View {
    let projection: ProjectedRangeSnapshot

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("range.factors")
                if projection.factors.isEmpty {
                    TSEmptyState(title: "range.factors", systemImage: "gauge.with.dots.needle.bottom.50percent")
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        ForEach(projection.factors) { factor in
                            ProjectedRangeFactorCard(factor: factor)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One factor card (web `GlassPanel` per factor): the mapped icon, the factor name, the signed
/// impact badge, and the description.
struct ProjectedRangeFactorCard: View {
    let factor: RangeFactor

    var body: some View {
        TSCard {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: ProjectedRangeDerivations.factorSymbol(name: factor.name))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack(spacing: TSSpacing.xs) {
                        Text(verbatim: factor.name.capitalized)
                            .font(Font.TS.bodySm).fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                        TSBadge(
                            LocalizedStringKey(ProjectedRangePageFormat.signedImpact(factor.impactPct)),
                            tone: factor.impactPct >= 0 ? .success : .danger
                        )
                    }
                    Text(verbatim: factor.detail)
                        .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Tips (web Section 7 — GlassPanel14 list)

/// The range-tips panel (web `GlassPanel` + the tips list): the lightbulb header and the four
/// static range-maximising tips.
struct ProjectedRangeTipsSection: View {
    let tips: [ProjectedRangeTip]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "lightbulb.fill")
                        .foregroundStyle(Color.TS.statusSuccess)
                        .accessibilityHidden(true)
                    TSSubhead("range.tips")
                }
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(tips) { tip in
                        HStack(alignment: .top, spacing: TSSpacing.sm) {
                            Image(systemName: tip.systemImage)
                                .foregroundStyle(Color.TS.textMuted)
                                .accessibilityHidden(true)
                            Text(LocalizedStringKey(tip.textKey))
                                .font(Font.TS.bodySm).foregroundStyle(Color.TS.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

import SwiftUI

// The always-rendered top scaffold of the Charging list (web sticky summary, search +
// active-filter chips, the six-KPI Overview card / no-stats GlassPanel, and the collection
// pills), plus the loading skeleton. Each region renders its own empty state, never a blank
// region, exactly as the web page does.

// MARK: - Sticky summary (web `PageHeaderSticky`)

/// The condensed summary bar (web `PageHeaderSticky` content): the page title, the period,
/// the active collection, the result count, and the average battery grade.
struct ChargingStickySummary: View {
    let model: ChargingListPageModel

    var body: some View {
        let stats = model.currentStats
        let grade = stats.batteryFriendlyGrade
        return TSGlassPanel {
            ViewThatFits(in: .horizontal) {
                summaryRow(grade: grade, stats: stats, wrap: false)
                summaryRow(grade: grade, stats: stats, wrap: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("charging.stickyBar.aria"))
    }

    @ViewBuilder
    private func summaryRow(grade: BatteryGrade, stats: ChargingPeriodStats, wrap: Bool) -> some View {
        let content = Group {
            Text("charging.list.title").foregroundStyle(Color.TS.textSecondary)
            dot
            Text(verbatim: model.periodLabel).foregroundStyle(Color.TS.textMuted)
            dot
            Text(model.collection.labelKey).fontWeight(.medium).foregroundStyle(Color.TS.textPrimary)
            dot
            Text(verbatim: ChargingListFormat.compact(Double(model.filteredSessions.count)))
                .foregroundStyle(Color.TS.textSecondary)
            Text("charging.results").foregroundStyle(Color.TS.textMuted)
            if grade.label != "—" {
                dot
                Text("charging.avgScore").foregroundStyle(Color.TS.textMuted)
                Text(verbatim: grade.label).fontWeight(.semibold).foregroundStyle(grade.tone.color)
            }
        }
        .font(Font.TS.caption)
        if wrap {
            VStack(alignment: .leading, spacing: TSSpacing.xs) { content }
        } else {
            HStack(spacing: TSSpacing.xs) { content }
        }
    }

    private var dot: some View {
        Text(verbatim: "·").foregroundStyle(Color.TS.textMuted.opacity(0.5))
    }
}

// MARK: - Search + active filter chips (web `FilterBar` + `ActiveFilterChips`)

/// The search field with its in-flight status (web `SearchInput` + the deferred pending
/// spinner) and the removable active-filter chips for the search query and collection.
struct ChargingSearchSection: View {
    @Bindable var model: ChargingListPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                TSSearchInput(text: $model.search, prompt: "charging.searchPlaceholder") // parity:allow i18n key
                    .frame(maxWidth: 460)
                if !model.search.isEmpty {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel(Text("filter.pending"))
                }
            }
            if !chips.isEmpty {
                TSActiveFilterChips(chips: chips, onRemove: remove, onClearAll: clearAll)
            }
        }
    }

    private var chips: [TSFilterChip] {
        var result: [TSFilterChip] = []
        if !model.search.isEmpty {
            result.append(TSFilterChip(id: "q", label: "charging.filterLabel.search"))
        }
        if model.collection != .all {
            result.append(TSFilterChip(id: "coll", label: "charging.filterLabel.collection"))
        }
        return result
    }

    private func remove(_ chip: TSFilterChip) {
        switch chip.id {
        case "q": model.search = ""
        case "coll": model.setCollection(.all)
        default: break
        }
    }

    private func clearAll() {
        model.search = ""
        model.setCollection(.all)
    }
}

// MARK: - Overview (web `KpiOverviewCard` — the six KPIs — or the no-stats GlassPanel)

/// The Overview card: a header (title + period / prior labels), the six KPI panels
/// (Sessions, Energy-kWh, Cost, Avg-rate-kW, Avg-duration, Avg-power-kW) each with its
/// prior-period delta, a secondary breakdown line, and the anomaly callout — or, when the
/// window has no sessions, the no-stats `GlassPanel` empty (web `GlassPanel7`).
struct ChargingOverviewSection: View {
    let model: ChargingListPageModel
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 3
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .topLeading), count: count)
    }

    var body: some View {
        let stats = model.currentStats
        if stats.hasData {
            populated(stats)
        } else {
            // Web `GlassPanel7` — the no-stats container shown when the window is empty.
            TSGlassPanel {
                TSEmptyState(title: "charging.noStatsRange", systemImage: "bolt.slash")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func populated(_ stats: ChargingPeriodStats) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    ChargingKpiCard(panel: .sessions, stats: stats, prior: priorStats, symbol: model.currencySymbol)
                    ChargingKpiCard(panel: .energy, stats: stats, prior: priorStats, symbol: model.currencySymbol)
                    ChargingKpiCard(panel: .cost, stats: stats, prior: priorStats, symbol: model.currencySymbol)
                    ChargingKpiCard(panel: .rate, stats: stats, prior: priorStats, symbol: model.currencySymbol)
                    ChargingKpiCard(panel: .duration, stats: stats, prior: priorStats, symbol: model.currencySymbol)
                    ChargingKpiCard(panel: .power, stats: stats, prior: priorStats, symbol: model.currencySymbol)
                }
                ChargingSecondaryLine(stats: stats)
                anomalyCallout
            }
        }
    }

    private var priorStats: ChargingPeriodStats? {
        model.priorHasData ? model.priorStats : nil
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPanelTitle("charging.overview")
            Text(verbatim: model.periodLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let priorLabel = model.priorLabel {
                Text(verbatim: priorLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted.opacity(0.8))
            }
        }
    }

    @ViewBuilder
    private var anomalyCallout: some View {
        let anomalies = model.anomalies
        if !anomalies.isEmpty, model.collection != .anomalies {
            let noun = anomalies.count == 1
                ? String(localized: "charging.anomaly_one")
                : String(localized: "charging.anomaly_other")
            let message = String(format: String(localized: "charging.anomalyCount"), anomalies.count, noun)
            Button {
                model.showAnomalies()
            } label: {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.TS.statusWarning)
                    Text(verbatim: message).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    Text("charging.viewAnomalies").font(Font.TS.caption).fontWeight(.medium)
                        .foregroundStyle(Color.TS.accent)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(
                    Color.TS.statusWarning.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: message))
        }
    }
}

// MARK: - One KPI panel (web overview `MetricCard` with a prior-period delta)

/// The six Overview KPIs (web panels Sessions / Energy-kWh / Cost / Avg-rate-kW /
/// Avg-duration / Avg-power-kW). Each resolves its label, SI→display value, and prior-period
/// percent delta from the bound stats.
struct ChargingKpiCard: View {
    enum Panel { case sessions, energy, cost, rate, duration, power }

    let panel: Panel
    let stats: ChargingPeriodStats
    let prior: ChargingPeriodStats?
    let symbol: String

    var body: some View {
        TSStatCard(
            title: LocalizedStringKey(titleKey),
            value: value,
            systemImage: systemImage,
            delta: delta?.value,
            deltaFormatted: delta?.text
        )
    }

    private var titleKey: String {
        switch panel {
        case .sessions: "charging.totalSessions"
        case .energy: "charging.totalEnergy"
        case .cost: "charging.totalCost"
        case .rate: "charging.avgRate"
        case .duration: "charging.avgDuration"
        case .power: "charging.avgPower"
        }
    }

    private var systemImage: String {
        switch panel {
        case .sessions: "bolt.fill"
        case .energy: "leaf.fill"
        case .cost: "dollarsign.circle.fill"
        case .rate: "gauge.with.dots.needle.67percent"
        case .duration: "clock.fill"
        case .power: "powerplug.fill"
        }
    }

    private var value: String {
        switch panel {
        case .sessions: ChargingListFormat.compact(Double(stats.sessionCount))
        case .energy: ChargingListFormat.energyKwh(stats.totalEnergyWh)
        case .cost: ChargingListFormat.currency(stats.totalCost, symbol: symbol)
        case .rate: ChargingListFormat.rateKw(stats.avgRateKw)
        case .duration: ChargingListFormat.duration(minutes: stats.avgDurationMin)
        case .power: ChargingListFormat.powerKw(stats.avgPowerW)
        }
    }

    private var delta: (value: Double, text: String)? {
        guard let prior else { return nil }
        switch panel {
        case .sessions: return ChargingDelta.percent(Double(stats.sessionCount), Double(prior.sessionCount))
        case .energy: return ChargingDelta.percent(stats.totalEnergyWh, prior.totalEnergyWh)
        case .cost: return ChargingDelta.percent(stats.totalCost, prior.totalCost)
        case .rate: return ChargingDelta.percent(stats.avgRateKw, prior.avgRateKw)
        case .duration: return ChargingDelta.percent(stats.avgDurationMin, prior.avgDurationMin)
        case .power: return ChargingDelta.percent(stats.avgPowerW, prior.avgPowerW)
        }
    }
}

/// Web overview `delta` (`display: 'percent'`) — the signed percent change vs. the prior
/// period, or nil when either side is missing / zero.
enum ChargingDelta {
    static func percent(_ current: Double?, _ previous: Double?) -> (value: Double, text: String)? {
        guard let current, let previous, previous != 0, current.isFinite, previous.isFinite else { return nil }
        let pct = (current - previous) / abs(previous) * 100
        return (pct, String(format: "%+.0f%%", pct))
    }
}

// MARK: - Secondary line (web overview `secondary`)

/// The overview's secondary breakdown line (web `secondaryLine`): the per-category counts,
/// the free count, the battery grade, and the most-common start hour.
struct ChargingSecondaryLine: View {
    let stats: ChargingPeriodStats

    var body: some View {
        let grade = stats.batteryFriendlyGrade
        FlowText {
            Text(verbatim: String(
                format: String(localized: "charging.byType"),
                stats.homeCount, stats.superchargerCount, stats.dcCount
            ))
            Text(verbatim: String(format: String(localized: "charging.freeCount"), stats.freeCount))
            if stats.batteryFriendlyScore != nil {
                HStack(spacing: TSSpacing.xs) {
                    Text("charging.batteryScore")
                    Text(verbatim: grade.label).fontWeight(.semibold).foregroundStyle(grade.tone.color)
                }
            }
            if let hour = stats.mostCommonStartHour {
                Text(verbatim: String(
                    format: String(localized: "charging.mostCommon"), ChargingListFormat.hour(hour)
                ))
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
    }
}

/// A simple wrapping row of caption chips for the secondary line (separator dots between).
struct FlowText<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) { content }
            VStack(alignment: .leading, spacing: TSSpacing.xs) { content }
        }
    }
}

// MARK: - Collections (web `PillFilterBar`)

/// The collection pill bar (web `PillFilterBar`): one icon + label + count pill per
/// collection, single-select, with the Tagged pill disabled exactly as the web renders it.
struct ChargingCollectionsSection: View {
    let model: ChargingListPageModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(ChargingCollection.allCases) { collection in
                    pill(collection)
                }
            }
            .padding(.vertical, TSSpacing.xs)
        }
        .accessibilityLabel(Text("charging.collections.aria"))
    }

    private func pill(_ collection: ChargingCollection) -> some View {
        let isSelected = model.collection == collection
        return Button {
            model.setCollection(collection)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: collection.systemImage).font(.caption2)
                Text(LocalizedStringKey(collection.labelKey)).font(Font.TS.caption)
                Text(verbatim: "\(model.count(for: collection))")
                    .font(Font.TS.caption)
                    .foregroundStyle(isSelected ? Color.white.opacity(0.8) : Color.TS.textMuted)
            }
            .fontWeight(isSelected ? .semibold : .regular)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(isSelected ? Color.TS.accent : Color.TS.surface, in: Capsule())
            .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: isSelected ? 0 : 1))
            .opacity(collection.isDisabled ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(collection.isDisabled)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

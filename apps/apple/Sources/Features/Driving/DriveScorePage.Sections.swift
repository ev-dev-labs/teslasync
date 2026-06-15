import SwiftUI

// The hero / breakdown / tips / best-worst sections + the date-range control + the loading skeleton
// for the Drive Score surface (web Sections 1–6b). The metric-card grids and KVLists live in
// `DriveScorePage.Panels.swift`; the charts in `DriveScorePage.Charts.swift`; the history table in
// `DriveScorePage.Table.swift`. Each value formats from raw SI via `DriveScoreFormat` at this display
// boundary; each section renders its own empty state (never a blank region).

// MARK: - Category chrome (web `CATEGORY_COLORS` icons + tones)

private extension DriveScoreCategory {
    /// The MetricBar / icon tone (web `CATEGORY_COLORS`: efficiency green, smoothness cyan, speed
    /// violet → nearest brand tone).
    var tone: TSTone {
        switch self {
        case .efficiency: .success
        case .smoothness: .info
        case .speed: .accent
        }
    }

    /// The web inline-metric icon per category.
    var iconName: String {
        switch self {
        case .efficiency: "bolt.fill"
        case .smoothness: "gauge.with.dots.needle.bottom.50percent"
        case .speed: "speedometer"
        }
    }
}

// MARK: - Trend label (web `TrendIcon` + `trendLabel` + `trendColor`)

/// The trend icon + label tinted by direction (web `TrendIcon` / `trendLabel` / `trendColor`).
struct DriveScoreTrendLabel: View {
    let trend: DriveScoreTrend

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: trend.systemImage)
                .font(.caption)
                .accessibilityHidden(true)
            Text(trend.labelKey)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
        }
        .foregroundStyle(trend.tone.color)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Date range control (web `RangePicker`)

/// The date-range filter (web `RangePicker`): native start/end `DatePicker`s that report the new
/// window back to the model. SwiftUI announces each selected date, so no redundant text label.
struct DriveScoreRangeControl: View {
    let startDate: Date
    let endDate: Date
    let onChange: (Date, Date) -> Void

    @State private var start: Date
    @State private var end: Date

    init(startDate: Date, endDate: Date, onChange: @escaping (Date, Date) -> Void) {
        self.startDate = startDate
        self.endDate = endDate
        self.onChange = onChange
        _start = State(initialValue: startDate)
        _end = State(initialValue: endDate)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DatePicker(selection: $start, in: ...end, displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: start) { _, newValue in onChange(newValue, end) }
            Text(verbatim: "–")
                .foregroundStyle(Color.TS.textMuted)
            DatePicker(selection: $end, in: start..., displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: end) { _, newValue in onChange(start, newValue) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("driveScore.col.date"))
    }
}

// MARK: - Hero overall score (web Section 1 — GlassPanel1 + RadialGauge)

/// The hero overall-score panel (web GlassPanel1): the large overall `RadialGauge` tinted by grade,
/// the animated score / 100, the help affordance, the trend, and the backend drive count.
struct DriveScoreHeroSection: View {
    let model: DriveScorePageModel

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                DriveScoreGauge(
                    value: model.overallScore,
                    maxValue: 100,
                    label: "driveScore.overall",
                    colorIndex: model.overallGrade.gaugeColorIndex
                )
                .frame(width: 180, height: 180)
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    TSAnimatedNumber(formatted: "\(model.overallScore)")
                    Text(verbatim: "/100")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                    Image(systemName: "info.circle")
                        .font(.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityLabel(Text("help.driveScore.iconLabel"))
                }
                DriveScoreTrendLabel(trend: model.overallTrend)
                if let summary = model.summary {
                    Text(verbatim: String(format: String(localized: "driveScore.basedOn"), summary.totalDrives))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.lg)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Grade badge (web Section 3 — GlassPanel2)

/// The grade-badge panel (web GlassPanel2): the overall grade badge, the "Grade: X" label + trend,
/// and the drives-in-period count.
struct DriveScoreGradeBadgeSection: View {
    let model: DriveScorePageModel

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.lg) {
                TSBadge(LocalizedStringKey(model.overallGrade.label), tone: model.overallGrade.tone)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: String(format: String(localized: "driveScore.gradeLabel"), model.overallGrade.label))
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    DriveScoreTrendLabel(trend: model.overallTrend)
                }
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: String(format: String(localized: "driveScore.drivesInPeriod"), model.scoredDrives.count))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.trailing)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Score breakdown cards (web Section 2 — GlassPanel3/4/5 + 3 RadialGauges)

/// The three category-breakdown cards (web GlassPanel3/4/5): each an efficiency / smoothness / speed
/// gauge, the score / max, a proportion bar, and the category's representative inline metric.
struct DriveScoreBreakdownSection: View {
    let model: DriveScorePageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 3)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(DriveScoreCategory.allCases, id: \.self) { category in
                DriveScoreCategoryCard(
                    category: category,
                    score: model.categoryScore(category),
                    inlineValue: inlineValue(for: category)
                )
            }
        }
    }

    private func inlineValue(for category: DriveScoreCategory) -> String {
        switch category {
        case .efficiency: DriveScoreFormat.efficiency(model.avgWhPerKm, units)
        case .smoothness: DriveScoreFormat.powerKw(model.avgPowerKw, units)
        case .speed: DriveScoreFormat.speed(model.avgMaxSpeedMps, units)
        }
    }
}

/// One category-breakdown card (web GlassPanel3/4/5): a `RadialGauge`, the animated score / max, a
/// `MetricBar`, and the inline metric (web `InlineMetric`).
struct DriveScoreCategoryCard: View {
    let category: DriveScoreCategory
    let score: Int
    let inlineValue: String

    private var inlineLabel: LocalizedStringKey {
        switch category {
        case .efficiency: "driveScore.avgConsumption"
        case .smoothness: "driveScore.powerRange"
        case .speed: "driveScore.avgMaxSpeed"
        }
    }

    private var fraction: Double {
        category.maxPoints > 0 ? Double(score) / Double(category.maxPoints) : 0
    }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                DriveScoreGauge(
                    value: score,
                    maxValue: category.maxPoints,
                    label: category.titleKey,
                    colorIndex: category.colorIndex
                )
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    TSAnimatedNumber(formatted: "\(score)")
                    Text(verbatim: "/\(category.maxPoints)")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
                TSMetricBar(fraction: fraction, tone: category.tone)
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: category.iconName)
                        .font(.caption)
                        .foregroundStyle(category.tone.color)
                        .accessibilityHidden(true)
                    TSInlineMetric(label: inlineLabel, value: inlineValue)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Tips (web Section 6 — GlassPanel12)

/// The improvement-tips panel (web GlassPanel12): the weakest-category subtitle and the relevant
/// tips, each a lightbulb-led row.
struct DriveScoreTipsSection: View {
    let weakest: DriveScoreCategory
    let tips: [DriveScoreTip]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("driveScore.tipsTitle")
                Text(verbatim: String(format: String(localized: "driveScore.tipsSubtitle"), weakestName))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                VStack(spacing: TSSpacing.sm) {
                    ForEach(tips) { tip in
                        HStack(alignment: .top, spacing: TSSpacing.sm) {
                            Image(systemName: "lightbulb.fill")
                                .font(.caption)
                                .foregroundStyle(Color.TS.statusWarning)
                                .accessibilityHidden(true)
                            Text(tip.textKey)
                                .font(Font.TS.bodySm)
                                .foregroundStyle(Color.TS.textPrimary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(TSSpacing.sm)
                        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var weakestName: String {
        switch weakest {
        case .efficiency: String(localized: "driveScore.efficiency")
        case .smoothness: String(localized: "driveScore.smoothness")
        case .speed: String(localized: "driveScore.speedDiscipline")
        }
    }
}

// MARK: - Loading skeleton (web PageContainer loading → Skeleton)

/// Mirrors the page layout while the drives source loads (web `loading` Skeleton): the hero, the
/// three gauges, the charts, and the table, under SwiftUI redaction (the manifest's
/// `loading → redacted(reason:)`).
struct DriveScoreSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonBlock(height: 220)
            skeletonGrid(count: 3, minimum: 150)
            skeletonBlock(height: 300)
            skeletonBlock(height: 260)
            skeletonBlock(height: 220)
        }
        .driveScoreRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("driveScore.title"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 160)
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
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func driveScoreRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}

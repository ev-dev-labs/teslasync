import SwiftUI

// The metric-card grid, the state-distribution panel, and the state-transition table for the
// Timeline surface (web `MetricCard` cards, GlassPanel5 distribution bar, GlassPanel7 table). The
// daily-breakdown bar chart lives in `TimelinePage.Charts.swift`. Each panel renders its own empty
// state (never a blank region); durations format from SI seconds at this display boundary.

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` with its `color` prop). Composes
/// the shared `TSCard` + `TSIconBox` + typography so the per-card accent matches the web hue.
struct TimelineMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

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

// MARK: - Summary metrics (web 4 MetricCards: Total-Transitions / Driving / Charging / Idle-Sleep)

/// The four summary metric cards (web Total-Transitions, Driving-Time, Charging-Time, Idle/Sleep).
/// Time values format SI seconds → "Xh Ym" at this boundary.
struct TimelineMetricsSection: View {
    let model: TimelinePageModel

    private let columns = [GridItem(.adaptive(minimum: 170), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TimelineMetricCard(
                title: "timeline.totalTransitions",
                value: TimelineFormat.integer(Double(model.totalTransitions)),
                systemImage: "arrow.left.arrow.right",
                tone: .accent
            )
            TimelineMetricCard(
                title: "timeline.drivingTime",
                value: TimelineFormat.hoursFromSeconds(model.drivingSeconds),
                systemImage: "car.fill",
                tone: .success
            )
            TimelineMetricCard(
                title: "timeline.chargingTime",
                value: TimelineFormat.hoursFromSeconds(model.chargingSeconds),
                systemImage: "bolt.fill",
                tone: .info
            )
            TimelineMetricCard(
                title: "timeline.idleSleepTime",
                value: TimelineFormat.hoursFromSeconds(model.idleSleepSeconds),
                systemImage: "moon.fill",
                tone: .neutral
            )
        }
    }
}

// MARK: - State distribution (web GlassPanel5 — proportional STATE_COLORS bar + legend)

/// The proportional state-distribution panel (web GlassPanel5): a single horizontal bar whose
/// segments are each state's share of total time, plus the full-state color legend. Renders the
/// no-state empty when there is no recent state activity.
struct TimelineStateDistributionSection: View {
    let segments: [TimelineDistributionSegment]
    let hasStateData: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("timeline.stateTimeline")
                if hasStateData, !segments.isEmpty {
                    TimelineDistributionBar(segments: segments)
                        .frame(height: 32)
                        .accessibilityLabel(Text("timeline.stateTimeline"))
                } else {
                    TSEmptyState(title: "timeline.noStateData", systemImage: "clock")
                        .frame(maxWidth: .infinity, minHeight: 80)
                }
                TimelineStateLegend()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// The proportional, rounded bar (web `flex h-8 rounded-full` of per-state colored divs). Segment
/// widths are weighted by each state's share so they fill the available width.
struct TimelineDistributionBar: View {
    let segments: [TimelineDistributionSegment]

    var body: some View {
        GeometryReader { geo in
            let total = max(segments.reduce(0) { $0 + $1.widthPercent }, 0.0001)
            HStack(spacing: 0) {
                ForEach(segments) { segment in
                    TSChartPalette.color(at: segment.colorIndex)
                        .frame(width: geo.size.width * segment.widthPercent / total)
                        .accessibilityLabel(Text(verbatim: tooltip(segment)))
                }
            }
            .clipShape(Capsule())
        }
    }

    private func tooltip(_ segment: TimelineDistributionSegment) -> String {
        TimelineFormat.distributionTooltip(
            state: segment.state,
            totalSeconds: segment.totalSeconds,
            percentage: segment.percentage
        )
    }
}

/// The full-state color legend beneath the bar (web `Object.entries(STATE_COLORS)` row). State
/// names are FSM data, rendered verbatim and capitalized.
struct TimelineStateLegend: View {
    private let columns = [GridItem(.adaptive(minimum: 96), spacing: TSSpacing.sm)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(TimelineStateColor.legendStates, id: \.self) { state in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: TimelineStateColor.colorIndex(for: state)))
                        .frame(width: 10, height: 10)
                    Text(verbatim: state.capitalized)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - State badge (web `Badge variant={STATE_BADGE[state]}`)

/// A tinted state chip rendered verbatim (the FSM state name is data, not UI copy). Tone follows
/// the web `STATE_BADGE` mapping.
struct TimelineStateBadge: View {
    let state: String

    var body: some View {
        Text(verbatim: state)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Self.tone(for: state).color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Self.tone(for: state).color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Self.tone(for: state).color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: state))
    }

    /// Web `STATE_BADGE` variant → tone.
    static func tone(for state: String) -> TSTone {
        switch state {
        case "driving": .success
        case "charging", "online": .info
        case "idle", "parked": .warning
        case "offline": .danger
        default: .neutral
        }
    }
}

// MARK: - State transitions (web GlassPanel7 — DataTable of transitions)

/// The state-transition table (web GlassPanel7 `DataTable`): time, from/to state chips, the derived
/// duration spent in the destination state, and the trigger field. Renders the no-transitions empty
/// when there is no history.
struct TimelineTransitionsSection: View {
    let rows: [TimelineTransitionRow]

    /// Captured once per render so every row's "current state" duration shares one `now` reference
    /// (web reads `Date.now()` per cell; one reference keeps the column internally consistent).
    private let now = Date()

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("timeline.stateTransitions")
                if rows.isEmpty {
                    TSEmptyState(title: "timeline.noTransitions", systemImage: "clock.arrow.circlepath")
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    TSDataTable(rows: rows, columns: columns)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var columns: [TSColumn<TimelineTransitionRow>] {
        [
            TSColumn(
                id: "ts",
                title: "timeline.time",
                comparator: { lhs, rhs in compare(lhs.timestamp, rhs.timestamp) },
                cell: { row in
                    Text(verbatim: TimelineFormat.dateTime(row.timestamp))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textPrimary)
                }
            ),
            TSColumn(
                id: "from",
                title: "timeline.fromState",
                comparator: { lhs, rhs in compare(lhs.fromState, rhs.fromState) },
                cell: { row in TimelineStateBadge(state: row.fromState) }
            ),
            TSColumn(
                id: "to",
                title: "timeline.toState",
                comparator: { lhs, rhs in compare(lhs.toState, rhs.toState) },
                cell: { row in TimelineStateBadge(state: row.toState) }
            ),
            TSColumn(
                id: "duration",
                title: "timeline.duration",
                cell: { row in durationCell(row) }
            ),
            TSColumn(
                id: "trigger",
                title: "timeline.trigger",
                comparator: { lhs, rhs in compare(lhs.triggerField ?? "", rhs.triggerField ?? "") },
                cell: { row in
                    Text(verbatim: row.triggerField ?? TimelineFormat.emptyValue)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            )
        ]
    }

    @ViewBuilder
    private func durationCell(_ row: TimelineTransitionRow) -> some View {
        if let seconds = row.durationSeconds(now: now) {
            Text(verbatim: TimelineFormat.durationFromSeconds(seconds))
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        } else {
            Text(verbatim: TimelineFormat.emptyValue)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func compare(_ lhs: Date, _ rhs: Date) -> ComparisonResult {
        lhs == rhs ? .orderedSame : (lhs < rhs ? .orderedAscending : .orderedDescending)
    }

    private func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs.localizedCaseInsensitiveCompare(rhs)
    }
}

// MARK: - Loading skeleton (web PageContainer loading state)

/// Mirrors the page layout while the sources load (web `PageContainer loading`): the four metric
/// cards, then the distribution, daily-breakdown, and transitions panels — all under SwiftUI
/// redaction (the manifest's `loading → redacted(reason:)`).
struct TimelineSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 170), spacing: TSSpacing.md)],
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 92)
                }
            }
            skeletonBlock(height: 96)
            skeletonBlock(height: 240)
            skeletonBlock(height: 280)
        }
        .timelineRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("timeline.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web loading state (the
    /// manifest's `loading → redacted(reason:)` requirement).
    func timelineRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}

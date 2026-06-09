//
//  FSMDistributionWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  The Swift Charts donut + its legend + the recent-transitions feed — the native
//  counterparts of the web Recharts `PieChart` (innerRadius 55%, paddingAngle 2),
//  the wrapping legend, and the `TransitionRow` feed in
//  features/dashboard/widgets/FSMDistributionWidget.tsx. Colors come from the
//  design-token palette (web `STATE_COLORS` hex → P1/S9 tokens), and the donut
//  supports tap-to-inspect selection that updates the center read-out (the native
//  analog of the web hover tooltip).
//

import Charts
import SwiftUI

// MARK: - State color (web `STATE_COLORS` hex → design tokens)

/// The design-token fill for a state bucket — the native counterpart of the web
/// `STATE_COLORS` hex values (driving `#22d3ee` → statusInfo cyan, charging
/// `#22c55e` → statusSuccess green, asleep `#a855f7` → chartSeriesPower purple,
/// idle `#f59e0b` → statusWarning amber, offline/other `#6b7280` → textMuted gray).
enum FSMDistributionStateColor {
    static func color(for kind: FSMStateKind) -> Color {
        switch kind {
        case .driving: Color.TS.statusInfo
        case .charging: Color.TS.statusSuccess
        case .asleep: Color.TS.chartSeriesPower
        case .idle: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        case .other: Color.TS.textMuted
        }
    }
}

// MARK: - Donut chart (web Recharts `PieChart`)

/// Time-in-state donut. Each sector is filled with its state color and inset to
/// reproduce the web `paddingAngle`; the hole (web `innerRadius="55%"`) carries a
/// live center read-out of the focused state's duration + share. Tapping a sector
/// focuses it (the native analog of the web hover `DonutTooltip`); with no
/// selection the largest state is shown (web compact "current state").
struct FSMDonutChart: View {
    let segments: [FSMDonutSegment]

    @State private var selectedValue: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hourUnit: String {
        FSMDistributionStrings.string("widget.fsmDistribution.hr", "h")
    }

    private var minuteUnit: String {
        FSMDistributionStrings.string("widget.fsmDistribution.min", "m")
    }

    /// Maps the selected angular value back to its sector by walking the
    /// cumulative slice sums (the donut sectors are summed in `segments` order).
    private var selectedSegment: FSMDonutSegment? {
        guard let selectedValue else { return nil }
        var cumulative = 0.0
        for segment in segments {
            cumulative += segment.milliseconds
            if selectedValue <= cumulative { return segment }
        }
        return segments.last
    }

    /// The focused sector: the tapped one, else the largest (web `segments[0]`).
    private var focused: FSMDonutSegment? {
        selectedSegment ?? segments.first
    }

    var body: some View {
        Chart(segments) { segment in
            SectorMark(
                angle: .value("duration", segment.milliseconds),
                innerRadius: .ratio(0.55),
                angularInset: 2
            )
            .cornerRadius(3)
            .foregroundStyle(FSMDistributionStateColor.color(for: segment.kind))
            .opacity(focused == nil || focused?.id == segment.id ? 1 : 0.4)
            .accessibilityLabel(Text(verbatim: FSMDistributionStrings.stateLabel(segment.state)))
            .accessibilityValue(Text(verbatim: segmentValue(segment)))
        }
        .chartLegend(.hidden)
        .chartAngleSelection(value: $selectedValue)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: segments)
        .overlay { centerReadout }
        .accessibilityLabel(
            FSMDistributionStrings.text(
                "widget.fsmDistribution.chartA11y",
                "Donut chart of time spent in each vehicle state"
            )
        )
        .accessibilityValue(Text(verbatim: FSMDistributionAccessibility.summary(
            for: FSMDistributionProjection(segments: segments, transitions: [], hasData: !segments.isEmpty),
            hourUnit: hourUnit,
            minuteUnit: minuteUnit
        )))
    }

    @ViewBuilder
    private var centerReadout: some View {
        if let focused {
            VStack(spacing: 2) {
                Text(verbatim: FSMDistributionStrings.stateLabel(focused.state))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Text(verbatim: FSMDistributionFormat.duration(
                    milliseconds: focused.milliseconds,
                    hourUnit: hourUnit,
                    minuteUnit: minuteUnit
                ))
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                Text(verbatim: "\(FSMDistributionFormat.number(focused.percent, decimals: 0))%")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private func segmentValue(_ segment: FSMDonutSegment) -> String {
        let duration = FSMDistributionFormat.duration(
            milliseconds: segment.milliseconds,
            hourUnit: hourUnit,
            minuteUnit: minuteUnit
        )
        return "\(duration), \(FSMDistributionFormat.number(segment.percent, decimals: 0))%"
    }
}

// MARK: - Legend (web `flex-wrap justify-center` state legend)

/// The wrapping legend under the donut: one centered chip per state with a color
/// dot, the localized state label, and its rounded share (web `fmtInt(pct)%`).
struct FSMStateLegend: View {
    let segments: [FSMDonutSegment]

    var body: some View {
        FSMDistributionFlowLayout(spacing: TSSpacing.sm) {
            ForEach(segments) { segment in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(FSMDistributionStateColor.color(for: segment.kind))
                        .frame(width: 8, height: 8)
                    Text(verbatim: FSMDistributionStrings.stateLabel(segment.state))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                    Text(verbatim: "\(FSMDistributionFormat.number(segment.percent, decimals: 0))%")
                        .font(Font.TS.label)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Transitions feed (web `Recent Transitions` list)

/// The recent state-transition feed — the native port of the web transitions list
/// (header + `TransitionRow`s). Newest-first, as the API returns them.
struct FSMTransitionsFeed: View {
    let transitions: [FSMTransitionItem]

    var body: some View {
        let now = Date()
        VStack(alignment: .leading, spacing: 2) {
            FSMDistributionStrings.text("widget.fsmDistribution.recentTransitions", "Recent Transitions")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(transitions) { item in
                FSMTransitionRow(item: item, now: now)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One transition row: the from → to state chips and the relative timestamp
/// (web `TransitionRow`). The 44pt minimum height preserves the web row's
/// comfortable tap target.
struct FSMTransitionRow: View {
    let item: FSMTransitionItem
    let now: Date

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            stateChip(item.fromState)
            Image(systemName: "arrow.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            stateChip(item.toState)
            Spacer(minLength: TSSpacing.xs)
            Text(verbatim: timestampText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: FSMDistributionAccessibility.transitionLabel(item, now: now)))
    }

    private var timestampText: String {
        guard let timestamp = item.timestamp else { return "—" }
        return FSMRelativeTime.string(for: timestamp, relativeTo: now)
    }

    private func stateChip(_ state: String) -> some View {
        Text(verbatim: FSMDistributionStrings.stateLabel(state))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}

// MARK: - Flow layout (web `flex-wrap justify-center`)

/// A wrapping flow layout that center-aligns each row, reproducing the web
/// legend's `flex flex-wrap gap justify-center`.
struct FSMDistributionFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        arrange(subviews: subviews, maxWidth: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let arrangement = arrange(subviews: subviews, maxWidth: bounds.width)
        for index in subviews.indices {
            let frame = arrangement.frames[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(subviews: Subviews, maxWidth: CGFloat) -> (size: CGSize, frames: [CGRect]) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var frames = [CGRect](repeating: .zero, count: subviews.count)
        var rowStart = 0
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        func centerRow(end: Int) {
            let rowWidth = max(0, cursorX - spacing)
            let offset = maxWidth.isFinite ? max(0, (maxWidth - rowWidth) / 2) : 0
            for index in rowStart ..< end {
                frames[index].origin.x += offset
            }
            widest = max(widest, rowWidth)
        }

        for index in subviews.indices {
            let itemSize = sizes[index]
            if cursorX > 0, cursorX + itemSize.width > maxWidth {
                centerRow(end: index)
                cursorX = 0
                cursorY += rowHeight + spacing
                rowHeight = 0
                rowStart = index
            }
            frames[index] = CGRect(x: cursorX, y: cursorY, width: itemSize.width, height: itemSize.height)
            cursorX += itemSize.width + spacing
            rowHeight = max(rowHeight, itemSize.height)
        }
        centerRow(end: subviews.count)
        return (CGSize(width: widest, height: cursorY + rowHeight), frames)
    }
}

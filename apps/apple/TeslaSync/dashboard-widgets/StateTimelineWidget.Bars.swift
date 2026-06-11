//
//  StateTimelineWidget.Bars.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  The leaf views the StateTimelineWidget surface composes: the always-shown
//  distribution bar (web `StackedBar`), the wide-layout 24h stripe (web
//  `TimelineStripe`), the standard-layout list row (web `StateRow`), and the
//  compact legend chip. Kept in their own file so the surface file stays within
//  the house file-length limit.
//

import SwiftUI

// MARK: - Proportional bar (shared geometry for StackedBar + TimelineStripe)

/// One colored width-proportional slice of a horizontal bar.
private struct BarSlice: Identifiable {
    let id: Int
    let pct: Double
    let color: Color
}

/// A horizontal bar whose children fill widths proportional to their `pct`
/// (web flex `width: {pct}%`). Decorative — the spoken summary is provided by
/// the container, so the bar is hidden from VoiceOver.
private struct ProportionalBar: View {
    let slices: [BarSlice]
    let height: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(slices) { slice in
                    slice.color
                        .frame(width: max(0, geo.size.width * slice.pct / 100))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .accessibilityHidden(true)
    }
}

// MARK: - Stacked distribution bar (web `StackedBar`)

/// The always-shown rounded distribution bar: one slice per state segment, in
/// the web `STATE_COLORS`, width-proportional to its share (web `StackedBar`).
struct StateStackedBar: View {
    let segments: [StateSegment]
    var height: CGFloat = 20

    var body: some View {
        ProportionalBar(
            slices: segments.enumerated().map { index, segment in
                BarSlice(id: index, pct: segment.pct, color: StateTimelinePalette.color(for: segment.kind))
            },
            height: height,
            cornerRadius: height / 2
        )
    }
}

// MARK: - 24h timeline stripe (web `TimelineStripe`)

/// The wide-layout 24h transition stripe: a muted caption above a thin rounded
/// bar of the chronological state slices (web `TimelineStripe`).
struct StateTimelineStripe: View {
    let stripe: [StateStripeSegment]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            STWStrings.text("widget.stateTimeline.timeline", "24h Timeline")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            ProportionalBar(
                slices: stripe.map { slice in
                    BarSlice(id: slice.index, pct: slice.pct, color: StateTimelinePalette.color(for: slice.kind))
                },
                height: 16,
                cornerRadius: TSRadius.sm / 2
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(STWStrings.text(
            "widget.stateTimeline.timeline",
            "24h Timeline"
        ))
    }
}

// MARK: - State list row (web `StateRow`)

/// One standard-layout list row: a state swatch dot + localized label on the
/// left, the dwell duration + a neutral percentage badge on the right (web
/// `StateRow`). Carries a combined VoiceOver label and a ≥44pt tap target.
struct StateRow: View {
    let segment: StateSegment

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(StateTimelinePalette.color(for: segment.kind))
                    .frame(width: 10, height: 10)
                Text(verbatim: STWStrings.stateLabel(segment))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: STWStrings.duration(segment.totalMin))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
            TSBadge("\(STWFormat.decimal(segment.pct, fractionDigits: 1))%")
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rowA11yLabel)
    }

    private var rowA11yLabel: Text {
        let label = STWStrings.stateLabel(segment)
        let pct = STWFormat.decimal(segment.pct, fractionDigits: 1)
        let duration = STWStrings.duration(segment.totalMin)
        return Text(verbatim: "\(label), \(pct)%, \(duration)")
    }
}

// MARK: - Compact legend chip (web compact legend dot)

/// One compact-layout legend entry: a state swatch dot, the localized label,
/// and the rounded integer percentage (web compact `{dot} {label} {pct}%`).
struct StateLegendChip: View {
    let segment: StateSegment

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(StateTimelinePalette.color(for: segment.kind))
                .frame(width: 8, height: 8)
            Text(verbatim: STWStrings.stateLabel(segment))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Text(verbatim: "\(STWFormat.integer(segment.pct))%")
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(
                verbatim: "\(STWStrings.stateLabel(segment)) \(STWFormat.integer(segment.pct))%"
            )
        )
    }
}

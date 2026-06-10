//
//  TelemetryPipelineCard.Rows.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  The per-vehicle list composed by `TelemetryPipelineCard` — the native counterpart of the
//  web `<ul>` of vehicle `<li>`s. Each row shows the liveness status pip, the vehicle name
//  (routing to the vehicle detail through the navigation seam, web `<Link to="/vehicles/:id">`),
//  the `VIN ···{tail}` + canonical state subline, the battery bar (em-dash when absent), and
//  the liveness chip with its stream/poll source label + the last-seen / next-poll relative
//  times. The relative labels re-render on a 5 s `TimelineView` tick (web page `now` tick).
//  Each row is one combined, labeled VoiceOver element built from the pure row summary.
//

import SwiftUI

// MARK: - Status pip

/// The leading liveness dot (web `h-2.5 w-2.5 rounded-full`), colored by the bucket.
struct TelemetryPipelineStatusPip: View {
    let level: TelemetryLiveness

    var body: some View {
        Circle()
            .fill(TelemetryPipelineProjection.color(for: level))
            .frame(width: 10, height: 10)
            .accessibilityHidden(true)
    }
}

// MARK: - Battery bar

/// The battery mini-bar (web `progressbar`): a tinted fill over a track + the rounded
/// percent, or the muted em-dash when no battery reading is available.
struct TelemetryPipelineBatteryBar: View {
    let percent: Int?

    private let trackWidth: CGFloat = 48

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "minus.plus.batteryblock")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            if let percent {
                let tone = TelemetryPipelineProjection.batteryTone(percent).color
                let clamped = TelemetryPipelineProjection.clampBattery(percent)
                Capsule()
                    .fill(Color.TS.border.opacity(0.4))
                    .frame(width: trackWidth, height: 6)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(tone.opacity(0.75))
                            .frame(width: trackWidth * CGFloat(clamped) / 100, height: 6)
                    }
                Text(verbatim: "\(percent)%")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            } else {
                Text(verbatim: TelemetryPipelineProjection.emDash)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

// MARK: - Liveness chip + last/next times

/// The trailing liveness chip + relative times: the source-iconed level chip (stream →
/// radio, poll/none → wifi), the small stream/poll source label, and the last-seen / next-
/// poll relative lines (web right column).
struct TelemetryPipelineRowStatus: View {
    let row: TelemetryPipelineVehicleRow
    let now: Date

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            chip
            timeLine
        }
    }

    private var chip: some View {
        let tone = TelemetryPipelineProjection.color(for: row.level)
        let label = TelemetryPipelineProjection.label(for: row.level)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: row.source == .stream ? "dot.radiowaves.left.and.right" : "wifi")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            TelemetryPipelineStrings.text(label.key, label.fallback)
                .font(Font.TS.caption)
            if let sourceLabel {
                TelemetryPipelineStrings.text(sourceLabel.key, sourceLabel.fallback)
                    .font(.system(size: 9, weight: .semibold))
                    .textCase(.uppercase)
                    .opacity(0.7)
            }
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
    }

    private var timeLine: some View {
        let last = TelemetryPipelineTimestamp.relativeOrDash(for: row.lastSeen, relativeTo: now)
        let lastLabel = TelemetryPipelineStrings.string("telemetry.pipeline.last", "last:")
        var text = "\(lastLabel) \(last)"
        if let nextPoll = row.nextPoll {
            let next = TelemetryPipelineTimestamp.relative(for: nextPoll, relativeTo: now)
            let nextLabel = TelemetryPipelineStrings.string("telemetry.pipeline.next", "next:")
            text += "  ·  \(nextLabel) \(next)"
        }
        return Text(verbatim: text)
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
    }

    private var sourceLabel: (key: String, fallback: String)? {
        switch row.source {
        case .stream: ("telemetry.pipeline.stream", "stream")
        case .poll: ("telemetry.pipeline.poll", "poll")
        case .none: nil
        }
    }
}

// MARK: - Vehicle row

/// One per-vehicle row. The whole row is a tap target that routes to the vehicle detail
/// (web links the name; a fully-tappable row is the idiomatic native affordance), exposed
/// to VoiceOver as one labeled link built from the pure row summary.
struct TelemetryPipelineVehicleRowView: View {
    let row: TelemetryPipelineVehicleRow
    let now: Date
    let onNavigate: (TelemetryPipelineDestination) -> Void

    var body: some View {
        Button { onNavigate(.vehicle(id: row.id)) } label: {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    TelemetryPipelineStatusPip(level: row.level)
                    Image(systemName: "car.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    identity
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                TelemetryPipelineBatteryBar(percent: row.batteryPercent)
                TelemetryPipelineRowStatus(row: row, now: now)
            }
            .padding(.vertical, TSSpacing.sm)
            .padding(.horizontal, TSSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TelemetryPipelineAccessibility.rowSummary(
            row, now: now, localize: TelemetryPipelineStrings.string
        )))
        .accessibilityHint(TelemetryPipelineStrings.text(
            "telemetry.pipeline.vehicleHint", "Opens vehicle detail"
        ))
        .accessibilityAddTraits(.isLink)
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: row.displayName)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: "\(TelemetryPipelineStrings.string("telemetry.pipeline.vin", "VIN")) "
                    + "\(TelemetryPipelineProjection.vinDots)\(row.vinTail)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: "·").foregroundStyle(Color.TS.textMuted).accessibilityHidden(true)
                stateText
            }
        }
    }

    @ViewBuilder
    private var stateText: some View {
        if let key = row.state.key {
            TelemetryPipelineStrings.text(key, row.state.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        } else {
            Text(verbatim: row.state.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Vehicle list

/// The per-vehicle list (web `<ul>` with `divide-y`) on a glass surface. Wrapped in a 5 s
/// `TimelineView` so the relative last-seen / next-poll labels stay live (web page `now`
/// tick) without re-fetching.
struct TelemetryPipelineVehicleList: View {
    let rows: [TelemetryPipelineVehicleRow]
    let onNavigate: (TelemetryPipelineDestination) -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Divider().overlay(Color.TS.border.opacity(0.6))
                    }
                    TelemetryPipelineVehicleRowView(row: row, now: context.date, onNavigate: onNavigate)
                }
            }
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .contain)
    }
}

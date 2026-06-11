//
//  PollingEngine.Views.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The presentational subviews composed by `PollingEngine`: the panel header (web `TrendingDown` +
//  title + "Active" badge), the savings card (four metric tiles + stacked breakdown bar + legend),
//  the expandable vehicle-activity row (icon + short VIN + activity chip + next-poll, with the
//  expanded interval / consecutive-idle / battery / reasons / prediction detail), and the
//  no-vehicles empty state. All copy resolves through the P1/S10 facade; all colour comes from the
//  P1/S9 tokens via `PollingTone.color`; the shared `TSSkeleton` / `TSButton` primitives are reused.
//  No networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Header (web `TrendingDown` + title + "Active" badge)

/// The panel header — the downtrend glyph, the title, the optional "Active" badge (shown only when
/// polling is enabled), the freshness chip, and the refresh button.
struct PollingHeaderView: View {
    let activeBadge: String?
    let connection: PollingConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.line.downtrend.xyaxis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: PollingEngineStrings.string("polling.title", "Adaptive Polling Engine"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let activeBadge {
                Text(verbatim: activeBadge)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusSuccess)
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.vertical, 2)
                    .background(Color.TS.statusSuccess.opacity(0.15), in: Capsule())
            }
            Spacer(minLength: TSSpacing.sm)
            PollingFreshnessChip(connection: connection)
            PollingRefreshButton(action: onRefresh)
        }
    }
}

// MARK: - Savings card (web `SavingsCard`)

/// The savings card — the four metric tiles, plus the breakdown bar + legend when there is a
/// positive total.
struct PollingSavingsCardView: View {
    let savings: PollingSavingsVM

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(savings.metrics) { metric in
                    PollingMetricTile(metric: metric)
                }
            }
            if savings.showBreakdown {
                PollingBreakdownBar(segments: savings.segments)
                PollingLegendView(items: savings.legend)
            }
        }
    }
}

/// One savings metric tile — a tone-colored, monospaced-digit value (the web `AnimatedNumber`,
/// honoring Reduce Motion) over a caption label.
struct PollingMetricTile: View {
    let metric: PollingMetricVM
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: metric.value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(metric.tone.color)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: metric.value)
            Text(verbatim: metric.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: metric.accessibilityLabel))
    }
}

/// The stacked breakdown bar — each segment's width is its fraction of the bar, over a neutral
/// track. The "{label}: {value}" string rides the pointer tooltip + the VoiceOver label.
struct PollingBreakdownBar: View {
    let segments: [PollingSegmentVM]

    private let spacing: CGFloat = 2

    var body: some View {
        GeometryReader { geo in
            let gaps = CGFloat(max(0, segments.count - 1)) * spacing
            let usable = max(0, geo.size.width - gaps)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.3))
                HStack(spacing: spacing) {
                    ForEach(segments) { segment in
                        Capsule()
                            .fill(segment.tone.color)
                            .frame(width: max(0, usable * segment.fraction))
                            .help(Text(verbatim: segment.accessibilityLabel))
                            .accessibilityLabel(Text(verbatim: segment.accessibilityLabel))
                    }
                }
            }
        }
        .frame(height: 8)
        .accessibilityElement(children: .contain)
    }
}

/// The breakdown legend — a tinted dot + label per category, wrapping across the available width.
struct PollingLegendView: View {
    let items: [PollingLegendItemVM]

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.sm, alignment: .leading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(item.tone.color).frame(width: 8, height: 8)
                    Text(verbatim: item.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Vehicle activity row (web `VehicleActivity`)

/// One vehicle-activity row — the collapsed header is a toggle when a decision exists, revealing the
/// expanded detail; otherwise it is a static informational row.
struct PollingVehicleActivityRow: View {
    let vehicle: PollingVehicleVM
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isExpandable: Bool {
        vehicle.detail != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isExpandable {
                Button(action: toggle) { header }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: vehicle.accessibilityLabel))
                    .accessibilityHint(Text(verbatim: hintText))
                    .accessibilityAddTraits(.isButton)
                if expanded, let detail = vehicle.detail {
                    PollingVehicleDetailView(detail: detail)
                        .padding(.leading, TSSpacing.x2xl)
                }
            } else {
                header
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: vehicle.accessibilityLabel))
            }
        }
        .padding(TSSpacing.md)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private func toggle() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration)) {
            expanded.toggle()
        }
    }

    private var hintText: String {
        expanded
            ? PollingEngineStrings.string("polling.collapseHint", "Collapse details")
            : PollingEngineStrings.string("polling.expandHint", "Expand details")
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            PollingActivityIcon(symbolName: vehicle.symbolName, tone: vehicle.tone, pulses: vehicle.pulses)
            Text(verbatim: vehicle.vinShort)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
            PollingActivityChip(text: vehicle.activityChip, tone: vehicle.tone)
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock").font(.system(size: 11))
                Text(verbatim: vehicle.nextLabel).font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
            if isExpandable {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
            }
        }
        .contentShape(Rectangle())
    }
}

/// The vehicle activity icon — pulses (scale) only for the `active` level, honoring Reduce Motion.
struct PollingActivityIcon: View {
    let symbolName: String
    let tone: PollingTone
    let pulses: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animating = false

    private var shouldPulse: Bool {
        pulses && !reduceMotion
    }

    var body: some View {
        Image(systemName: symbolName)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(tone.color)
            .scaleEffect(shouldPulse && animating ? 1.2 : 1)
            .animation(
                shouldPulse ? .easeInOut(duration: 0.75).repeatForever(autoreverses: true) : nil,
                value: animating
            )
            .onAppear { if shouldPulse { animating = true } }
            .accessibilityHidden(true)
    }
}

/// The activity chip — "{activity} · {profile}" tinted by the activity tone (web inline-styled span).
struct PollingActivityChip: View {
    let text: String
    let tone: PollingTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .accessibilityHidden(true)
    }
}

/// The expanded vehicle detail — the interval, consecutive-idle count, battery level, decision
/// reasons, and the optional prediction (web `expanded && last_decision &&` block).
struct PollingVehicleDetailView: View {
    let detail: PollingVehicleDetailVM

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Divider().overlay(Color.TS.border)
            detailLine(detail.interval)
            detailLine(detail.consecIdle)
            detailLine(detail.battery)
            ForEach(detail.reasons) { reason in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    Text(verbatim: reason.text)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            if let prediction = detail.prediction {
                PollingPredictionView(prediction: prediction)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func detailLine(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

/// The prediction block — the forecast summary + the "Based on" provenance line (web blue lines).
struct PollingPredictionView: View {
    let prediction: PollingPredictionVM

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.statusInfo)
                    .accessibilityHidden(true)
                Text(verbatim: prediction.summary)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusInfo)
            }
            Text(verbatim: prediction.basedOn)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.top, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: prediction.accessibilityLabel))
    }
}

// MARK: - Empty state (web "No vehicles tracked yet…")

/// The no-vehicles empty state — the friendly message the web renders when `vehicles.length === 0`.
struct PollingEmptyVehiclesView: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.2")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Ready body (web GlassPanel content below the header)

/// The ready panel body — the optional savings card, then the vehicle list (or the empty state).
struct PollingReadyView: View {
    let ready: PollingReady

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let savings = ready.savings {
                PollingSavingsCardView(savings: savings)
            }
            if ready.isEmpty {
                PollingEmptyVehiclesView(message: ready.emptyMessage)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "gauge.medium")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.TS.textSecondary)
                            .accessibilityHidden(true)
                        Text(verbatim: ready.vehiclesTitle)
                            .font(Font.TS.bodySm)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .accessibilityAddTraits(.isHeader)
                    ForEach(ready.vehicles) { vehicle in
                        PollingVehicleActivityRow(vehicle: vehicle)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

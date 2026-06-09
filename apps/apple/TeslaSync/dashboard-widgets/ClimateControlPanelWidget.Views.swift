//
//  ClimateControlPanelWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  The presentational subviews composed by `ClimateControlPanelWidget`: the
//  stale/offline connectivity banner, the compact single-temperature view, the
//  full 2×2 panel (HVAC badge + kW, the four metric cells, the seat-heater +
//  status chips), the individual metric cell, the tinted chip, the HVAC badge, and
//  the leading-aligned wrap layout (web `flex-wrap`). All consume pre-localized
//  strings from the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports.
//

import SwiftUI

// MARK: - Tone → design token color

extension ClimatePanelTone {
    /// Maps the Foundation-only semantic tone to a design token, reproducing the
    /// web tints: cabin → accent (neon-cyan), outside / defrost → speed (blue),
    /// seat / batteryHeater → energy (orange), muted → text-muted.
    var color: Color {
        switch self {
        case .cabin: Color.TS.accent
        case .outside: Color.TS.chartSeriesSpeed
        case .seat: Color.TS.chartSeriesEnergy
        case .defrost: Color.TS.chartSeriesSpeed
        case .batteryHeater: Color.TS.chartSeriesEnergy
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the panel when the bound source is not
/// live, so cached values are clearly labeled (web freshness-indicator intent).
struct ClimatePanelConnectivityBanner: View {
    let connection: ClimatePanelConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.climatePanel.offlineBanner" : "widget.climatePanel.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known climate"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: ClimatePanelStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact view (web `CompactView` — single temperature)

/// The compact (1×1) layout: the cabin thermometer over the inside temperature,
/// centered — the native port of the web `CompactView`.
struct ClimatePanelCompactView: View {
    let value: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: value))
    }
}

// MARK: - Full view (web `FullView` — the 2×2 panel)

/// The full layout: the HVAC status badge (+ optional kW readout), the four metric
/// cells in a 2×2 grid (Cabin / Outside / Fan Speed / Wheel Heat), and the
/// seat-heater + status chip row — the native port of the web `FullView`.
struct ClimatePanelFullView: View {
    let projection: ClimatePanelProjection

    private var temperatureMetrics: [ClimatePanelMetric] {
        Array(projection.metrics.prefix(2))
    }

    private var systemMetrics: [ClimatePanelMetric] {
        Array(projection.metrics.dropFirst(2))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            hvacRow
            metricRow(temperatureMetrics)
            metricRow(systemMetrics)
            chipRow
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }

    private var hvacRow: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "power")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                ClimatePanelHVACBadge(text: projection.hvacStatusText, isOn: projection.hvacOn)
            }
            Spacer(minLength: TSSpacing.xs)
            if let power = projection.hvacPowerText {
                Text(verbatim: power)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .accessibilityLabel(Text(verbatim: power))
            }
        }
    }

    private func metricRow(_ metrics: [ClimatePanelMetric]) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            ForEach(metrics) { metric in
                ClimatePanelMetricCell(metric: metric)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var chipRow: some View {
        ClimatePanelFlowLayout(spacing: TSSpacing.xs) {
            if projection.seatChips.isEmpty {
                Text(verbatim: projection.noSeatHeatText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityLabel(Text(verbatim: projection.noSeatHeatText))
            } else {
                ForEach(projection.seatChips) { chip in
                    ClimatePanelChipView(chip: chip)
                }
            }
            ForEach(projection.statusChips) { chip in
                ClimatePanelChipView(chip: chip)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Metric cell (web `MetricCell`)

/// One labeled metric: the tinted SF Symbol, the muted title, and the emphasized
/// value — the native port of the web `MetricCell`.
struct ClimatePanelMetricCell: View {
    let metric: ClimatePanelMetric

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: metric.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(metric.tone.color)
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: metric.title)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: metric.value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(metric.title) \(metric.value)"))
    }
}

// MARK: - Chip (web seat-heater + status pills)

/// One tinted pill with a leading SF Symbol — a seat-heater or status chip. Built
/// with `verbatim` text so the composed level / localized label is not
/// re-localized.
struct ClimatePanelChipView: View {
    let chip: ClimatePanelChip

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: chip.systemImage)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: chip.text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .lineLimit(1)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.22), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: chip.accessibilityText))
    }
}

// MARK: - HVAC badge (web `<Badge variant=success|neutral size="sm">`)

/// The HVAC On/Off badge: a tinted capsule, success when HVAC is running, neutral
/// otherwise. Built with `verbatim` text from the P1/S10 facade.
struct ClimatePanelHVACBadge: View {
    let text: String
    let isOn: Bool

    private var tone: Color {
        isOn ? Color.TS.statusSuccess : Color.TS.textMuted
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Flow layout (web `flex-wrap`)

/// A leading-aligned wrapping layout — the native analog of the web `flex
/// items-center gap-1.5 flex-wrap` chip row. Places subviews left-to-right, wrapping
/// to a new line when the next subview would overflow the proposed width.
struct ClimatePanelFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.xs

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
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        for index in subviews.indices {
            let itemSize = sizes[index]
            if cursorX > 0, cursorX + itemSize.width > maxWidth {
                cursorX = 0
                cursorY += rowHeight + spacing
                rowHeight = 0
            }
            frames[index] = CGRect(x: cursorX, y: cursorY, width: itemSize.width, height: itemSize.height)
            cursorX += itemSize.width + spacing
            rowHeight = max(rowHeight, itemSize.height)
            widest = max(widest, min(cursorX - spacing, maxWidth.isFinite ? maxWidth : cursorX))
        }
        let width = maxWidth.isFinite ? maxWidth : widest
        return (CGSize(width: width, height: cursorY + rowHeight), frames)
    }
}

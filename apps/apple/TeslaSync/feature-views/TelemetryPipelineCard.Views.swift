//
//  TelemetryPipelineCard.Views.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  The presentational chrome composed by `TelemetryPipelineCard`: the wrapping flow layout
//  (web `flex flex-wrap`), the fleet-rollup stat grid (web 2/5-column grid), the liveness
//  summary chips + the broker/polling connectivity chips, the stale/offline freshness
//  banner, and the footer links (Telemetry Coverage / MQTT Inspector / All vehicles). All
//  consume pre-localized strings from the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports. The per-vehicle rows live in `…Rows.swift`; the
//  loading/empty/error states in `…States.swift`.
//

import SwiftUI

// MARK: - Flow layout (wrapping rows — web `flex flex-wrap`)

/// A minimal left-aligned wrapping layout (native parity of the web chip rows'
/// `flex flex-wrap gap`). Lays subviews left-to-right, wrapping when the next would overflow.
struct TelemetryPipelineFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.xs
    var verticalSpacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        layout(maxWidth: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let frames = layout(maxWidth: bounds.width, subviews: subviews).frames
        for index in subviews.indices {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frames[index].minX, y: bounds.minY + frames[index].minY),
                proposal: ProposedViewSize(frames[index].size)
            )
        }
    }

    private func layout(maxWidth: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var origin = CGPoint.zero
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x > 0, origin.x + size.width > maxWidth {
                origin.x = 0
                origin.y += rowHeight + verticalSpacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: origin, size: size))
            origin.x += size.width + horizontalSpacing
            rowHeight = Swift.max(rowHeight, size.height)
            contentWidth = Swift.max(contentWidth, origin.x - horizontalSpacing)
        }
        return (CGSize(width: contentWidth, height: origin.y + rowHeight), frames)
    }
}

// MARK: - Fleet rollup grid (web 2/5-column grid)

/// One stat cell of the rollup grid: a muted caption label over a tabular value.
struct TelemetryStatCell: View {
    let titleKey: String
    let titleFallback: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            TelemetryPipelineStrings.text(titleKey, titleFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.body)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TelemetryPipelineStrings.text(titleKey, titleFallback))
        .accessibilityValue(Text(verbatim: value))
    }
}

/// The fleet-rollup grid: Vehicles · GPS positions · Drives · Charging sessions · Signal log
/// (web `grid-cols-2 md:grid-cols-5`), as an adaptive grid that reflows on width.
struct TelemetryFleetRollupGrid: View {
    let vehicleCount: Int
    let totals: TelemetryFleetTotals

    private var vehiclesValue: String {
        if vehicleCount > 0 {
            let template = TelemetryPipelineStrings.string("telemetry.pipeline.vehiclesConnected", "%lld connected")
            return String(format: template, vehicleCount)
        }
        return TelemetryPipelineStrings.string("telemetry.pipeline.noneConfigured", "none configured")
    }

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 116), spacing: TSSpacing.lg, alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.sm
        ) {
            TelemetryStatCell(
                titleKey: "telemetry.pipeline.vehicles", titleFallback: "Vehicles", value: vehiclesValue
            )
            TelemetryStatCell(
                titleKey: "telemetry.pipeline.gpsPositions", titleFallback: "GPS positions",
                value: TelemetryPipelineProjection.formattedCount(totals.positions)
            )
            TelemetryStatCell(
                titleKey: "telemetry.pipeline.drives", titleFallback: "Drives",
                value: TelemetryPipelineProjection.formattedCount(totals.drives)
            )
            TelemetryStatCell(
                titleKey: "telemetry.pipeline.chargingSessions", titleFallback: "Charging sessions",
                value: TelemetryPipelineProjection.formattedCount(totals.chargingSessions)
            )
            TelemetryStatCell(
                titleKey: "telemetry.pipeline.signalLog", titleFallback: "Signal log",
                value: TelemetryPipelineProjection.formattedCount(totals.signalLog)
            )
        }
    }
}

// MARK: - Liveness + connectivity chips (web sub-header)

/// One liveness rollup chip: a tinted dot + "{n} {label}" in the bucket's status color
/// (web emerald/amber/red/grey chip).
struct TelemetryLivenessChip: View {
    let level: TelemetryLiveness
    let count: Int

    var body: some View {
        let tone = TelemetryPipelineProjection.color(for: level)
        let label = TelemetryPipelineProjection.label(for: level)
        let text = "\(count) \(TelemetryPipelineStrings.string(label.key, label.fallback))"
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(tone)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

/// One connectivity chip: an SF Symbol + label tinted by tone (web broker/polling chips).
struct TelemetryConnectivityChip: View {
    let systemImage: String
    let titleKey: String
    let titleFallback: String
    let tone: Color

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            TelemetryPipelineStrings.text(titleKey, titleFallback)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TelemetryPipelineStrings.text(titleKey, titleFallback))
    }
}

/// The sub-header chip row: "Liveness:" + the non-zero bucket chips, then the broker chip
/// (connected/disconnected) and, when polling is off, the streaming-only/disabled chip.
struct TelemetryPipelineSummaryRow: View {
    let summary: TelemetryFleetSummary
    let mqttConnected: Bool
    let pollingEnabled: Bool

    var body: some View {
        TelemetryPipelineFlowLayout(horizontalSpacing: TSSpacing.xs, verticalSpacing: TSSpacing.xs) {
            TelemetryPipelineStrings.text("telemetry.pipeline.liveness", "Liveness:")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(summary.orderedNonZero, id: \.level) { entry in
                TelemetryLivenessChip(level: entry.level, count: entry.count)
            }
            brokerChip
            if !pollingEnabled { pollingChip }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var brokerChip: some View {
        if mqttConnected {
            TelemetryConnectivityChip(
                systemImage: "dot.radiowaves.left.and.right",
                titleKey: "telemetry.pipeline.fleetConnected", titleFallback: "Fleet Telemetry connected",
                tone: Color.TS.accent
            )
        } else {
            TelemetryConnectivityChip(
                systemImage: "wifi.slash",
                titleKey: "telemetry.pipeline.mqttDisconnected", titleFallback: "MQTT broker disconnected",
                tone: Color.TS.statusWarning
            )
        }
    }

    @ViewBuilder
    private var pollingChip: some View {
        if mqttConnected {
            TelemetryConnectivityChip(
                systemImage: "pause.circle",
                titleKey: "telemetry.pipeline.pollingStreamingOnly",
                titleFallback: "polling engine off (streaming-only)",
                tone: Color.TS.textMuted
            )
        } else {
            TelemetryConnectivityChip(
                systemImage: "wifi.slash",
                titleKey: "telemetry.pipeline.pollingDisabled", titleFallback: "polling engine disabled",
                tone: Color.TS.statusWarning
            )
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the card body when the bound source is not live, so
/// cached rows are clearly labeled (ADR-013 freshness intent).
struct TelemetryPipelineConnectivityBanner: View {
    let connection: TelemetryPipelineConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "telemetry.pipeline.offlineBanner" : "telemetry.pipeline.staleBanner"
        let fallback = offline
            ? "Offline — showing last known telemetry status"
            : "Reconnecting — telemetry status may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            TelemetryPipelineStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Footer links (web bottom `<Link>` cluster)

/// One footer link button (web `<Link>`): an SF Symbol + label that routes through the
/// navigation seam. The primary variant is filled-accent; secondary is text-only.
struct TelemetryPipelineFooterLink: View {
    let systemImage: String
    let titleKey: String
    let titleFallback: String
    let prominent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                TelemetryPipelineStrings.text(titleKey, titleFallback)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 36)
            .background(
                prominent ? Color.TS.accent.opacity(0.15) : Color.clear,
                in: Capsule()
            )
            .overlay(
                Capsule().strokeBorder(Color.TS.accent.opacity(prominent ? 0.3 : 0), lineWidth: 1)
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TelemetryPipelineStrings.text(titleKey, titleFallback))
        .accessibilityAddTraits(.isLink)
    }
}

/// The footer link cluster, separated from the body by a hairline divider (web `border-t`).
struct TelemetryPipelineFooterLinks: View {
    let onNavigate: (TelemetryPipelineDestination) -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            TelemetryPipelineFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
                TelemetryPipelineFooterLink(
                    systemImage: "arrow.up.right.square",
                    titleKey: "telemetry.pipeline.openCoverage", titleFallback: "Open Telemetry Coverage",
                    prominent: true
                ) { onNavigate(.telemetryCoverage) }
                TelemetryPipelineFooterLink(
                    systemImage: "dot.radiowaves.left.and.right",
                    titleKey: "telemetry.pipeline.mqttInspector", titleFallback: "MQTT Inspector",
                    prominent: false
                ) { onNavigate(.mqttInspector) }
                TelemetryPipelineFooterLink(
                    systemImage: "bolt.horizontal",
                    titleKey: "telemetry.pipeline.allVehicles", titleFallback: "All vehicles",
                    prominent: false
                ) { onNavigate(.allVehicles) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

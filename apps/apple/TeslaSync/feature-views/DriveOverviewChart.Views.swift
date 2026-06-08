//
//  DriveOverviewChart.Views.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  Panel chrome composed by `DriveOverviewChart`: the header (web `ChartContainer`
//  title + freshness chip), the stale/offline connectivity banner, the loading / empty
//  / error states, and the rich Mean/Max/Min legend (web `ChartLegend`). The composed
//  trace, tooltip, and axes live in DriveOverviewChart.Chart.swift. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking and no
//  Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `Drive Overview` with a trace glyph
/// and the live-state freshness chip.
struct DriveOverviewHeader: View {
    let connection: DriveOverviewConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            DriveOverviewStrings.text("driveDetail.driveChart", "Drive Overview")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            DriveOverviewFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DriveOverviewFreshnessChip: View {
    let connection: DriveOverviewConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DriveOverviewStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DriveOverviewStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DriveOverviewConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live, so
/// a cached trace is clearly labeled (web `DataFreshness` intent).
struct DriveOverviewConnectivityBanner: View {
    let connection: DriveOverviewConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.offlineBanner" : "driveDetail.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded drive trace"
            : "Reconnecting — the drive trace may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DriveOverviewStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a chart-shaped block above a row of legend
/// bars, respecting Reduce Motion (via `TSSkeleton`).
struct DriveOverviewLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 360, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 4) { _ in
                    TSSkeleton(width: 64, height: 10)
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DriveOverviewStrings.text("driveDetail.loading", "Loading drive overview"))
    }
}

// MARK: - Empty state (web "No telemetry data available")

/// The resolved-but-empty state (web `chartData.length <= 1` → the Activity-glyph "No
/// telemetry data available" message), rendered as a `ContentUnavailableView` rather
/// than a blank box.
struct DriveOverviewEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DriveOverviewStrings.text("driveDetail.noChartData", "No telemetry data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            DriveOverviewStrings.text(
                "driveDetail.emptyHint",
                "The drive trace appears here once this drive has streamed a few telemetry samples."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 280)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct DriveOverviewError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DriveOverviewStrings.text("driveDetail.errorTitle", "Couldn't load the drive overview")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                DriveOverviewStrings.text("driveDetail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DriveOverviewStrings.text("driveDetail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Rich legend (web `ChartLegend` Mean/Max/Min)

/// The rich legend below the chart (web `ChartLegend`): a colored line swatch + the
/// series label, then its Mean / Max / Min stats, wrapping across lines.
struct DriveOverviewLegend: View {
    let items: [DriveLegendItem]

    var body: some View {
        DriveOverviewWrapLayout(spacing: TSSpacing.xl, lineSpacing: TSSpacing.xs) {
            ForEach(items) { item in
                DriveOverviewLegendRow(item: item)
            }
        }
    }
}

/// One legend row: swatch + colored label + the three muted stat columns.
struct DriveOverviewLegendRow: View {
    let item: DriveLegendItem

    private var color: Color {
        DriveOverviewStyle.color(item.kind)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            DriveLegendSwatch(color: color, dashed: item.kind.dashed)
                .frame(width: 16, height: 2)
            DriveOverviewStrings.text(item.kind.legendKey, item.kind.legendFallback)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(color)
            stat("driveDetail.chart.mean", "Mean", item.mean)
            stat("driveDetail.chart.max", "Max", item.max)
            stat("driveDetail.chart.min", "Min", item.min)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: legendLabel))
    }

    private func stat(_ key: String, _ fallback: String, _ value: String) -> some View {
        HStack(spacing: 2) {
            DriveOverviewStrings.text(key, fallback)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()
        }
        .font(Font.TS.caption)
    }

    private var legendLabel: String {
        DriveOverviewAccessibility.legendLabel(item, localize: DriveOverviewStrings.string)
    }
}

/// A short horizontal line swatch (web `border-t-2`), dashed for the range series.
struct DriveLegendSwatch: View {
    let color: Color
    let dashed: Bool

    var body: some View {
        DriveLegendLineShape()
            .stroke(color, style: StrokeStyle(lineWidth: 2, dash: dashed ? [3, 2] : []))
    }
}

private struct DriveLegendLineShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

// MARK: - Wrapping flow layout (web flex-wrap)

/// A minimal wrapping flow layout (no native SwiftUI equivalent) so the legend rows
/// reflow across lines like the web `flex flex-wrap` row.
struct DriveOverviewWrapLayout: Layout {
    var spacing: CGFloat = TSSpacing.lg
    var lineSpacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursorX > 0, cursorX + size.width > maxWidth {
                cursorY += rowHeight + lineSpacing
                cursorX = 0
                rowHeight = 0
            }
            cursorX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, cursorX - spacing)
        }
        return CGSize(width: min(widest, maxWidth), height: cursorY + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var cursorX = bounds.minX
        var cursorY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursorX > bounds.minX, cursorX + size.width > bounds.maxX {
                cursorY += rowHeight + lineSpacing
                cursorX = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: cursorX, y: cursorY), anchor: .topLeading, proposal: ProposedViewSize(size))
            cursorX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

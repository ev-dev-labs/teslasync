//
//  PowerFlowHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0073 · PowerFlowHistoryWidget (Apple)
//
//  The composable Power Flow History dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/PowerFlowHistoryWidget.tsx. Binds through
//  `PowerFlowModel` (no networking in the view); renders every state (loading /
//  error / no-site / no-data / content) inside a glass widget shell, with the
//  freshness chip reflecting live / stale / offline.
//

import Foundation
import SwiftUI

// MARK: - PowerFlowHistoryWidget (the dashboard surface)

/// The composable Power Flow History dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/PowerFlowHistoryWidget.tsx`. Renders every state
/// from the web source (loading / error / no-site / no-data / content) inside a
/// glass widget shell, binding through `PowerFlowModel` (P1/S8). No networking
/// lives here.
public struct PowerFlowHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PowerFlowHistoryWidget"

    /// Canonical registry metadata (registry/energy.ts → "power-flow-history").
    public static let registration = DashboardWidgetRegistration(
        id: "power-flow-history",
        nameKey: "widget.powerFlowHistory.title",
        descriptionKey: "widget.powerFlowHistory.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: PowerFlowModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: PowerFlowModel,
        size: DashboardWidgetSize = PowerFlowHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = PowerFlowHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` (defensive — the registry min is 2 cols).
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 3` (drives the chart's axis tick density).
    private var isWide: Bool {
        size.cols >= 3
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

extension PowerFlowHistoryWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            PowerFlowStrings.text("widget.powerFlowHistory.title", "Power Flow History")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = PowerFlowStrings.string("widget.powerFlowHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = PowerFlowStrings.string("widget.powerFlowHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = PowerFlowStrings.string("widget.powerFlowHistory.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(PowerFlowStrings.text("widget.powerFlowHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                PowerFlowStrings.text("widget.powerFlowHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(PowerFlowStrings.text("widget.powerFlowHistory.openA11y", "Open the energy page"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                ForEach(0 ..< (isCompact ? 2 : 3), id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(width: 48, height: 10)
                        TSSkeleton(width: 64, height: 16)
                    }
                }
                Spacer(minLength: 0)
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(PowerFlowStrings.text("widget.powerFlowHistory.loading", "Loading power flow history"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            PowerFlowStrings.text("widget.powerFlowHistory.errorTitle", "Couldn't load power flow history")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                PowerFlowStrings.text("widget.powerFlowHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(PowerFlowStrings.text("widget.powerFlowHistory.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let reason = model.emptyReason {
            PowerFlowEmptyState(message: emptyMessage(for: reason))
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                PowerFlowStatRow(stats: stats)
                if !isCompact {
                    PowerFlowAreaChart(points: model.points, isWide: isWide)
                    PowerFlowLegend()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    /// The header stats: Avg Solar + Peak Home always, Net Grid on the standard
    /// (non-compact) layout (web compact stats vs standard stats).
    private var stats: [PowerFlowStatItem] {
        var items = [
            PowerFlowStatItem(
                labelKey: "widget.powerFlowHistory.avgSolar", fallback: "Avg Solar",
                valueKw: model.summary.avgSolarKw
            ),
            PowerFlowStatItem(
                labelKey: "widget.powerFlowHistory.peakHome", fallback: "Peak Home",
                valueKw: model.summary.peakHomeKw
            )
        ]
        if !isCompact {
            items.append(PowerFlowStatItem(
                labelKey: "widget.powerFlowHistory.netGrid", fallback: "Net Grid",
                valueKw: model.summary.netGridKw
            ))
        }
        return items
    }

    private func emptyMessage(for reason: PowerFlowEmptyReason) -> String {
        switch reason {
        case .noSite:
            PowerFlowStrings.string("widget.powerFlowHistory.noSite", "No Tesla Energy site linked")
        case .noData:
            PowerFlowStrings.string("widget.powerFlowHistory.noData", "No power flow data")
        }
    }
}

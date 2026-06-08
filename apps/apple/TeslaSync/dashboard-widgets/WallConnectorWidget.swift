//
//  WallConnectorWidget.swift
//  TeslaSync — P4 dashboard widget · 0112 · WallConnectorWidget (Apple)
//
//  The composable Wall Connector dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/WallConnectorWidget.tsx. Binds through
//  `WallConnectorModel` (no networking in the view); renders every state (loading /
//  error / no-site / no-data / content) inside a glass widget shell, with the
//  freshness chip reflecting live / stale / offline and compact (1-col) vs standard
//  (2×4+) composition matching the web source.
//

import Foundation
import SwiftUI

// MARK: - WallConnectorWidget (the dashboard surface)

/// The composable Wall Connector dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/WallConnectorWidget.tsx`. Renders home charging stats
/// from the Tesla Wall Connector (this month's kWh + session history) across every
/// web state, binding through `WallConnectorModel` (P1/S8). No networking lives here.
public struct WallConnectorWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "WallConnectorWidget"

    /// Canonical registry metadata (registry/charging.ts → "wall-connector").
    public static let registration = DashboardWidgetRegistration(
        id: "wall-connector",
        nameKey: "widget.wallConnector.title",
        descriptionKey: "widget.wallConnector.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: WallConnectorModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: WallConnectorModel,
        size: DashboardWidgetSize = WallConnectorWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = WallConnectorWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — single-column tile (month total + sessions
    /// only, no chart).
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 3` — drives the chart's axis tick density.
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

    private func tsText(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: WallConnectorStrings.string(key, fallback))
    }
}

// MARK: - Header

extension WallConnectorWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "powerplug.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(WallConnectorPalette.bar)
                    .accessibilityHidden(true)
                tsText("widget.wallConnector.title", "Wall Connector")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
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
            label = WallConnectorStrings.string("widget.wallConnector.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = WallConnectorStrings.string("widget.wallConnector.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = WallConnectorStrings.string("widget.wallConnector.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if !isCompact {
                Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
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
        .accessibilityLabel(tsText("widget.wallConnector.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                tsText("widget.wallConnector.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(tsText("widget.wallConnector.openA11y", "Open the energy page"))
    }
}

// MARK: - Content states

extension WallConnectorWidget {
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
        .accessibilityLabel(tsText("widget.wallConnector.loading", "Loading Wall Connector data"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            tsText("widget.wallConnector.errorTitle", "Couldn't load Wall Connector data")
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
                tsText("widget.wallConnector.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tsText("widget.wallConnector.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let reason = model.emptyReason {
            WallConnectorEmptyState(message: emptyMessage(for: reason))
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                WallConnectorStatRow(stats: stats)
                if !isCompact {
                    WallConnectorBarChart(bars: model.bars, summary: model.summary, isWide: isWide)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    /// The header stats: This Month + Sessions always, Avg / Session on the standard
    /// (non-compact) layout — mirroring the web compact (2 stats) vs standard (3
    /// stats) `WidgetChartSummary` composition.
    private var stats: [WallConnectorStatItem] {
        let kwh = WallConnectorStrings.string("widget.wallConnector.unitKwh", "kWh")
        var items = [
            WallConnectorStatItem(
                labelKey: "widget.wallConnector.monthTotal",
                fallback: "This Month",
                value: WallConnectorFormat.kilowattHours(model.summary.monthTotalKwh),
                unit: kwh
            ),
            WallConnectorStatItem(
                labelKey: "widget.wallConnector.sessions",
                fallback: "Sessions",
                value: WallConnectorFormat.integer(model.summary.monthSessions),
                unit: nil
            )
        ]
        if !isCompact {
            items.append(WallConnectorStatItem(
                labelKey: "widget.wallConnector.avgPerSession",
                fallback: "Avg / Session",
                value: WallConnectorFormat.kilowattHours(model.summary.avgKwhPerSession),
                unit: kwh
            ))
        }
        return items
    }

    private func emptyMessage(for reason: WallConnectorEmptyReason) -> String {
        switch reason {
        case .noSite:
            WallConnectorStrings.string("widget.wallConnector.noSite", "No Tesla Energy site linked")
        case .noData:
            WallConnectorStrings.string("widget.wallConnector.noData", "No Wall Connector data")
        }
    }
}

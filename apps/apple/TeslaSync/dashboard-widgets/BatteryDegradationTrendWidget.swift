//
//  BatteryDegradationTrendWidget.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  The composable Battery Degradation Trend dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/BatteryDegradationTrendWidget.tsx. Binds through
//  `BatteryDegradationTrendModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - BatteryDegradationTrendWidget (the dashboard surface)

/// The composable Battery Degradation Trend dashboard widget — the SwiftUI parity
/// of `features/dashboard/widgets/BatteryDegradationTrendWidget.tsx`. Renders
/// every state from the web source (loading / empty / error / stale / offline /
/// content) inside a glass widget shell, binding through
/// `BatteryDegradationTrendModel` (P1/S8). No networking lives here.
public struct BatteryDegradationTrendWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "BatteryDegradationTrendWidget"

    /// Canonical registry metadata (registry/battery.ts → "battery-degradation-trend").
    public static let registration = DashboardWidgetRegistration(
        id: "battery-degradation-trend",
        nameKey: "widget.batteryDegradationTrend.title",
        descriptionKey: "widget.batteryDegradationTrend.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: BatteryDegradationTrendModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: BatteryDegradationTrendModel,
        size: DashboardWidgetSize = BatteryDegradationTrendWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = BatteryDegradationTrendWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        BatteryDegradationTrendModel.isCompact(size)
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
        .task(id: staleRefreshToken) { await autoRefreshWhenStale() }
        .accessibilityElement(children: .contain)
    }

    /// Restarts whenever connection/freshness changes so the stale auto-refresh
    /// re-arms exactly once per stale window.
    private var staleRefreshToken: String {
        "\(model.connection)-\(model.updatedAt?.timeIntervalSince1970 ?? 0)"
    }

    /// Stale state → auto-refresh after a short grace period (web
    /// `DataFreshnessAuto`). Cancelled automatically when a fresher snapshot
    /// arrives or the view disappears.
    private func autoRefreshWhenStale() async {
        guard model.connection == .stale else { return }
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled, model.connection == .stale else { return }
        model.refresh()
    }
}

// MARK: - Header

extension BatteryDegradationTrendWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "chart.line.downtrend.xyaxis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                BatteryDegradationTrendStrings.text("widget.batteryDegradationTrend.title", "Battery Degradation")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
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
            label = BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.offline", "Offline")
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
        .accessibilityLabel(BatteryDegradationTrendStrings.text("widget.batteryDegradationTrend.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                BatteryDegradationTrendStrings.text("widget.batteryDegradationTrend.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            BatteryDegradationTrendStrings.text(
                "widget.batteryDegradationTrend.openA11y",
                "Open the battery health page"
            )
        )
    }
}

// MARK: - Content states

extension BatteryDegradationTrendWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            degradationContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 48, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 64, height: 14, cornerRadius: TSRadius.sm)
                    }
                }
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            BatteryDegradationTrendStrings.text(
                "widget.batteryDegradationTrend.loading",
                "Loading battery degradation"
            )
        )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                BatteryDegradationTrendStrings.text(
                    "widget.batteryDegradationTrend.noDegradation",
                    "No degradation data"
                )
            } icon: {
                Image(systemName: "chart.line.downtrend.xyaxis")
            }
        } description: {
            BatteryDegradationTrendStrings.text(
                "widget.batteryDegradationTrend.emptyHint",
                "Battery health history will appear here as snapshots accumulate."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            BatteryDegradationTrendStrings.text(
                "widget.batteryDegradationTrend.errorTitle",
                "Couldn't load battery degradation"
            )
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
                BatteryDegradationTrendStrings.text("widget.batteryDegradationTrend.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content (stat header + trend chart)

extension BatteryDegradationTrendWidget {
    private var degradationContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            BatteryDegradationStatRow(stats: stats)
            if !isCompact { chartSlot }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private var chartSlot: some View {
        if model.projection.hasTrend {
            BatteryDegradationTrendChart(projection: model.projection)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            BatteryDegradationTrendNeedsMore()
        }
    }

    /// The SoH / Degradation / Cycles summary stats (web `stats` memo). The
    /// degradation cell only appears when the rate is present and positive.
    private var stats: [BatteryDegradationStat] {
        let projection = model.projection
        var items: [BatteryDegradationStat] = []
        items.append(
            BatteryDegradationStat(
                id: "soh",
                label: BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.soh", "SoH"),
                value: BatteryDegradationTrendFormat.healthValue(projection.currentHealth)
            )
        )
        if let rate = projection.degradationRate, BatteryDegradationTrendBuilder.showsDegradationRate(rate) {
            let monthUnit = BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.mo", "mo")
            items.append(
                BatteryDegradationStat(
                    id: "degradation",
                    label: BatteryDegradationTrendStrings.string(
                        "widget.batteryDegradationTrend.degradation",
                        "Degradation"
                    ),
                    value: BatteryDegradationTrendFormat.degradationValue(rate),
                    unit: "/\(monthUnit)"
                )
            )
        }
        items.append(
            BatteryDegradationStat(
                id: "cycles",
                label: BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.cycles", "Cycles"),
                value: BatteryDegradationTrendFormat.cyclesValue(projection.cycles)
            )
        )
        return items
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.batteryDegradationTrend.offlineBanner"
            : "widget.batteryDegradationTrend.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved health"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            BatteryDegradationTrendStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

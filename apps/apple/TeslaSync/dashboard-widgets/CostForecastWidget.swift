//
//  CostForecastWidget.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  The composable Cost Forecast dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/CostForecastWidget.tsx. Binds through
//  `CostForecastWidgetModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - CostForecastWidget (the dashboard surface)

/// The composable Cost Forecast dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/CostForecastWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `CostForecastWidgetModel` (P1/S8). The 6-month
/// charging-cost projection shows a next-month / avg-$/kWh / trend stat header
/// and a historical-vs-forecast bar chart. No networking lives here.
public struct CostForecastWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CostForecastWidget"

    /// Canonical registry metadata (registry/charging.ts → "cost-forecast").
    public static let registration = DashboardWidgetRegistration(
        id: "cost-forecast",
        nameKey: "widget.costForecast.title",
        descriptionKey: "widget.costForecast.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: CostForecastWidgetModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: CostForecastWidgetModel,
        size: DashboardWidgetSize = CostForecastWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = CostForecastWidget.registration.clamp(size)
        self.onOpen = onOpen
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

    /// `true` when the widget is a single column (web `isCompact = cols <= 1`).
    private var isCompact: Bool {
        CostForecastWidgetModel.isCompact(size)
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

extension CostForecastWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                trendIcon
                CostForecastWidgetStrings.text("widget.costForecast.title", "Cost Forecast")
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

    /// The web header icon: `TrendingUp` (amber) when next-month cost rises,
    /// `TrendingDown` (emerald) when it falls.
    private var trendIcon: some View {
        let up = model.projection.trendUp
        return Image(systemName: up ? "chart.line.uptrend.xyaxis" : "chart.line.downtrend.xyaxis")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(up ? Color.TS.statusWarning : Color.TS.statusSuccess)
            .accessibilityHidden(true)
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = CostForecastWidgetStrings.string("widget.costForecast.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = CostForecastWidgetStrings.string("widget.costForecast.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = CostForecastWidgetStrings.string("widget.costForecast.offline", "Offline")
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
        .accessibilityLabel(CostForecastWidgetStrings.text("widget.costForecast.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                CostForecastWidgetStrings.text("widget.costForecast.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            CostForecastWidgetStrings.text("widget.costForecast.openA11y", "Open the charging page")
        )
    }
}

// MARK: - Content states

extension CostForecastWidget {
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
            forecastContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< (isCompact ? 2 : 3), id: \.self) { _ in
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
        .accessibilityLabel(CostForecastWidgetStrings.text("widget.costForecast.loading", "Loading cost forecast"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                CostForecastWidgetStrings.text("widget.costForecast.noData", "No forecast data")
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        } description: {
            CostForecastWidgetStrings.text(
                "widget.costForecast.emptyHint",
                "A six-month cost projection will appear here once enough charging history is recorded."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            CostForecastWidgetStrings.text("widget.costForecast.errorTitle", "Couldn't load cost forecast")
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
                CostForecastWidgetStrings.text("widget.costForecast.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.statusSuccess.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.statusSuccess)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content (stat header + bar chart)

extension CostForecastWidget {
    private var forecastContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !isCompact {
                CostForecastWidgetChart(
                    bars: model.projection.bars,
                    currency: model.currency,
                    isWide: CostForecastWidgetModel.isWide(size)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            nextMonthCell
            if !isCompact { avgPerKwhCell }
            trendCell
            Spacer(minLength: 0)
        }
    }

    private var nextMonthCell: some View {
        statCell(
            labelKey: "widget.costForecast.nextMonth",
            labelFallback: "Next Month",
            value: model.currency.string(model.projection.nextCost, decimals: 0),
            accessibilityValue: nil
        )
    }

    private var avgPerKwhCell: some View {
        let avg = model.projection.avgCostPerKwh
        let value = avg.map { model.currency.string($0, decimals: 2) } ?? "—"
        return statCell(
            labelKey: "widget.costForecast.avgPerKwh",
            labelFallback: "Avg $/kWh",
            value: value,
            accessibilityValue: nil
        )
    }

    /// Trend stat — compact shows the bare arrow (web `↑`/`↓`); standard appends
    /// the absolute delta (web `↑ $X` / `↓ $X`). VoiceOver speaks "up/down <Δ>".
    private var trendCell: some View {
        let up = model.projection.trendUp
        let arrow = up ? "↑" : "↓"
        let delta = model.currency.string(model.projection.trendDelta, decimals: 0)
        let value = isCompact ? arrow : "\(arrow) \(delta)"
        let spoken = CostForecastWidgetAccessibility.trendPhrase(for: model.projection, currency: model.currency)
        return statCell(
            labelKey: "widget.costForecast.trend",
            labelFallback: "Trend",
            value: value,
            valueColor: up ? Color.TS.statusWarning : Color.TS.statusSuccess,
            accessibilityValue: spoken
        )
    }

    private func statCell(
        labelKey: String,
        labelFallback: String,
        value: String,
        valueColor: Color = Color.TS.textPrimary,
        accessibilityValue: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            CostForecastWidgetStrings.text(labelKey, labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: accessibilityLabel(
                labelKey: labelKey,
                labelFallback: labelFallback,
                value: accessibilityValue ?? value
            ))
        )
    }

    private func accessibilityLabel(labelKey: String, labelFallback: String, value: String) -> String {
        let label = CostForecastWidgetStrings.string(labelKey, labelFallback)
        return "\(label) \(value)"
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.costForecast.offlineBanner"
            : "widget.costForecast.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved forecast"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            CostForecastWidgetStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

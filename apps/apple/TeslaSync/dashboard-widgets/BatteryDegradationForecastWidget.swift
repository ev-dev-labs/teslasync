//
//  BatteryDegradationForecastWidget.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  The composable Battery Degradation Forecast dashboard surface — SwiftUI parity
//  of features/dashboard/widgets/BatteryDegradationForecastWidget.tsx. Renders the
//  predictive degradation forecast (when the pack reaches 80% capacity, the
//  health tier, risk factors and recommendations) across every web state
//  (loading / empty / error / stale / offline / content) inside a glass widget
//  shell, binding through `BatteryDegradationForecastModel` (P1/S8). No networking
//  lives here. Compact (1-col) shows the health summary; the standard (2×4+)
//  layout adds the projected-date hero, the current-health stat, the risk-factor
//  list and the recommendation tip cards.
//

import Foundation
import SwiftUI

// MARK: - BatteryDegradationForecastWidget (the dashboard surface)

/// The composable Battery Degradation Forecast dashboard widget — the SwiftUI
/// parity of `features/dashboard/widgets/BatteryDegradationForecastWidget.tsx`.
public struct BatteryDegradationForecastWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "BatteryDegradationForecastWidget"

    /// Canonical registry metadata (registry/battery.ts → "battery-degradation-forecast").
    public static let registration = DashboardWidgetRegistration(
        id: "battery-degradation-forecast",
        nameKey: "widget.forecast.title",
        descriptionKey: "widget.forecast.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State var model: BatteryDegradationForecastModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: BatteryDegradationForecastModel,
        size: DashboardWidgetSize = BatteryDegradationForecastWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = BatteryDegradationForecastWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the single-column tile (health summary
    /// only, no hero / lists).
    var isCompact: Bool {
        BatteryDegradationForecastModel.isCompact(size)
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

extension BatteryDegradationForecastWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "chart.line.downtrend.xyaxis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                BatteryDegradationForecastStrings.text("widget.forecast.title", "Battery Forecast")
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
            label = BatteryDegradationForecastStrings.string("widget.forecast.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = BatteryDegradationForecastStrings.string("widget.forecast.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = BatteryDegradationForecastStrings.string("widget.forecast.offline", "Offline")
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
        .accessibilityLabel(BatteryDegradationForecastStrings.text("widget.forecast.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                BatteryDegradationForecastStrings.text("widget.forecast.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            BatteryDegradationForecastStrings.text(
                "widget.forecast.openA11y",
                "Open the battery health page"
            )
        )
    }
}

// MARK: - Content states

extension BatteryDegradationForecastWidget {
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
            VStack(spacing: 6) {
                TSSkeleton(width: 96, height: 8, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 140, height: 20, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 72, height: 14, cornerRadius: TSRadius.sm)
            }
            .frame(maxWidth: .infinity)
            if !isCompact {
                TSSkeleton(height: 48, cornerRadius: TSRadius.md)
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            BatteryDegradationForecastStrings.text(
                "widget.forecast.loading",
                "Loading battery degradation forecast"
            )
        )
    }

    private var emptyState: some View {
        BatteryDegradationForecastEmptyState(
            message: BatteryDegradationForecastStrings.string(
                "widget.forecast.noData",
                "No degradation forecast data"
            )
        )
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            BatteryDegradationForecastStrings.text(
                "widget.forecast.errorTitle",
                "Couldn't load degradation forecast"
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
                BatteryDegradationForecastStrings.text("widget.forecast.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(BatteryDegradationForecastStrings.text("widget.forecast.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

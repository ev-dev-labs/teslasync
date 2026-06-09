//
//  DriveEfficiencyChartWidget.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  The composable Drive Efficiency dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/DriveEfficiencyChartWidget.tsx. Binds through
//  `DriveEfficiencyChartModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - DriveEfficiencyChartWidget (the dashboard surface)

/// The composable Drive Efficiency dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DriveEfficiencyChartWidget.tsx`. Renders every
/// state from the web source (loading / empty / error / stale / offline /
/// content) inside a glass widget shell, binding through
/// `DriveEfficiencyChartModel` (P1/S8). No networking lives here.
public struct DriveEfficiencyChartWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DriveEfficiencyChartWidget"

    /// Canonical registry metadata (registry/driving.ts → "drive-efficiency-chart").
    public static let registration = DashboardWidgetRegistration(
        id: "drive-efficiency-chart",
        nameKey: "widget.driveEfficiencyChart.name",
        descriptionKey: "widget.driveEfficiencyChart.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: DriveEfficiencyChartModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DriveEfficiencyChartModel,
        size: DashboardWidgetSize = DriveEfficiencyChartWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DriveEfficiencyChartWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !DriveEfficiencyChartModel.isCompact(size) { header }
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

extension DriveEfficiencyChartWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.title", "Drive Efficiency")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
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
            label = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.offline", "Offline")
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
        .accessibilityLabel(DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.openA11y", "Open the driving analytics page")
        )
    }
}

// MARK: - Content states

extension DriveEfficiencyChartWidget {
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
            efficiencyContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 44, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 60, height: 14, cornerRadius: TSRadius.sm)
                    }
                }
            }
            if !DriveEfficiencyChartModel.isCompact(size) {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(DriveEfficiencyChartStrings.text(
            "widget.driveEfficiencyChart.loading",
            "Loading drive efficiency"
        ))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.empty", "No efficiency data yet")
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        } description: {
            DriveEfficiencyChartStrings.text(
                "widget.driveEfficiencyChart.emptyHint",
                "Efficiency trends appear here once drives with energy data are recorded."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.errorTitle", "Couldn't load drive efficiency")
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
                DriveEfficiencyChartStrings.text("widget.driveEfficiencyChart.retry", "Retry")
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

// MARK: - Loaded content (stat header + area chart)

extension DriveEfficiencyChartWidget {
    private var efficiencyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !DriveEfficiencyChartModel.isCompact(size) {
                DriveEfficiencyChart(
                    projection: model.projection,
                    isWide: DriveEfficiencyChartModel.isWide(size)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            statCell(
                labelKey: "widget.driveEfficiencyChart.avg",
                labelFallback: "Avg",
                value: DriveEfficiencyFormat.int(model.projection.overallAvg),
                unit: model.projection.efficiencyUnit
            )
            statCell(
                labelKey: "widget.driveEfficiencyChart.best",
                labelFallback: "Best day",
                value: DriveEfficiencyFormat.int(model.projection.bestDay),
                unit: model.projection.efficiencyUnit
            )
            statCell(
                labelKey: "widget.driveEfficiencyChart.trend",
                labelFallback: "Trend",
                value: DriveEfficiencyFormat.trend(model.projection.trend),
                unit: nil
            )
            Spacer(minLength: 0)
        }
    }

    private func statCell(labelKey: String, labelFallback: String, value: String, unit: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            DriveEfficiencyChartStrings.text(labelKey, labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(DriveEfficiencyChartStrings.string(labelKey, labelFallback)) "
                + "\(value)\(unit.map { " \($0)" } ?? "")")
        )
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.driveEfficiencyChart.offlineBanner"
            : "widget.driveEfficiencyChart.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved efficiency"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DriveEfficiencyChartStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

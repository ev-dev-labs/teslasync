//
//  SpeedHeatmapWidget.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  The composable Speed Heatmap dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SpeedHeatmapWidget.tsx. Binds through
//  SpeedHeatmapModel (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content, across the compact
//  (1-column peak number) and standard/wide (summary + 7×24 heatmap + legend)
//  layouts.
//

import Foundation
import SwiftUI

// MARK: - SpeedHeatmapWidget (the dashboard surface)

/// The composable Speed Heatmap dashboard widget. Renders a time-of-day ×
/// day-of-week speed distribution inside a glass widget shell, binding through
/// `SpeedHeatmapModel` (P1/S8). No networking lives here.
public struct SpeedHeatmapWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SpeedHeatmapWidget"

    /// Canonical registry metadata (registry/driving.ts → "speed-heatmap").
    public static let registration = DashboardWidgetRegistration(
        id: "speed-heatmap",
        nameKey: "widget.speedHeatmap",
        descriptionKey: "widget.speedHeatmap.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SpeedHeatmapModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SpeedHeatmapModel,
        size: DashboardWidgetSize = SpeedHeatmapWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SpeedHeatmapWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        SpeedHeatmapModel.isCompact(for: size)
    }

    private var isWide: Bool {
        SpeedHeatmapModel.isWide(for: size)
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

// MARK: - Header

extension SpeedHeatmapWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "square.grid.3x3.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SpeedHeatmapStrings.text("widget.speedHeatmap.title", "Speed Heatmap")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil, !isCompact { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SpeedHeatmapStrings.string("widget.speedHeatmap.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SpeedHeatmapStrings.string("widget.speedHeatmap.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SpeedHeatmapStrings.string("widget.speedHeatmap.offline", "Offline")
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
        .accessibilityLabel(SpeedHeatmapStrings.text("widget.speedHeatmap.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SpeedHeatmapStrings.text("widget.speedHeatmap.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SpeedHeatmapStrings.text("widget.speedHeatmap.openA11y", "Open the driving page"))
    }
}

// MARK: - Content states

extension SpeedHeatmapWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty:
            if isCompact { compactContent } else { emptyState }
        case .content:
            if isCompact { compactContent } else { standardContent }
        }
    }

    private var compactContent: some View {
        SpeedHeatmapPeakNumber(maxSpeed: model.maxSpeed, unit: model.unit)
    }

    private var standardContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            SpeedHeatmapSummaryRow(
                totalDrives: model.totalDrives,
                maxSpeed: model.maxSpeed,
                unit: model.unit
            )
            HeatmapCanvas(
                grid: model.grid,
                maxSpeed: model.maxSpeed,
                dayLabels: SpeedHeatmapBuilder.dayLabels(wide: isWide, calendar: model.calendar),
                hourLabels: SpeedHeatmapBuilder.hourLabels(wide: isWide),
                isWide: isWide
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: heatmapSummary))
            SpeedHeatmapLegend(maxSpeed: model.maxSpeed)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var heatmapSummary: String {
        SpeedHeatmapAccessibility.summary(grid: model.grid, unit: model.unit, calendar: model.calendar)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.speedHeatmap.offlineBanner" : "widget.speedHeatmap.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded heatmap"
            : "Reconnecting — the heatmap may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SpeedHeatmapStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var loadingChrome: some View {
        Group {
            if isCompact {
                TSSkeleton(height: 36, cornerRadius: TSRadius.md)
                    .frame(maxWidth: 120, maxHeight: .infinity, alignment: .center)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 180, height: 12)
                    TSSkeleton(height: 132, cornerRadius: TSRadius.md)
                        .frame(maxHeight: .infinity)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SpeedHeatmapStrings.text("widget.speedHeatmap.loading", "Loading speed heatmap"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SpeedHeatmapStrings.text("widget.speedHeatmap.empty", "No drive data yet")
            } icon: {
                Image(systemName: "square.grid.3x3")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SpeedHeatmapStrings.text("widget.speedHeatmap.errorTitle", "Couldn't load speed heatmap")
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
                SpeedHeatmapStrings.text("widget.speedHeatmap.retry", "Retry")
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

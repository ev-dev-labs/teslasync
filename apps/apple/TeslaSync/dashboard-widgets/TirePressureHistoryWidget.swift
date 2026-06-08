//
//  TirePressureHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0101 · TirePressureHistoryWidget (Apple)
//
//  The composable Tire Pressure History dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/TirePressureHistoryWidget.tsx. Binds through
//  `TirePressureHistoryModel` (no networking in the view) and renders every state
//  (loading / empty / error / stale / offline / content) inside a glass shell.
//

import SwiftUI

// MARK: - TirePressureHistoryWidget (the dashboard surface)

/// The composable Tire Pressure History dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/TirePressureHistoryWidget.tsx`. Renders the four
/// corner pressures over time with the recommended Min/Max band, across every web
/// state, binding through `TirePressureHistoryModel` (P1/S8).
public struct TirePressureHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TirePressureHistoryWidget"

    /// Canonical registry metadata (registry/tires.ts → "tire-pressure-history").
    public static let registration = DashboardWidgetRegistration(
        id: "tire-pressure-history",
        nameKey: "widget.tirePressureHistory",
        descriptionKey: "widget.tirePressureHistory.description",
        category: "tires",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: TirePressureHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: TirePressureHistoryModel,
        size: DashboardWidgetSize = TirePressureHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = TirePressureHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        size.cols <= 1
    }

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
        Text(verbatim: TirePressureHistoryStrings.string(key, fallback))
    }
}

// MARK: - Header

extension TirePressureHistoryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "smallcircle.filled.circle")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                tsText("widget.tirePressureHistory.title", "Tire Pressure History")
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
            label = TirePressureHistoryStrings.string("widget.tirePressureHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = TirePressureHistoryStrings.string("widget.tirePressureHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = TirePressureHistoryStrings.string("widget.tirePressureHistory.offline", "Offline")
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
        .accessibilityLabel(tsText("widget.tirePressureHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                tsText("widget.tirePressureHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(tsText("widget.tirePressureHistory.openA11y", "Open the Tire Pressure page"))
    }
}

// MARK: - Content states

extension TirePressureHistoryWidget {
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
            chartContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            statSkeletonRow
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(tsText("widget.tirePressureHistory.loading", "Loading tire pressure history"))
    }

    private var statSkeletonRow: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(TireCorner.allCases, id: \.self) { _ in
                TSSkeleton(height: 26, cornerRadius: TSRadius.sm)
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                tsText("widget.tirePressureHistory.noData", "No tire pressure history")
            } icon: {
                Image(systemName: "smallcircle.filled.circle")
            }
        } description: {
            tsText("widget.tirePressureHistory.emptyHint", "Drive to record tire pressure readings.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            tsText("widget.tirePressureHistory.errorTitle", "Couldn't load tire pressure history")
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
                tsText("widget.tirePressureHistory.retry", "Retry")
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

    private var chartContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !isCompact {
                TirePressureHistoryChart(
                    projection: model.projection,
                    showAxisTitles: isWide
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    @ViewBuilder
    private var statRow: some View {
        if isCompact {
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 2),
                alignment: .leading,
                spacing: TSSpacing.sm
            ) {
                ForEach(TireCorner.allCases, id: \.self) { statColumn($0) }
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                ForEach(TireCorner.allCases, id: \.self) { statColumn($0) }
                Spacer(minLength: 0)
            }
        }
    }

    private func statColumn(_ corner: TireCorner) -> some View {
        let label = TirePressureHistoryStrings.string(corner.labelKey, corner.labelFallback)
        let value = TirePressureNumberFormat.pressure(model.projection.latestValue(corner))
        let unit = model.projection.pressureUnitLabel
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Circle().fill(cornerColor(corner)).frame(width: 6, height: 6)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label) \(value) \(unit)"))
    }

    /// Corner → series color token (matches the chart's mapping).
    private func cornerColor(_ corner: TireCorner) -> Color {
        switch corner {
        case .frontLeft: Color.TS.chartSeriesSpeed
        case .frontRight: Color.TS.chartSeriesRegen
        case .rearLeft: Color.TS.chartSeriesBattery
        case .rearRight: Color.TS.chartSeriesPower
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.tirePressureHistory.offlineBanner" : "widget.tirePressureHistory.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known data"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            tsText(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

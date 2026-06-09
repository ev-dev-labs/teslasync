//
//  ClimateHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0027 · ClimateHistoryWidget (Apple)
//
//  The composable Climate History dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ClimateHistoryWidget.tsx. Binds through
//  `ClimateHistoryModel` (no networking in the view) and renders every state
//  (loading / empty / error / stale / offline / content) inside a glass shell.
//

import SwiftUI

// MARK: - ClimateHistoryWidget (the dashboard surface)

/// The composable Climate History dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/ClimateHistoryWidget.tsx`. Renders cabin vs outside
/// temperature over time, across every web state, binding through
/// `ClimateHistoryModel` (P1/S8).
public struct ClimateHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ClimateHistoryWidget"

    /// Canonical registry metadata (registry/climate.ts → "climate-history").
    public static let registration = DashboardWidgetRegistration(
        id: "climate-history",
        nameKey: "widget.climateHistory",
        descriptionKey: "widget.climateHistory.description",
        category: "climate",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ClimateHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ClimateHistoryModel,
        size: DashboardWidgetSize = ClimateHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ClimateHistoryWidget.registration.clamp(size)
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
        Text(verbatim: ClimateHistoryStrings.string(key, fallback))
    }
}

// MARK: - Header

extension ClimateHistoryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "thermometer.sun.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                tsText("widget.climateHistory.title", "Climate History")
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
            label = ClimateHistoryStrings.string("widget.climateHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ClimateHistoryStrings.string("widget.climateHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ClimateHistoryStrings.string("widget.climateHistory.offline", "Offline")
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
        .accessibilityLabel(tsText("widget.climateHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                tsText("widget.climateHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(tsText("widget.climateHistory.openA11y", "Open the Climate page"))
    }
}

// MARK: - Content states

extension ClimateHistoryWidget {
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
        .accessibilityLabel(tsText("widget.climateHistory.loading", "Loading climate history"))
    }

    private var statSkeletonRow: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(ClimateSeries.allCases, id: \.self) { _ in
                TSSkeleton(height: 26, cornerRadius: TSRadius.sm)
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                tsText("widget.climateHistory.noData", "No climate history")
            } icon: {
                Image(systemName: "thermometer.sun.fill")
            }
        } description: {
            tsText("widget.climateHistory.emptyHint", "Drive or precondition to record cabin and outside temperatures.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            tsText("widget.climateHistory.errorTitle", "Couldn't load climate history")
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
                tsText("widget.climateHistory.retry", "Retry")
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
                ClimateHistoryChart(
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
                ForEach(ClimateSeries.allCases, id: \.self) { statColumn($0) }
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                ForEach(ClimateSeries.allCases, id: \.self) { statColumn($0) }
                Spacer(minLength: 0)
            }
        }
    }

    private func statColumn(_ series: ClimateSeries) -> some View {
        let label = ClimateHistoryStrings.string(series.labelKey, series.labelFallback)
        let value = ClimateNumberFormat.temperature(model.projection.latestValue(series))
        let unit = model.projection.temperatureUnitLabel
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Circle().fill(seriesColor(series)).frame(width: 6, height: 6)
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
        .accessibilityLabel(Text(verbatim: "\(label) \(value)\(unit)"))
    }

    /// Series → color token (matches the chart's mapping). Cabin #f97316 → amber
    /// energy token; Outside #3b82f6 → speed token (exact-hex).
    private func seriesColor(_ series: ClimateSeries) -> Color {
        switch series {
        case .cabin: Color.TS.chartSeriesEnergy
        case .outside: Color.TS.chartSeriesSpeed
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.climateHistory.offlineBanner" : "widget.climateHistory.staleBanner"
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

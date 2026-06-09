//
//  DriveTelemetryWidget.swift
//  TeslaSync — P4 dashboard widget · 0041 · DriveTelemetryWidget (Apple)
//
//  The composable Drive Telemetry dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/DriveTelemetryWidget.tsx. Binds through
//  `DriveTelemetryModel` (no networking in the view) and renders every state
//  (loading / empty / error / stale / offline / content) inside a glass shell.
//

import SwiftUI

// MARK: - DriveTelemetryWidget (the dashboard surface)

/// The composable Drive Telemetry dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/DriveTelemetryWidget.tsx`. Replays the latest
/// drive's speed / power / battery (and elevation when wide) over time with a
/// stat header, across every web state, binding through `DriveTelemetryModel`
/// (P1/S8).
public struct DriveTelemetryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DriveTelemetryWidget"

    /// Canonical registry metadata (registry/driving.ts → "drive-telemetry").
    public static let registration = DashboardWidgetRegistration(
        id: "drive-telemetry",
        nameKey: "widget.driveTelemetry",
        descriptionKey: "widget.driveTelemetry.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: DriveTelemetryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DriveTelemetryModel,
        size: DashboardWidgetSize = DriveTelemetryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DriveTelemetryWidget.registration.clamp(size)
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
        Text(verbatim: DriveTelemetryStrings.string(key, fallback))
    }
}

// MARK: - Header

extension DriveTelemetryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                tsText("widget.driveTelemetry.title", "Drive Telemetry")
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
            label = DriveTelemetryStrings.string("widget.driveTelemetry.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DriveTelemetryStrings.string("widget.driveTelemetry.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DriveTelemetryStrings.string("widget.driveTelemetry.offline", "Offline")
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
        .accessibilityLabel(tsText("widget.driveTelemetry.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                tsText("widget.driveTelemetry.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(tsText("widget.driveTelemetry.openA11y", "Open the Drives page"))
    }
}

// MARK: - Content states

extension DriveTelemetryWidget {
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
            driveContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 64, height: 26, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 64, height: 26, cornerRadius: TSRadius.sm)
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(tsText("widget.driveTelemetry.loading", "Loading drive telemetry"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                tsText("widget.driveTelemetry.empty", "No recent drives")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            tsText("widget.driveTelemetry.emptyHint", "Take a drive to see speed, power, and battery replay.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            tsText("widget.driveTelemetry.errorTitle", "Couldn't load drive telemetry")
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
                tsText("widget.driveTelemetry.retry", "Retry")
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

    private var driveContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !isCompact {
                chartArea
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                legend
            }
        }
    }

    @ViewBuilder
    private var chartArea: some View {
        if model.projection.hasData {
            DriveTelemetryChart(projection: model.projection, isWide: isWide)
        } else {
            ContentUnavailableView {
                Label {
                    tsText("widget.driveTelemetry.noTelemetry", "No telemetry for this drive")
                } icon: {
                    Image(systemName: "waveform.path.ecg")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Stat row + legend

extension DriveTelemetryWidget {
    private var statRow: some View {
        let projection = model.projection
        return HStack(alignment: .top, spacing: TSSpacing.md) {
            statColumn(
                label: DriveTelemetryStrings.string("widget.driveTelemetry.distance", "Distance"),
                value: projection.distanceText,
                unit: projection.distanceUnitLabel
            )
            statColumn(
                label: DriveTelemetryStrings.string("widget.driveTelemetry.duration", "Duration"),
                value: projection.durationText,
                unit: DriveTelemetryStrings.string("widget.driveTelemetry.min", "min")
            )
            if let efficiency = projection.efficiencyText {
                statColumn(
                    label: DriveTelemetryStrings.string("widget.driveTelemetry.efficiency", "Efficiency"),
                    value: efficiency,
                    unit: projection.efficiencyUnitLabel
                )
            }
            Spacer(minLength: 0)
            if isWide, let address = projection.startAddress {
                addressBadge(address)
            }
        }
    }

    private func statColumn(label: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
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

    private func addressBadge(_ address: String) -> some View {
        Text(verbatim: address)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: 180, alignment: .trailing)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityLabel(Text(verbatim: address))
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            legendItem(
                color: Color.TS.chartSeriesSpeed,
                label: DriveTelemetryStrings.string("widget.driveTelemetry.speed", "Speed")
            )
            legendItem(
                color: Color.TS.chartSeriesPower,
                label: DriveTelemetryStrings.string("widget.driveTelemetry.power", "Power (kW)")
            )
            legendItem(
                color: Color.TS.chartSeriesBattery,
                label: DriveTelemetryStrings.string("widget.driveTelemetry.battery", "Battery %")
            )
            if isWide {
                legendItem(
                    color: Color.TS.textMuted,
                    label: DriveTelemetryStrings.string("widget.driveTelemetry.elevation", "Elevation")
                )
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.driveTelemetry.offlineBanner" : "widget.driveTelemetry.staleBanner"
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

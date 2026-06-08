//
//  MotorHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0066 · MotorHistoryWidget (Apple)
//
//  The composable Motor History dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MotorHistoryWidget.tsx. Binds through
//  `MotorHistoryModel` (no networking in the view) and renders every state
//  (loading / empty / error / stale / offline / content) inside a glass shell.
//

import SwiftUI

// MARK: - MotorHistoryWidget (the dashboard surface)

/// The composable Motor History dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/MotorHistoryWidget.tsx`. Renders torque + stator
/// temperature over time with a danger-zone band (and g-force overlays when wide),
/// across every web state, binding through `MotorHistoryModel` (P1/S8).
public struct MotorHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MotorHistoryWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "motor-history").
    public static let registration = DashboardWidgetRegistration(
        id: "motor-history",
        nameKey: "widget.motorHistory",
        descriptionKey: "widget.motorHistory.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MotorHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MotorHistoryModel,
        size: DashboardWidgetSize = MotorHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MotorHistoryWidget.registration.clamp(size)
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
        Text(verbatim: MotorHistoryStrings.string(key, fallback))
    }
}

// MARK: - Header

extension MotorHistoryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                tsText("widget.motorHistory.title", "Motor History")
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
            label = MotorHistoryStrings.string("widget.motorHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MotorHistoryStrings.string("widget.motorHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MotorHistoryStrings.string("widget.motorHistory.offline", "Offline")
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
        .accessibilityLabel(tsText("widget.motorHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                tsText("widget.motorHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(tsText("widget.motorHistory.openA11y", "Open the Motor History page"))
    }
}

// MARK: - Content states

extension MotorHistoryWidget {
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
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 70, height: 26, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 70, height: 26, cornerRadius: TSRadius.sm)
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(tsText("widget.motorHistory.loading", "Loading motor history"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                tsText("widget.motorHistory.noData", "No motor history")
            } icon: {
                Image(systemName: "gearshape.fill")
            }
        } description: {
            tsText("widget.motorHistory.emptyHint", "Drive to record motor torque and temperature.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            tsText("widget.motorHistory.errorTitle", "Couldn't load motor history")
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
                tsText("widget.motorHistory.retry", "Retry")
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
                MotorHistoryChart(
                    projection: model.projection,
                    showGForces: isWide,
                    showAxisTitles: isWide
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            statColumn(
                label: MotorHistoryStrings.string("widget.motorHistory.torque", "Torque"),
                value: MotorNumberFormat.decimal(model.projection.latestTorque, fractionDigits: 0),
                unit: MotorHistoryStrings.string("widget.motorHistory.torqueUnit", "Nm")
            )
            statColumn(
                label: MotorHistoryStrings.string("widget.motorHistory.statorTemp", "Stator"),
                value: MotorNumberFormat.decimal(model.projection.latestStatorTemp, fractionDigits: 0),
                unit: model.projection.temperatureUnitLabel
            )
            Spacer(minLength: 0)
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

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.motorHistory.offlineBanner" : "widget.motorHistory.staleBanner"
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

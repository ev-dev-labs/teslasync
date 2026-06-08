//
//  OdometerCounterWidget.swift
//  TeslaSync — P4 dashboard widget · 0070 · OdometerCounterWidget (Apple)
//
//  The composable Odometer Counter dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/OdometerCounterWidget.tsx. Binds through
//  `OdometerCounterModel` (no networking in the view); renders every state
//  (loading / empty / error / stale / offline / content) inside a glass shell.
//

import SwiftUI

// MARK: - OdometerCounterWidget (the dashboard surface)

/// The composable Odometer Counter dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/OdometerCounterWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through
/// `OdometerCounterModel` (P1/S8). No networking lives here.
public struct OdometerCounterWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "OdometerCounterWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "odometer-counter").
    public static let registration = DashboardWidgetRegistration(
        id: "odometer-counter",
        nameKey: "widget.odometer.name",
        descriptionKey: "widget.odometer.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )

    @State private var model: OdometerCounterModel
    private let layout: OdometerLayout

    public init(
        model: OdometerCounterModel,
        size: DashboardWidgetSize = OdometerCounterWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        layout = OdometerLayout.resolve(for: OdometerCounterWidget.registration.clamp(size))
    }

    private var isCompact: Bool {
        layout == .compact
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

// MARK: - Header (web `WidgetShell` chrome)

extension OdometerCounterWidget {
    /// The web hides the title in the compact (1×1) shell and shows only a freshness
    /// dot; the expanded shell shows the icon + "Odometer" title + freshness + refresh.
    @ViewBuilder
    private var header: some View {
        if isCompact {
            HStack(spacing: TSSpacing.xs) {
                Spacer(minLength: 0)
                freshnessChip
                refreshButton
            }
        } else {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                OdometerStrings.text("widget.odometer.title", "Odometer")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                freshnessChip
                refreshButton
            }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = OdometerStrings.string("widget.odometer.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = OdometerStrings.string("widget.odometer.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = OdometerStrings.string("widget.odometer.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if !isCompact {
                Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
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
        .accessibilityLabel(OdometerStrings.text("widget.odometer.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension OdometerCounterWidget {
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
            readyContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 90, height: 8, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 34, cornerRadius: TSRadius.md)
            if case .expanded(true) = layout {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                    TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(OdometerStrings.text("widget.odometer.loading", "Loading odometer"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                OdometerStrings.text("widget.odometer.noData", "No odometer data")
            } icon: {
                Image(systemName: "gauge.with.dots.needle.bottom.50percent")
            }
        } description: {
            OdometerStrings.text(
                "widget.odometer.emptyHint",
                "The odometer reading will appear once your vehicle reports it."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            OdometerStrings.text("widget.odometer.errorTitle", "Couldn't load odometer")
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
                OdometerStrings.text("widget.odometer.retry", "Retry")
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

    private var readyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                connectivityBanner
            }
            if isCompact {
                compactReadout
            } else {
                expandedReadout
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.odometer.offlineBanner" : "widget.odometer.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known reading"
            : "Reconnecting — reading may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            OdometerStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Compact (web `CompactView`)

    private var compactReadout: some View {
        VStack(spacing: TSSpacing.xs) {
            OdometerReadout(text: model.projection.odometerText, font: Font.TS.title)
            Text(verbatim: model.projection.unit)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: OdometerAccessibility.readoutLabel(for: model.projection)))
    }

    // MARK: Expanded (web `ExpandedView`)

    private var expandedReadout: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(spacing: TSSpacing.xs) {
                OdometerStrings.text("widget.odometer.total", "Total Odometer")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(Color.TS.textMuted)
                OdometerReadout(text: model.projection.odometerWithUnit, font: Font.TS.display)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: OdometerAccessibility.readoutLabel(for: model.projection)))

            if case .expanded(true) = layout {
                breakdownGrid
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    private var breakdownGrid: some View {
        HStack(spacing: TSSpacing.sm) {
            OdometerMetricTile(
                systemImage: "chart.line.uptrend.xyaxis",
                label: OdometerStrings.string("widget.odometer.totalDriven", "Total Driven"),
                value: model.projection.totalDrivenText,
                tone: Color.TS.statusSuccess
            )
            OdometerMetricTile(
                systemImage: "calendar",
                label: OdometerStrings.string("widget.odometer.unit", "Unit"),
                value: model.projection.unit,
                tone: Color.TS.statusWarning
            )
        }
    }
}

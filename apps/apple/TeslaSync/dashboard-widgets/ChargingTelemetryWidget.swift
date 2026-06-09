//
//  ChargingTelemetryWidget.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  The composable Charging Telemetry dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargingTelemetryWidget.tsx. Binds through
//  ChargingTelemetryModel (no networking in the view); renders every state
//  (loading / not-charging empty / error / stale / offline / charging content)
//  inside a glass widget shell, with compact, standard and wide layouts.
//

import SwiftUI

// MARK: - ChargingTelemetryWidget (the dashboard surface)

/// The composable Charging Telemetry dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargingTelemetryWidget.tsx`. Renders the live
/// charging metrics (voltage / current / power / phases / efficiency), the
/// charger-type badge and the rolling power sparkline while charging, and the
/// "Not currently charging" empty state otherwise. Binds through
/// `ChargingTelemetryModel` (P1/S8); no networking lives here.
public struct ChargingTelemetryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargingTelemetryWidget"

    /// Canonical registry metadata (registry/charging.ts → "charging-telemetry").
    public static let registration = DashboardWidgetRegistration(
        id: "charging-telemetry",
        nameKey: "widget.chargingTelemetry.title",
        descriptionKey: "widget.chargingTelemetry.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ChargingTelemetryModel
    @Environment(\.locale) private var locale
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargingTelemetryModel,
        size: DashboardWidgetSize = ChargingTelemetryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargingTelemetryWidget.registration.clamp(size)
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
        .accessibilityElement(children: .contain)
    }

    private var isCompact: Bool {
        ChargingTelemetryModel.isCompact(for: size)
    }

    private var isWide: Bool {
        ChargingTelemetryModel.isWide(for: size)
    }
}

// MARK: - Header

extension ChargingTelemetryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if !isCompact {
                ChargingTelemetryStrings.text("widget.chargingTelemetry.title", "Charging Telemetry")
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
            label = ChargingTelemetryStrings.string("widget.chargingTelemetry.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargingTelemetryStrings.string("widget.chargingTelemetry.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargingTelemetryStrings.string("widget.chargingTelemetry.offline", "Offline")
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
        .accessibilityLabel(ChargingTelemetryStrings.text("widget.chargingTelemetry.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargingTelemetryStrings.text("widget.chargingTelemetry.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            ChargingTelemetryStrings.text("widget.chargingTelemetry.openA11y", "Open the Charging page")
        )
    }
}

// MARK: - Content states

extension ChargingTelemetryWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            notChargingState
        case let .error(message):
            errorState(message)
        case .content:
            chargingContent
        }
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.sm) {
            if isCompact {
                TSSkeleton(height: 40, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                LazyVGrid(columns: skeletonColumns, spacing: TSSpacing.sm) {
                    ForEach(0 ..< (isWide ? 4 : 4), id: \.self) { _ in
                        TSSkeleton(height: 52, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            ChargingTelemetryStrings.text("widget.chargingTelemetry.loading", "Loading charging telemetry")
        )
    }

    private var notChargingState: some View {
        ContentUnavailableView {
            Label {
                ChargingTelemetryStrings.text("widget.chargingTelemetry.notCharging", "Not currently charging")
            } icon: {
                Image(systemName: "powerplug")
            }
        } description: {
            if !isCompact {
                ChargingTelemetryStrings.text(
                    "widget.chargingTelemetry.notChargingHint",
                    "Live voltage, current and power appear here while the vehicle is charging."
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            ChargingTelemetryStrings.text("widget.chargingTelemetry.errorTitle", "Couldn't load charging telemetry")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty, !isCompact {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                ChargingTelemetryStrings.text("widget.chargingTelemetry.retry", "Retry")
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

    @ViewBuilder
    private var chargingContent: some View {
        if isCompact {
            VStack(spacing: TSSpacing.xs) {
                if model.connection != .live { ChargingTelemetryConnectivityBanner(connection: model.connection) }
                ChargingTelemetryCompactIndicator(projection: model.projection, locale: locale)
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live { ChargingTelemetryConnectivityBanner(connection: model.connection) }
                statGrid
                if isWide { wideExtras }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var statGrid: some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.sm) {
            ForEach(model.projection.statKinds(wide: isWide), id: \.self) { kind in
                ChargingTelemetryStatCell(kind: kind, value: model.projection.formattedValue(for: kind, locale: locale))
            }
        }
    }

    @ViewBuilder
    private var wideExtras: some View {
        let hasBadge = model.projection.chargerType != nil
        let hasSparkline = model.powerHistory.count > 1
        if hasBadge || hasSparkline {
            HStack(spacing: TSSpacing.md) {
                if let type = model.projection.chargerType {
                    ChargingTelemetryChargerBadge(type: type)
                }
                if hasSparkline {
                    ChargingTelemetryPowerSparkline(samples: model.powerHistory)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.top, TSSpacing.xs)
            .overlay(alignment: .top) {
                Rectangle().fill(Color.TS.border).frame(height: 1)
            }
        }
    }

    private var statColumns: [GridItem] {
        let count = isWide ? 4 : 2
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: count)
    }

    private var skeletonColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2)
    }
}

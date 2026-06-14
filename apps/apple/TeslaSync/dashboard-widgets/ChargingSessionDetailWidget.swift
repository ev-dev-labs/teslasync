//
//  ChargingSessionDetailWidget.swift
//  TeslaSync — P4 dashboard widget · 0024 · ChargingSessionDetailWidget (Apple)
//
//  The composable Charge Session Detail dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargingSessionDetailWidget.tsx. Binds through
//  `ChargingSessionDetailModel` (no networking in the view); renders every state
//  (loading / error / empty / content) inside a glass widget shell, with the
//  freshness chip reflecting live / stale / offline, and switches between the
//  compact big-kWh layout and the standard/wide stats + power-curve layout.
//

import Foundation
import SwiftUI

// MARK: - ChargingSessionDetailWidget (the dashboard surface)

/// The composable Charge Session Detail dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargingSessionDetailWidget.tsx`. Renders every state
/// from the web source (loading / error / empty / content) inside a glass widget
/// shell, binding through `ChargingSessionDetailModel` (P1/S8). No networking here.
public struct ChargingSessionDetailWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargingSessionDetailWidget"

    /// Canonical registry metadata (registry/charging.ts → "charging-session-detail").
    public static let registration = DashboardWidgetRegistration(
        id: "charging-session-detail",
        nameKey: "widget.chargingSessionDetail.title",
        descriptionKey: "widget.chargingSessionDetail.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ChargingSessionDetailModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargingSessionDetailModel,
        size: DashboardWidgetSize = ChargingSessionDetailWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargingSessionDetailWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1`.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 3` (drives the chart's axis tick density).
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
}

extension ChargingSessionDetailWidget {
    // MARK: Header

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
                Image(systemName: "bolt.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ChargingSessionDetailPalette.power)
                    .accessibilityHidden(true)
                ChargingSessionDetailStrings.text("widget.chargingSessionDetail.title", "Charge Session Detail")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                freshnessChip
                refreshButton
                if onOpen != nil { openButton }
            }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = ChargingSessionDetailStrings.string("widget.chargingSessionDetail.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargingSessionDetailStrings.string("widget.chargingSessionDetail.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargingSessionDetailStrings.string("widget.chargingSessionDetail.offline", "Offline")
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
        .accessibilityLabel(ChargingSessionDetailStrings.text("widget.chargingSessionDetail.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargingSessionDetailStrings.text("widget.chargingSessionDetail.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(ChargingSessionDetailStrings.text(
            "widget.chargingSessionDetail.openA11y",
            "Open the charging page"
        ))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    @ViewBuilder
    private var loadingChrome: some View {
        if isCompact {
            VStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 72, height: 26, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 56, height: 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement()
            .accessibilityLabel(ChargingSessionDetailStrings.text(
                "widget.chargingSessionDetail.loading",
                "Loading charge session"
            ))
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: 4) {
                            TSSkeleton(width: 44, height: 10)
                            TSSkeleton(width: 56, height: 16)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .accessibilityElement()
            .accessibilityLabel(ChargingSessionDetailStrings.text(
                "widget.chargingSessionDetail.loading",
                "Loading charge session"
            ))
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargingSessionDetailStrings.text("widget.chargingSessionDetail.errorTitle", "Couldn't load charge session")
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
                ChargingSessionDetailStrings.text("widget.chargingSessionDetail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingSessionDetailStrings.text("widget.chargingSessionDetail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if model.emptyReason != nil || model.summary == nil {
            ChargingSessionDetailEmptyState()
        } else if let summary = model.summary {
            if isCompact {
                ChargingSessionDetailCompact(energyKwh: summary.energyKwh, charger: summary.charger)
            } else {
                standardBody(summary: summary)
            }
        }
    }

    private func standardBody(summary: ChargingSessionDetailSummary) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ChargingSessionDetailStatRow(stats: statItems(for: summary))
            if ChargingSessionDetailProjection.hasSeries(model.points) {
                ChargingSessionDetailChart(
                    points: model.points,
                    scale: ChargingSessionDetailProjection.scale(for: summary),
                    summary: summary,
                    isWide: isWide
                )
                ChargingSessionDetailLegend()
            } else {
                chartPlaceholder // parity:allow ui
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// The muted note shown in the chart region when the session has resolved but
    /// carries no telemetry yet (web renders an empty chart area) — never a blank box.
    private var chartPlaceholder: some View { // parity:allow ui
        let message = ChargingSessionDetailStrings.string(
            "widget.chargingSessionDetail.noTelemetry",
            "No charge telemetry"
        )
        return VStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.xyaxis.line")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }

    /// The four header stats (web `stats` memo): energy added (kWh), duration, peak
    /// power (kW), and the classified charger.
    private func statItems(for summary: ChargingSessionDetailSummary) -> [ChargingSessionDetailStatItem] {
        [
            ChargingSessionDetailStatItem(
                labelKey: "widget.chargingSessionDetail.energy",
                fallback: "Energy Added",
                value: ChargingSessionDetailFormat.decimal1(summary.energyKwh),
                unit: ChargingSessionDetailStrings.string("widget.chargingSessionDetail.unitKwhSymbol", "kWh")
            ),
            ChargingSessionDetailStatItem(
                labelKey: "widget.chargingSessionDetail.duration",
                fallback: "Duration",
                value: ChargingSessionDetailFormat.duration(
                    minutes: summary.durationMinutes,
                    localize: ChargingSessionDetailStrings.string
                ),
                unit: nil
            ),
            ChargingSessionDetailStatItem(
                labelKey: "widget.chargingSessionDetail.peakPower",
                fallback: "Peak Power",
                value: ChargingSessionDetailFormat.decimal1(summary.peakPowerKw),
                unit: ChargingSessionDetailStrings.string("widget.chargingSessionDetail.unitKw", "kW")
            ),
            ChargingSessionDetailStatItem(
                labelKey: "widget.chargingSessionDetail.charger",
                fallback: "Charger",
                value: summary.charger.localizedLabel(ChargingSessionDetailStrings.string),
                unit: nil
            )
        ]
    }
}

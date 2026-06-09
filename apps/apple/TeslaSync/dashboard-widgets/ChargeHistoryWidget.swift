//
//  ChargeHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  The composable Charge History dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargeHistoryWidget.tsx. Binds through
//  `ChargeHistoryChartModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - ChargeHistoryWidget (the dashboard surface)

/// The composable Charge History dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargeHistoryWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `ChargeHistoryChartModel` (P1/S8). No
/// networking lives here.
public struct ChargeHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargeHistoryWidget"

    /// Canonical registry metadata (registry/charging.ts → "charge-history").
    public static let registration = DashboardWidgetRegistration(
        id: "charge-history",
        nameKey: "widget.chargeHistory.title",
        descriptionKey: "widget.chargeHistory.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ChargeHistoryChartModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargeHistoryChartModel,
        size: DashboardWidgetSize = ChargeHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargeHistoryWidget.registration.clamp(size)
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
        .task(id: staleRefreshToken) { await autoRefreshWhenStale() }
        .accessibilityElement(children: .contain)
    }

    /// `true` when the widget is a single column (web `isCompact = size.cols <= 1`).
    private var isCompact: Bool {
        ChargeHistoryChartModel.isCompact(size)
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

extension ChargeHistoryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                ChargeHistoryStrings.text("widget.chargeHistory.title", "Charge History")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
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
            label = ChargeHistoryStrings.string("widget.chargeHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargeHistoryStrings.string("widget.chargeHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargeHistoryStrings.string("widget.chargeHistory.offline", "Offline")
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
        .accessibilityLabel(ChargeHistoryStrings.text("widget.chargeHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargeHistoryStrings.text("widget.chargeHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            ChargeHistoryStrings.text("widget.chargeHistory.openA11y", "Open the charging page")
        )
    }
}

// MARK: - Content states

extension ChargeHistoryWidget {
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
            historyContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 40, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 60, height: 14, cornerRadius: TSRadius.sm)
                    }
                }
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(ChargeHistoryStrings.text("widget.chargeHistory.loading", "Loading charge history"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                ChargeHistoryStrings.text("widget.noChargeHistory", "No charge sessions yet")
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        } description: {
            ChargeHistoryStrings.text(
                "widget.chargeHistory.emptyHint",
                "Charging history will appear here once your vehicle records a few sessions."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargeHistoryStrings.text("widget.chargeHistory.errorTitle", "Couldn't load charge history")
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
                ChargeHistoryStrings.text("widget.chargeHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.statusSuccess.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.statusSuccess)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content (stat header + area chart)

extension ChargeHistoryWidget {
    private var historyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !isCompact {
                ChargeHistoryAreaChart(
                    points: model.projection.points,
                    energyUnit: model.projection.energyUnit,
                    isWide: ChargeHistoryChartModel.isWide(size)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            statCell(
                labelKey: "widget.chargeHistory.total",
                labelFallback: "Total",
                value: ChargeHistoryFormat.number(model.projection.totalEnergy, decimals: 1),
                unit: model.projection.energyUnit
            )
            statCell(
                labelKey: "widget.chargeHistory.avg",
                labelFallback: "Avg",
                value: ChargeHistoryFormat.number(model.projection.avgEnergy, decimals: 1),
                unit: model.projection.energyUnit
            )
            Spacer(minLength: 0)
        }
    }

    private func statCell(labelKey: String, labelFallback: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ChargeHistoryStrings.text(labelKey, labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: statAccessibilityLabel(
                labelKey: labelKey,
                labelFallback: labelFallback,
                value: value,
                unit: unit
            ))
        )
    }

    private func statAccessibilityLabel(
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String
    ) -> String {
        let label = ChargeHistoryStrings.string(labelKey, labelFallback)
        return "\(label) \(value) \(unit)"
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.chargeHistory.offlineBanner"
            : "widget.chargeHistory.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved history"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargeHistoryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

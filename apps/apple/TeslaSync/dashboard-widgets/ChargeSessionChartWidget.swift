//
//  ChargeSessionChartWidget.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  The composable Charge Sessions dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargeSessionChartWidget.tsx. Binds through
//  `ChargeSessionChartModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - ChargeSessionChartWidget (the dashboard surface)

/// The composable Charge Sessions dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargeSessionChartWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `ChargeSessionChartModel`
/// (P1/S8). No networking lives here.
public struct ChargeSessionChartWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargeSessionChartWidget"

    /// Canonical registry metadata (registry/charging.ts → "charge-session-chart").
    public static let registration = DashboardWidgetRegistration(
        id: "charge-session-chart",
        nameKey: "widget.chargeSessionChart.title",
        descriptionKey: "widget.chargeSessionChart.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ChargeSessionChartModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargeSessionChartModel,
        size: DashboardWidgetSize = ChargeSessionChartWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargeSessionChartWidget.registration.clamp(size)
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

    /// `true` when the widget is a single 1×1 cell (web `isCompact`).
    private var isCompact: Bool {
        ChargeSessionChartModel.isCompact(size)
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

extension ChargeSessionChartWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                ChargeSessionStrings.text("widget.chargeSessionChart.title", "Charge Sessions")
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
            label = ChargeSessionStrings.string("widget.chargeSessionChart.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargeSessionStrings.string("widget.chargeSessionChart.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargeSessionStrings.string("widget.chargeSessionChart.offline", "Offline")
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
        .accessibilityLabel(ChargeSessionStrings.text("widget.chargeSessionChart.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargeSessionStrings.text("widget.chargeSessionChart.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            ChargeSessionStrings.text("widget.chargeSessionChart.openA11y", "Open the charging page")
        )
    }
}

// MARK: - Content states

extension ChargeSessionChartWidget {
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
            sessionsContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 48, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 64, height: 14, cornerRadius: TSRadius.sm)
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
        .accessibilityLabel(ChargeSessionStrings.text("widget.chargeSessionChart.loading", "Loading charge sessions"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                ChargeSessionStrings.text("widget.chargeSessionChart.empty", "No charge sessions yet")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            ChargeSessionStrings.text(
                "widget.chargeSessionChart.emptyHint",
                "Charging sessions will appear here once your vehicle charges."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargeSessionStrings.text("widget.chargeSessionChart.errorTitle", "Couldn't load charge sessions")
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
                ChargeSessionStrings.text("widget.chargeSessionChart.retry", "Retry")
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

// MARK: - Loaded content (stat header + bar chart)

extension ChargeSessionChartWidget {
    private var sessionsContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !isCompact {
                ChargeSessionChart(
                    bars: model.projection.bars,
                    energyUnit: model.projection.energyUnit,
                    isWide: ChargeSessionChartModel.isWide(size)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            statCell(
                labelKey: "widget.chargeSessionChart.total",
                labelFallback: "Total",
                value: ChargeSessionFormat.number(model.projection.totalEnergy, decimals: 1),
                unit: model.projection.energyUnit
            )
            statCell(
                labelKey: "widget.chargeSessionChart.avg",
                labelFallback: "Avg",
                value: ChargeSessionFormat.number(model.projection.avgEnergy, decimals: 1),
                unit: model.projection.energyUnit
            )
            statCell(
                labelKey: "widget.chargeSessionChart.sessions",
                labelFallback: "Sessions",
                value: String(model.projection.sessionCount),
                unit: nil
            )
            Spacer(minLength: 0)
        }
    }

    private func statCell(labelKey: String, labelFallback: String, value: String, unit: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ChargeSessionStrings.text(labelKey, labelFallback)
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
        unit: String?
    ) -> String {
        let label = ChargeSessionStrings.string(labelKey, labelFallback)
        if let unit {
            return "\(label) \(value) \(unit)"
        }
        return "\(label) \(value)"
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.chargeSessionChart.offlineBanner"
            : "widget.chargeSessionChart.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved sessions"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargeSessionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

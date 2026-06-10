//
//  EnergyStatsWidget.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  The composable Energy Stats dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/EnergyStatsWidget.tsx. Binds through
//  EnergyStatsModel (no networking in the view); renders every state inside a
//  glass widget shell across the compact (big-number) and standard/wide
//  (chart + stat grid) layouts.
//

import SwiftUI

// MARK: - EnergyStatsWidget (the dashboard surface)

/// The composable Energy Stats dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/EnergyStatsWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) across
/// the compact and standard/wide layouts inside a glass widget shell, binding
/// through `EnergyStatsModel` (P1/S8). No networking lives here.
public struct EnergyStatsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EnergyStatsWidget"

    /// Canonical registry metadata (registry/energy.ts → "energy-stats").
    public static let registration = DashboardWidgetRegistration(
        id: "energy-stats",
        nameKey: "widget.energyStats.title",
        descriptionKey: "widget.energyStats.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: EnergyStatsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: EnergyStatsModel,
        size: DashboardWidgetSize = EnergyStatsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = EnergyStatsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
        EnergyStatsModel.isCompact(for: size)
    }

    private var isWide: Bool {
        EnergyStatsModel.isWide(for: size)
    }

    /// Whether the title row is shown — the web renders a title only in the
    /// standard/wide layout (the compact shell is title-less, with the freshness
    /// indicator overlaid as a dot).
    private var showsTitle: Bool {
        !isCompact
    }
}

// MARK: - Header

extension EnergyStatsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if showsTitle {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesEnergy)
                    .accessibilityHidden(true)
                EnergyStatsStrings.text("widget.energyStats.title", "Energy Stats")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityAddTraits(.isHeader)
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
        switch model.freshness {
        case .fresh:
            tone = Color.TS.statusSuccess
            label = EnergyStatsStrings.string("widget.energyStats.fresh", "Updated")
        case .stale:
            tone = Color.TS.statusWarning
            label = EnergyStatsStrings.string("widget.energyStats.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = EnergyStatsStrings.string("widget.energyStats.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if showsTitle {
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
        .accessibilityLabel(EnergyStatsStrings.text("widget.energyStats.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                EnergyStatsStrings.text("widget.energyStats.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(EnergyStatsStrings.text("widget.energyStats.openA11y", "Open the Energy page"))
    }
}

// MARK: - Content states

extension EnergyStatsWidget {
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
            energyBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isCompact {
                TSSkeleton(height: 26, cornerRadius: TSRadius.sm).frame(width: 80)
                TSSkeleton(height: 10, cornerRadius: TSRadius.sm).frame(width: 40)
            } else {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity)
                HStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< (isWide ? 3 : 2), id: \.self) { _ in
                        TSSkeleton(height: 48, cornerRadius: TSRadius.md)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement()
        .accessibilityLabel(EnergyStatsStrings.text("widget.energyStats.loading", "Loading energy stats"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                EnergyStatsStrings.text("widget.energyStats.noData", "No energy data available")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            if !isCompact {
                EnergyStatsStrings.text(
                    "widget.energyStats.noDataHint",
                    "Energy usage will appear here once your vehicle reports drive and charge data."
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            EnergyStatsStrings.text("widget.energyStats.errorTitle", "Couldn't load energy stats")
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
                EnergyStatsStrings.text("widget.energyStats.retry", "Retry")
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

// MARK: - Content body (compact big-number / standard chart + stats)

extension EnergyStatsWidget {
    @ViewBuilder
    private var energyBody: some View {
        if isCompact {
            compactBody
        } else {
            standardBody
        }
    }

    /// Compact (1×2): the kWh headline only — web `AnimatedNumber value={total_wh/1000}`.
    private var compactBody: some View {
        VStack(spacing: 2) {
            if model.freshness != .fresh { freshnessBanner }
            Spacer(minLength: 0)
            TSAnimatedNumber(
                formatted: EnergyStatsFormat.compact(model.projection.compactKwh, prefs: model.prefs)
            )
            .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: model.prefs.energy.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(EnergyStatsStrings.text("widget.energyStats.title", "Energy Stats"))
        .accessibilityValue(Text(verbatim:
            "\(EnergyStatsFormat.compact(model.projection.compactKwh, prefs: model.prefs)) \(model.prefs.energy.label)"
        ))
    }

    /// Standard (2×4) / wide (3×4+): the daily-usage area chart over the stat grid.
    private var standardBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.freshness != .fresh { freshnessBanner }
            if model.projection.hasChartData {
                EnergyUsageChart(projection: model.projection, prefs: model.prefs, wide: isWide)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            EnergyStatGrid(stats: stats, columns: isWide ? 3 : 2)
        }
    }

    /// The stat-grid items (web `stats` memo). The standard layout shows four
    /// metrics; the wide layout appends Total Cost + Net Energy.
    private var stats: [EnergyStatItem] {
        let projection = model.projection
        let prefs = model.prefs
        let kg = EnergyStatsStrings.string("widget.energyStats.unitKg", "kg")

        var items: [EnergyStatItem] = [
            EnergyStatItem(
                id: "totalUsed",
                label: EnergyStatsStrings.string("widget.energyStats.totalUsed", "Total Used"),
                value: EnergyStatsFormat.energy(projection.totalEnergyUsedWh, prefs: prefs),
                systemImage: "bolt.fill"
            ),
            EnergyStatItem(
                id: "totalCharged",
                label: EnergyStatsStrings.string("widget.energyStats.totalCharged", "Total Charged"),
                value: EnergyStatsFormat.energy(projection.totalEnergyChargedWh, prefs: prefs),
                systemImage: "battery.100.bolt"
            ),
            EnergyStatItem(
                id: "avgEfficiency",
                label: EnergyStatsStrings.string("widget.energyStats.avgEfficiency", "Avg Efficiency"),
                value: EnergyStatsFormat.efficiency(projection.avgEfficiencyWhPerM, prefs: prefs),
                unit: prefs.efficiencyUnit,
                systemImage: "chart.line.uptrend.xyaxis"
            ),
            EnergyStatItem(
                id: "co2Saved",
                label: EnergyStatsStrings.string("widget.energyStats.co2Saved", "CO₂ Saved"),
                value: EnergyStatsFormat.number(
                    projection.co2SavedKg,
                    fractionDigits: 1,
                    locale: prefs.localeIdentifier
                ),
                unit: kg,
                systemImage: "leaf.fill"
            )
        ]

        if isWide {
            items.append(
                EnergyStatItem(
                    id: "totalCost",
                    label: EnergyStatsStrings.string("widget.energyStats.totalCost", "Total Cost"),
                    value: EnergyStatsFormat.cost(projection.totalCost, prefs: prefs),
                    unit: prefs.currencySymbol,
                    systemImage: "dollarsign"
                )
            )
            items.append(
                EnergyStatItem(
                    id: "netBalance",
                    label: EnergyStatsStrings.string("widget.energyStats.netBalance", "Net Energy"),
                    value: EnergyStatsFormat.energy(projection.netEnergyWh, prefs: prefs),
                    systemImage: "arrow.left.arrow.right"
                )
            )
        }

        return items
    }

    private var freshnessBanner: some View {
        let isOffline = model.freshness == .offline
        let key = isOffline ? "widget.energyStats.offlineBanner" : "widget.energyStats.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known stats"
            : "Data may be stale — refreshing"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            EnergyStatsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

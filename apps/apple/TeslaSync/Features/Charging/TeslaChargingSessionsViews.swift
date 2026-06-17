//
//  TeslaChargingSessionsViews.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Shared UI + panels
//
//  The shared HIG furniture (the `GlassPanel` peer, the section header, the
//  `StatCard` peer, the staleness chip) plus three panels: the business-account
//  info banner (web GlassPanel 1), the controls bar (web GlassPanel 2 — vehicle
//  `Select` + "Refresh from Tesla" `Button` + the 403 note + the last-sync stamp),
//  and the five summary `StatCard`s (Total Sessions / Energy / Cost / Avg Cost /
//  Peak Power). Materials stand in for the web glass (ADR-005); every
//  color/typography value comes from the generated design tokens (P2); every
//  string resolves from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web GlassPanel)

/// The frosted card that stands in for the web `GlassPanel`.
struct ChargingSessionsCard<Content: View>: View {
    var padding: CGFloat = TSSpacing.xl
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg)
                    .stroke(Color.TS.border, lineWidth: 1)
            )
    }
}

/// Section header for the chart / map / table panels (web `<h3>` heading).
struct ChargingSessionsSectionHeader: View {
    let systemImage: String
    let title: String
    var tone: Color = .TS.accent

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(title)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(title))
    }
}

// MARK: - StatCard (web data-display `StatCard`)

/// One summary stat tile (web `StatCard`): leading icon, big value (+ optional
/// unit), caption label, with a redacted skeleton while the slice loads.
struct ChargingSessionsStatCard: View {
    let label: String
    let value: String
    var unit: String?
    let systemImage: String
    let accent: Color
    var isLoading: Bool = false

    var body: some View {
        ChargingSessionsCard(padding: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(Font.TS.panel)
                    .foregroundStyle(accent)
                    .accessibilityHidden(true)
                if isLoading {
                    valueSkeleton
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                        Text(value)
                            .font(Font.TS.title)
                            .foregroundStyle(Color.TS.textPrimary)
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        if let unit {
                            Text(unit)
                                .font(Font.TS.body)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                }
                Text(label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityText))
    }

    private var accessibilityText: String {
        let suffix = unit.map { " \($0)" } ?? ""
        return "\(label): \(value)\(suffix)"
    }

    private var valueSkeleton: some View {
        Capsule()
            .fill(Color.TS.surface)
            .frame(width: 72, height: 22)
            .redacted(reason: .placeholder) // parity:allow native shimmer for the stat-card loading state
    }
}

// MARK: - Staleness chip (ADR-013)

/// Subtle chip surfaced when the last successful load is older than two minutes.
struct ChargingSessionsStalenessChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(String(localized: "translation.common.staleData", defaultValue: "Data may be out of date"))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel 1 — business-account info banner

/// The business-account info banner (web GlassPanel 1) — explains fleet session
/// data needs a Tesla business account (personal accounts get a 403 on sync).
struct ChargingSessionsBanner: View {
    var body: some View {
        ChargingSessionsCard(padding: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "building.2.fill")
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                Text(String(
                    localized: "translation.tesla_sessions.businessNote",
                    defaultValue: """
                    Fleet charging session data is only available for Tesla business \
                    accounts. Personal accounts will receive a 403 error when syncing.
                    """
                ))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel 2 — controls bar (vehicle Select + Refresh + 403 + last sync)

/// The controls bar (web GlassPanel 2): the vehicle `Picker`, the "Refresh from
/// Tesla" button (spinner + label while syncing), the 403 business-account note,
/// and the trailing last-sync stamp.
struct ChargingSessionsControlsBar: View {
    let options: [ChargingSessionsVehicleOption]
    let selectedVin: String
    let isRefreshing: Bool
    let showForbidden: Bool
    let errorMessage: String?
    let lastSyncedText: String?
    let onSelectVehicle: @Sendable (String) -> Void
    let onRefresh: @Sendable () -> Void

    private var vehicleBinding: Binding<String> {
        Binding(get: { selectedVin }, set: onSelectVehicle)
    }

    var body: some View {
        ChargingSessionsCard(padding: TSSpacing.lg) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: TSSpacing.md) { controls }
                VStack(alignment: .leading, spacing: TSSpacing.md) { controls }
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        vehiclePicker
        refreshButton
        if showForbidden {
            Text(String(
                localized: "translation.tesla_sessions.businessOnly",
                defaultValue: "Business account required"
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.statusWarning)
        }
        if let errorMessage {
            Text(errorMessage)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusDanger)
                .lineLimit(2)
        }
        Spacer(minLength: 0)
        if let lastSyncedText {
            Text(verbatim: "\(lastSyncLabel): \(lastSyncedText)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(options) { option in
                Text(option.label).tag(option.vin)
            }
        } label: {
            Text(verbatim: selectedLabel)
        }
        .pickerStyle(.menu)
        .accessibilityLabel(Text(String(
            localized: "translation.tesla_sessions.allVehicles",
            defaultValue: "All Vehicles"
        )))
    }

    private var refreshButton: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.sm) {
                if isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
                Text(isRefreshing ? refreshingLabel : refreshLabel)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(isRefreshing)
        .accessibilityLabel(Text(isRefreshing ? refreshingLabel : refreshLabel))
    }

    private var selectedLabel: String {
        options.first { $0.vin == selectedVin }?.label
            ?? String(localized: "translation.tesla_sessions.allVehicles", defaultValue: "All Vehicles")
    }

    private var refreshLabel: String {
        String(localized: "translation.tesla_sessions.refresh", defaultValue: "Refresh from Tesla")
    }

    private var refreshingLabel: String {
        String(localized: "translation.tesla_sessions.refreshing", defaultValue: "Syncing...")
    }

    private var lastSyncLabel: String {
        String(localized: "translation.tesla_sessions.lastSync", defaultValue: "Last synced")
    }
}

// MARK: - Summary stats row — five StatCards (Total Sessions / Energy / Cost / Avg / Peak)

/// The five summary `StatCard`s (web summary grid). Adaptive — five-up on macOS /
/// iPad, wrapping on iPhone — driven by the same `@Observable` summary.
struct ChargingSessionsSummaryRow: View {
    let summary: TeslaFleetChargingSummary
    let currencyCode: String
    let isLoading: Bool

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ChargingSessionsStatCard(
                label: String(localized: "translation.tesla_sessions.stats.sessions", defaultValue: "Total Sessions"),
                value: ChargingSessionsFormat.integer(summary.totalSessions),
                systemImage: "bolt.fill",
                accent: Color.TS.chartSeriesRegen,
                isLoading: isLoading
            )
            ChargingSessionsStatCard(
                label: String(localized: "translation.tesla_sessions.stats.energy", defaultValue: "Total Energy"),
                value: ChargingSessionsFormat.energyKWh(summary.totalWh, precision: 1),
                systemImage: "gauge.with.dots.needle.50percent",
                accent: Color.TS.chartSeriesEnergy,
                isLoading: isLoading
            )
            ChargingSessionsStatCard(
                label: String(localized: "translation.tesla_sessions.stats.cost_decimal", defaultValue: "Total Cost"),
                value: ChargingSessionsFormat.currency(summary.totalCost, code: currencyCode, fractionDigits: 2),
                systemImage: "dollarsign.circle.fill",
                accent: Color.TS.statusSuccess,
                isLoading: isLoading
            )
            ChargingSessionsStatCard(
                label: String(localized: "translation.tesla_sessions.stats.avgCost", defaultValue: "Avg Cost/kWh"),
                value: ChargingSessionsFormat.currency(summary.avgCostPerKwh, code: currencyCode, fractionDigits: 3),
                systemImage: "chart.line.uptrend.xyaxis",
                accent: Color.TS.chartSeriesPower,
                isLoading: isLoading
            )
            ChargingSessionsStatCard(
                label: String(localized: "translation.tesla_sessions.stats.peakPower", defaultValue: "Peak Power"),
                value: summary.peakPowerKw != nil
                    ? ChargingSessionsFormat.number(summary.peakPowerKw ?? 0, fractionDigits: 0)
                    : ChargingSessionsFormat.dash,
                unit: "kW",
                systemImage: "clock.fill",
                accent: Color.TS.statusWarning,
                isLoading: isLoading
            )
        }
    }
}

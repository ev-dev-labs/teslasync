//
//  ChargingTelemetrySection.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  The vehicle-detail "Charging Telemetry" section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx. Renders
//  the web source's bolt header + eight-tile metric grid (Charger Power / Voltage /
//  Current / Energy Added / Charging State / Battery Level / Charge Rate / Range
//  Added) inside a glass panel (web `<GlassPanel className="p-6">`), plus the P4 leaf
//  contract states. Binds through `ChargingTelemetrySectionModel` (P1/S8); no
//  networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton grid (web parent `isLoading`).
//    • empty    — telemetry resolved as null → friendly empty state (the web
//                 `EmptyState` "No charging telemetry available"), never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the eight-tile grid (each tile with its web em-dash fallback).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ChargingTelemetrySection (the feature surface)

/// The vehicle-detail "Charging Telemetry" section — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `ChargingTelemetrySectionModel`.
public struct ChargingTelemetrySection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChargingTelemetrySectionSurface.slug

    @State private var model: ChargingTelemetrySectionModel

    public init(model: ChargingTelemetrySectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }
}

// MARK: - Header (web `<Zap class="text-neon-green"/> Charging Telemetry` + freshness)

private extension ChargingTelemetrySection {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesBattery)
                .accessibilityHidden(true)
            Text(verbatim: ChargingTelemetrySectionStrings.string(
                "vehicles.detail.chargingTelemetry", "Charging Telemetry"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = ChargingTelemetrySectionStrings.string("chargingTelemetry.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargingTelemetrySectionStrings.string("chargingTelemetry.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargingTelemetrySectionStrings.string("chargingTelemetry.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: ChargingTelemetrySectionStrings.string(
            "chargingTelemetry.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? ChargingTelemetrySectionStrings.string(
                "chargingTelemetry.offlineBanner", "Offline — showing last known data"
            )
            : ChargingTelemetrySectionStrings.string(
                "chargingTelemetry.staleBanner", "Reconnecting — data may be stale"
            )
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web grid / EmptyState + the P4 leaf contract)

private extension ChargingTelemetrySection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            ChargingTelemetryLoadingView()
        case .empty:
            ChargingTelemetryEmptyView()
        case let .error(message):
            ChargingTelemetryErrorView(message: message) { model.refresh() }
        case .data:
            ChargingTelemetryGrid(metrics: model.metrics)
        }
    }
}

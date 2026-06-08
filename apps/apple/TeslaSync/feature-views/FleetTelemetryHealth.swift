//
//  FleetTelemetryHealth.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  The composable "Fleet Telemetry Health" admin devtools surface — the SwiftUI parity
//  of features/admin/components/devtools/FleetTelemetryHealth.tsx. Renders every state
//  from the web source (loading / empty / error / stale / offline / content) across the
//  two sections (Error VINs, Error Log) bound through `FleetHealthModel` (P1/S8). No
//  networking lives here; tapping a VIN filters the error log and the freshness chip +
//  banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable Fleet Telemetry Health devtools surface — the SwiftUI parity of
/// `features/admin/components/devtools/FleetTelemetryHealth.tsx`, binding through
/// `FleetHealthModel` (P1/S8). No networking lives here.
public struct FleetTelemetryHealth: View {
    @State private var model: FleetHealthModel

    public init(model: FleetHealthModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            freshnessHeader
            if model.connection != .live {
                FleetHealthConnectivityBanner(connection: model.connection)
            }
            errorVinsSection
            errorLogSection
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

private extension FleetTelemetryHealth {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            FleetHealthFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Error VINs section

private extension FleetTelemetryHealth {
    var errorVinsSection: some View {
        FleetHealthSectionCard(
            systemImage: "exclamationmark.triangle.fill",
            tone: .danger,
            titleKey: "devtools.health.errorVinsTitle",
            titleFallback: "Error VINs",
            descriptionKey: "devtools.health.errorVinsDesc",
            descriptionFallback: "Vehicles with fleet telemetry configuration errors"
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                vinActionRow
                vinContent
            }
        }
    }

    var vinActionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            FleetHealthCountBadge(count: model.vinRows.count)
            if let vin = model.selectedVin {
                FleetHealthFilterBadge(vin: vin) { model.clearVinFilter() }
            }
            FleetHealthRefreshButton(
                labelKey: "devtools.health.refreshVins",
                labelFallback: "Refresh from Tesla",
                isRefreshing: model.vinsRefreshing
            ) { model.refreshVINs() }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    var vinContent: some View {
        switch model.vinsPhase {
        case .loading:
            FleetHealthLoadingRows(rows: 3)
        case .empty:
            FleetHealthEmptyRow(
                key: "devtools.health.noErrorVins",
                fallback: "No vehicles with telemetry errors"
            )
        case let .error(message):
            errorState(message) { model.refreshVINs() }
        case .content:
            FleetHealthVINTable(rows: model.vinRows, selectedVin: model.selectedVin) { model.toggleVin($0) }
        }
    }
}

// MARK: - Error Log section

private extension FleetTelemetryHealth {
    var errorLogSection: some View {
        FleetHealthSectionCard(
            systemImage: "exclamationmark.circle.fill",
            tone: .warning,
            titleKey: "devtools.health.errorLogTitle",
            titleFallback: "Error Log",
            descriptionKey: "devtools.health.errorLogDesc",
            descriptionFallback: "Detailed fleet telemetry error history"
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    FleetHealthRefreshButton(
                        labelKey: "devtools.health.refreshErrors",
                        labelFallback: "Refresh from Tesla",
                        isRefreshing: model.errorsRefreshing
                    ) { model.refreshErrors() }
                    Spacer(minLength: 0)
                }
                errorLogContent
            }
        }
    }

    @ViewBuilder
    var errorLogContent: some View {
        switch model.errorsPhase {
        case .loading:
            FleetHealthLoadingRows(rows: 4)
        case .empty:
            FleetHealthEmptyRow(
                key: "devtools.health.noErrors",
                fallback: "No fleet telemetry errors recorded"
            )
        case let .error(message):
            errorState(message) { model.refreshErrors() }
        case .content:
            FleetHealthErrorTable(rows: model.errorRows)
        }
    }
}

// MARK: - Shared error state (QueryError equivalent)

private extension FleetTelemetryHealth {
    func errorState(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FleetHealthStrings.text("devtools.health.errorTitle", "Couldn't load telemetry health")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: retry) {
                FleetHealthStrings.text("devtools.health.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FleetHealthStrings.text("devtools.health.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

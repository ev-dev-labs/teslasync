//
//  TeslaChargingSessionsPage.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple)
//
//  SwiftUI / HIG parity of web/src/features/charging/pages/TeslaChargingSessionsPage.tsx
//  — fleet charging-session intelligence: a business-account banner, a vehicle +
//  refresh controls bar, five summary stat cards, a monthly-cost bar chart, a
//  session-locations map and a sortable, exportable sessions table. Adaptive across
//  macOS and iOS (ADR-002, ADR-006). Ten panels, two Swift Charts/MapKit surfaces,
//  the four data states, and every visible string from the catalog. Bound to
//  `TeslaChargingSessionsPageModel`; no business logic in the view body.
//

import SwiftUI

struct TeslaChargingSessionsPage: View {
    @State private var model = TeslaChargingSessionsPageModel()

    var body: some View {
        ScrollView {
            switch model.viewState {
            case .loading:
                loadingView
            case let .error(message):
                errorView(message)
            case .empty, .success:
                contentView
            }
        }
        .navigationTitle(String(localized: "translation.tesla_sessions.title", defaultValue: "Fleet Charging Sessions"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                rangeMenu
            }
        }
        .task { await model.load() }
        .refreshable { await model.refresh() }
    }

    // MARK: - Success / empty content (web PageContainer body)

    private var contentView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            subtitleHeader
            if model.isStale {
                ChargingSessionsStalenessChip()
            }
            ChargingSessionsBanner()
            ChargingSessionsControlsBar(
                options: model.vehicleOptions,
                selectedVin: model.selectedVin,
                isRefreshing: model.isRefreshing,
                showForbidden: model.refreshForbidden,
                errorMessage: model.refreshErrorMessage,
                lastSyncedText: model.lastSyncedText,
                onSelectVehicle: { vin in Task { await model.selectVehicle(vin) } },
                onRefresh: { Task { await model.refreshFromTesla() } }
            )
            ChargingSessionsSummaryRow(
                summary: model.summary,
                currencyCode: model.userCurrency,
                isLoading: false
            )
            ChargingSessionsMonthlyCostPanel(
                points: model.monthlyData,
                currencyCode: model.userCurrency,
                isLoading: false
            )
            ChargingSessionsMapPanel(
                sessions: model.mapPoints,
                userCurrency: model.userCurrency,
                isLoading: false
            )
            ChargingSessionsTable(
                rows: model.sortedSessions,
                userCurrency: model.userCurrency,
                sortKey: model.sortKey,
                sortDirection: model.sortDirection,
                isLoading: false,
                onSort: { key in model.sort(by: key) }
            )
        }
        .padding()
        .frame(maxWidth: 1200, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var subtitleHeader: some View {
        Text(String(
            localized: "translation.tesla_sessions.subtitle",
            defaultValue: "Detailed charging session data from Tesla (business accounts only)"
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
    }

    // MARK: - Toolbar (web actions RangePicker)

    private var rangeMenu: some View {
        Picker(selection: rangeBinding) {
            ForEach(ChargingSessionsRange.allCases) { range in
                Text(range.label).tag(range)
            }
        } label: {
            Label(model.selectedRange.label, systemImage: "calendar")
        }
        .pickerStyle(.menu)
        .accessibilityLabel(Text(String(
            localized: "translation.common.dateRange",
            defaultValue: "Date range"
        )))
    }

    private var rangeBinding: Binding<ChargingSessionsRange> {
        Binding(
            get: { model.selectedRange },
            set: { newRange in model.selectRange(newRange) }
        )
    }

    // MARK: - Loading state

    private var loadingView: some View {
        VStack(spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                ChargingSessionsCard {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        Text(String(
                            localized: "translation.tesla_sessions.title",
                            defaultValue: "Fleet Charging Sessions"
                        ))
                        .font(Font.TS.section)
                        Text(String(
                            localized: "translation.tesla_sessions.subtitle",
                            defaultValue: "Detailed charging session data from Tesla (business accounts only)"
                        ))
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding()
        .frame(maxWidth: 1200)
        .frame(maxWidth: .infinity)
        .redacted(reason: .placeholder) // parity:allow native shimmer for the page loading state
    }

    // MARK: - Error state

    private func errorView(_ message: String) -> some View {
        let prefix = String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
        return ContentUnavailableView {
            Label(
                String(localized: "translation.tesla_sessions.title", defaultValue: "Fleet Charging Sessions"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text("\(prefix): \(message)")
        } actions: {
            Button(String(localized: "translation.common.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

#Preview {
    NavigationStack {
        TeslaChargingSessionsPage()
    }
}

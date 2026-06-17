//
//  SoftwareUpdatesPage.swift
//  TeslaSync — P4 feature view · P7 · SoftwareUpdates (Apple)
//
//  SwiftUI / HIG parity of web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx
//  — track firmware versions and update history. Adaptive across macOS and iOS
//  (ADR-002, ADR-006). Five panels (current version · updates installed · total
//  updates · update-timeline container · per-update card), the four data states,
//  and every visible string from the catalog. Bound to `SoftwareUpdatesPageModel`;
//  no business logic in the body.
//

import SwiftUI

struct SoftwareUpdatesPage: View {
    @State private var model = SoftwareUpdatesPageModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                header
                if model.isStale {
                    SoftwareUpdatesStalenessChip()
                }
                if case let .error(message) = model.viewState {
                    errorBanner(message)
                }
                SoftwareUpdatesSummaryRow(
                    currentVersion: model.latestVersion,
                    installedCount: model.installedCount,
                    totalUpdates: model.totalUpdates
                )
                timelinePanel
            }
            .padding()
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(String(localized: "softwareUpdates.title", defaultValue: "Software Updates"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) { rangePicker }
            ToolbarItem(placement: .primaryAction) { vehiclePicker }
        }
        .task { await model.load() }
        .refreshable { await model.refresh() }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(String(localized: "Software Updates", defaultValue: "Software Updates"))
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(String(
                localized: "Track firmware versions and update history",
                defaultValue: "Track firmware versions and update history"
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Error banner (web `AlertBanner` danger)

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text("\(loadFailedText): \(message)")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.statusDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .stroke(Color.TS.statusDanger.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var loadFailedText: String {
        String(localized: "error.loadFailed", defaultValue: "Failed to load data")
    }

    // MARK: - Update timeline (GlassPanel 4 + GlassPanel 5)

    private var timelinePanel: some View {
        SoftwareUpdatesTimelinePanel(
            state: model.viewState,
            updates: model.updates,
            page: model.page,
            hasPreviousPage: model.hasPreviousPage,
            hasNextPage: model.hasNextPage,
            displayName: { model.displayName(for: $0) },
            onRetry: { Task { await model.refresh() } },
            onPrevious: { Task { await model.previousPage() } },
            onNext: { Task { await model.nextPage() } }
        )
    }

    // MARK: - Toolbar: vehicle selector (web `VehicleSelect`)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label(model.activeVehicleName, systemImage: "car.fill")
        }
        .pickerStyle(.menu)
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Toolbar: range selector (web `RangePicker`)

    private var rangePicker: some View {
        Picker(selection: rangeBinding) {
            ForEach(SoftwareUpdatesRangePreset.allCases) { preset in
                Text(preset.label).tag(preset)
            }
        } label: {
            Label(
                String(localized: "translation.Time Range", defaultValue: "Time Range"),
                systemImage: "calendar"
            )
        }
        .pickerStyle(.menu)
    }

    private var rangeBinding: Binding<SoftwareUpdatesRangePreset> {
        Binding(
            get: { model.rangePreset },
            set: { newValue in Task { await model.setRange(newValue) } }
        )
    }
}

#Preview {
    NavigationStack {
        SoftwareUpdatesPage()
    }
}

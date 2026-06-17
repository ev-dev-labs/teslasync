//
//  VehicleDetailPage.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleDetail (Apple) — Root view
//
//  Native SwiftUI / Apple HIG parity of `web/src/features/vehicles/pages/VehicleDetailPage.tsx`,
//  adaptive across macOS + iOS (ADR-002/006). One source of truth — the `@Observable`
//  `VehicleDetailPageModel` — drives the loading / empty / error / success states. The
//  vehicle header (with the wake action) sits above the per-vehicle settings panel
//  (GlassPanel1, bound through `useVehicleSettings` + `findEffectiveSetting`) and the
//  section navigator that reproduces every remaining web region inside its
//  `SectionErrorBoundary`. All copy resolves from `Localizable.xcstrings` with the web
//  key names; no networking lives in the view (ADR-004).
//

import SwiftUI

struct VehicleDetailPage: View {
    @State private var model: VehicleDetailPageModel
    private let onOpenSection: (VehicleDetailSectionKind) -> Void

    init(
        vehicleID: Int64,
        dataSource: any VehicleDetailDataSource = SampleVehicleDetailDataSource(),
        onOpenSection: @escaping (VehicleDetailSectionKind) -> Void = { _ in }
    ) {
        _model = State(initialValue: VehicleDetailPageModel(vehicleID: vehicleID, dataSource: dataSource))
        self.onOpenSection = onOpenSection
    }

    init(
        model: VehicleDetailPageModel,
        onOpenSection: @escaping (VehicleDetailSectionKind) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenSection = onOpenSection
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(navigationTitle)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
    }

    private var navigationTitle: Text {
        if let name = model.effectiveName, !name.isEmpty {
            return Text(verbatim: name)
        }
        return Text("translation.vehicles.detail.title")
    }

    // MARK: - Top-level state switch (web `vehicleLoading ? skeleton : body`)

    @ViewBuilder
    private var content: some View {
        if case .loading = model.state {
            VehicleDetailSkeleton()
        } else {
            loadedBody
        }
    }

    @ViewBuilder
    private var loadedBody: some View {
        if let feedback = model.wakeFeedback {
            VehicleDetailWakeBanner(feedback: feedback) {
                model.wakeFeedback = nil
            }
        }

        VehicleDetailSectionBoundary(kind: .header) {
            VehicleDetailHeader(
                name: model.effectiveName,
                vehicleID: model.vehicleID,
                isWaking: model.isWaking,
                onWake: { Task { await model.wake() } }
            )
        }

        settingsSection

        VehicleDetailSectionsOverview(onOpenSection: onOpenSection)
    }

    // MARK: - Settings region (GlassPanel1) across the data states

    @ViewBuilder
    private var settingsSection: some View {
        switch model.state {
        case let .success(payload):
            VehicleDetailSectionBoundary(kind: .settings) {
                VehicleDetailSettingsPanel(response: payload)
            }
        case .empty:
            VehicleDetailSectionBoundary(kind: .settings) {
                TSGlassPanel {
                    TSEmptyState(
                        title: "translation.vehicleSettings.title",
                        message: "translation.vehicleSettings.subtitle",
                        systemImage: "slider.horizontal.3"
                    )
                }
            }
        case let .error(message):
            VehicleDetailSectionBoundary(
                kind: .settings,
                hasError: true,
                errorMessage: message,
                onRetry: { Task { await model.refresh() } },
                content: { EmptyView() }
            )
        case .loading:
            EmptyView()
        }
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            VehicleDetailPage(vehicleID: 7)
        }
    }

    #Preview("Empty") {
        NavigationStack {
            VehicleDetailPage(vehicleID: 7, dataSource: EmptyVehicleDetailDataSource())
        }
    }

    #Preview("Error") {
        NavigationStack {
            VehicleDetailPage(vehicleID: 7, dataSource: FailingVehicleDetailDataSource())
        }
    }
#endif

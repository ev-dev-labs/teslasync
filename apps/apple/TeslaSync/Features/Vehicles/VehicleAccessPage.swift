//
//  VehicleAccessPage.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — Root view
//
//  Native SwiftUI / Apple HIG parity of `web/src/features/vehicles/pages/VehicleAccessPage.tsx`
//  (route `/vehicles/:id/access`), adaptive across macOS + iOS (ADR-002/006). One source of truth —
//  the `@Observable` `VehicleAccessPageModel` — drives the two panels and their loading / empty /
//  error / success states. The drivers panel (GlassPanel1) sits above the invitations panel
//  (GlassPanel2); the vehicle label (web breadcrumb) and the static subtitle head the screen. No
//  networking lives in the view (ADR-004); every visible string resolves from `Localizable.xcstrings`
//  with the web key names.
//

import SwiftUI

public struct VehicleAccessPage: View {
    @State private var model: VehicleAccessPageModel

    public init(
        vehicleID: Int64,
        dataSource: any VehicleAccessPageDataSource = SampleVehicleAccessPageDataSource()
    ) {
        _model = State(initialValue: VehicleAccessPageModel(vehicleID: vehicleID, dataSource: dataSource))
    }

    public init(model: VehicleAccessPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                VehicleAccessDriversSection(model: model)
                VehicleAccessInvitationsSection(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1_040, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(VehicleAccessPageStrings.title))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.driversState else { return }
                await model.load()
            }
            .alert(
                Text(String(localized: "translation.common.error", defaultValue: "Something went wrong")),
                isPresented: actionErrorPresented,
                presenting: model.actionError
            ) { _ in
                Button {
                    model.actionError = nil
                } label: {
                    Text(String(localized: "translation.common.ok", defaultValue: "OK"))
                }
            } message: { message in
                Text(verbatim: message)
            }
    }

    // MARK: - Header (web breadcrumb vehicle name + PageContainer subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: model.displayName)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: model.displayName))
            Text(VehicleAccessPageStrings.subtitle)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actionErrorPresented: Binding<Bool> {
        Binding(
            get: { model.actionError != nil },
            set: { presented in if !presented { model.actionError = nil } }
        )
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            VehicleAccessPage(vehicleID: 7)
        }
    }

    #Preview("Empty") {
        NavigationStack {
            VehicleAccessPage(vehicleID: 7, dataSource: EmptyVehicleAccessPageDataSource())
        }
    }

    #Preview("Error") {
        NavigationStack {
            VehicleAccessPage(vehicleID: 7, dataSource: FailingVehicleAccessPageDataSource())
        }
    }
#endif

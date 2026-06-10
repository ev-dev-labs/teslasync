//
//  VehicleHeader.Previews.swift
//  TeslaSync — P4 feature view · 0305 · VehicleHeader (Apple)
//
//  Xcode previews for each surface state (data / waking / loading / empty / error /
//  stale / offline) and a sweep of the status variants. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum VehicleHeaderPreviewData {
        static let modelS = VehicleHeaderVehicle(
            displayName: "Lightning",
            model: "Model S",
            trimBadging: "Plaid",
            vin: "5YJSA1E26MF000000"
        )

        static let model3 = VehicleHeaderVehicle(
            displayName: "Daily Driver",
            model: "Model 3",
            trimBadging: "Long Range",
            vin: "5YJ3E1EA7KF000000"
        )
    }

    @MainActor
    private func previewModel(_ input: VehicleHeaderInput) -> VehicleHeaderModel {
        let source = InMemoryVehicleHeaderSource(initial: input)
        let model = VehicleHeaderModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — driving") {
        VehicleHeader(model: previewModel(VehicleHeaderInput(
            vehicle: VehicleHeaderPreviewData.modelS,
            status: .driving
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Waking") {
        VehicleHeader(model: previewModel(VehicleHeaderInput(
            vehicle: VehicleHeaderPreviewData.model3,
            status: .online,
            waking: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Status sweep") {
        VStack(spacing: TSSpacing.md) {
            ForEach(VehicleHeaderStatus.allCases, id: \.self) { status in
                VehicleHeader(model: previewModel(VehicleHeaderInput(
                    vehicle: VehicleHeaderPreviewData.modelS,
                    status: status
                )))
            }
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleHeader(model: previewModel(VehicleHeaderInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleHeader(model: previewModel(VehicleHeaderInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleHeader(model: previewModel(VehicleHeaderInput(
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        VehicleHeader(model: previewModel(VehicleHeaderInput(
            vehicle: VehicleHeaderPreviewData.model3,
            status: .charging,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        VehicleHeader(model: previewModel(VehicleHeaderInput(
            vehicle: VehicleHeaderPreviewData.modelS,
            status: .asleep,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif

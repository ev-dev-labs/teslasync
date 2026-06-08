//
//  VehicleUpgradesWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / compact / up-to-date /
//  loading / empty / error / offline / stale). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: VehicleUpgradesUpdate) -> VehicleUpgradesModel {
        let source = InMemoryUpgradesSource(initial: update)
        let model = VehicleUpgradesModel(source: source)
        model.start()
        return model
    }

    private let previewEnvelope = UpgradeEnvelope.list([
        RawUpgrade(
            name: .text("Acceleration Boost"),
            price: .text("2000"),
            description: .text("0–60 mph in 3.7s"),
            eligible: true
        ),
        RawUpgrade(
            name: .text("Premium Connectivity"),
            price: .number(9.99),
            description: .text("Live traffic + satellite maps"),
            eligible: true
        ),
        RawUpgrade(
            name: .text("Full Self-Driving"),
            price: .text("12000"),
            description: .text("Autosteer on city streets"),
            eligible: false
        )
    ])

    private let previewShareLinks = [
        ShareLinkInput(id: "1", expiresAt: "2099-06-06T00:00:00Z"),
        ShareLinkInput(id: "2", expiresAt: "2099-07-01T00:00:00Z"),
        ShareLinkInput(id: "3", expiresAt: nil)
    ]

    private let previewFormat = UpgradesFormatting(
        currencySymbol: "$",
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    #Preview("Content (standard)") {
        VehicleUpgradesWidget(
            model: previewModel(
                VehicleUpgradesUpdate(
                    status: .loaded,
                    connection: .live,
                    envelope: previewEnvelope,
                    shareLinks: previewShareLinks,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 400)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        VehicleUpgradesWidget(
            model: previewModel(
                VehicleUpgradesUpdate(
                    status: .loaded,
                    envelope: previewEnvelope,
                    shareLinks: previewShareLinks,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 6)
        )
        .frame(width: 440, height: 400)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (count)") {
        VehicleUpgradesWidget(
            model: previewModel(
                VehicleUpgradesUpdate(
                    status: .loaded,
                    envelope: previewEnvelope,
                    shareLinks: previewShareLinks,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (up to date)") {
        VehicleUpgradesWidget(
            model: previewModel(
                VehicleUpgradesUpdate(
                    status: .loaded,
                    envelope: .none,
                    shareLinks: previewShareLinks,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleUpgradesWidget(model: previewModel(VehicleUpgradesUpdate(status: .loading)))
            .frame(width: 320, height: 400)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleUpgradesWidget(model: previewModel(VehicleUpgradesUpdate(status: .loaded)))
            .frame(width: 320, height: 400)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleUpgradesWidget(model: previewModel(VehicleUpgradesUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 400)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        VehicleUpgradesWidget(
            model: previewModel(
                VehicleUpgradesUpdate(
                    status: .loaded,
                    connection: .stale,
                    envelope: previewEnvelope,
                    shareLinks: previewShareLinks,
                    format: previewFormat,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 400)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        VehicleUpgradesWidget(
            model: previewModel(
                VehicleUpgradesUpdate(
                    status: .loaded,
                    connection: .offline,
                    envelope: previewEnvelope,
                    shareLinks: [],
                    format: previewFormat,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 400)
        .padding()
        .background(Color.TS.bg)
    }
#endif

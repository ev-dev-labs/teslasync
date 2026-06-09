//
//  VehicleAccessWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0106 · VehicleAccessWidget (Apple)
//
//  Xcode previews for each surface state (content full / content compact / partial / loading /
//  empty / error / stale / offline) and each layout. DEBUG-only; skipped by the host compile +
//  format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func vehicleAccessPreviewModel(_ update: VehicleAccessUpdate) -> VehicleAccessModel {
        let source = InMemoryVehicleAccessSource(initial: update)
        let model = VehicleAccessModel(source: source)
        model.start()
        return model
    }

    private let vehicleAccessSampleDrivers = [
        VehicleAccessDriverDTO(
            id: 1,
            driverName: "Alex Rivera",
            driverEmail: "alex@example.com",
            role: "owner",
            fetchedAt: "2024-06-09T12:00:00Z"
        ),
        VehicleAccessDriverDTO(
            id: 2,
            driverName: "Sam Chen",
            driverEmail: "sam@example.com",
            role: "driver",
            fetchedAt: "2024-05-28T09:30:00Z"
        )
    ]

    private let vehicleAccessSampleInvitations = [
        VehicleAccessInvitationDTO(
            id: 10,
            createdBy: "alex@example.com",
            status: "pending",
            createdAt: "2024-06-01T08:00:00Z"
        ),
        VehicleAccessInvitationDTO(
            id: 11,
            createdBy: "owner@example.com",
            status: "expired",
            createdAt: "2024-04-15T18:45:00Z"
        )
    ]

    private let vehicleAccessLoaded = VehicleAccessUpdate(
        status: .loaded,
        connection: .live,
        drivers: vehicleAccessSampleDrivers,
        invitations: vehicleAccessSampleInvitations,
        mobileEnabled: true,
        updatedAt: Date()
    )

    #Preview("Content (2×4)") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(vehicleAccessLoaded),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content compact (1×2)") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(
                    status: .loaded,
                    drivers: vehicleAccessSampleDrivers,
                    invitations: vehicleAccessSampleInvitations,
                    mobileEnabled: false,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 130)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — drivers only, mobile unknown") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(
                    status: .loaded,
                    drivers: vehicleAccessSampleDrivers,
                    invitations: [],
                    mobileEnabled: nil,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — no drivers, mobile only") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(
                    status: .loaded,
                    drivers: [],
                    invitations: [],
                    mobileEnabled: true,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(VehicleAccessUpdate(status: .loading)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — no access data") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(status: .loaded, drivers: [], invitations: [], mobileEnabled: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(status: .failed("Network unavailable"), isError: true)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (auto-refresh)") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    drivers: vehicleAccessSampleDrivers,
                    invitations: vehicleAccessSampleInvitations,
                    mobileEnabled: true,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        VehicleAccessWidget(
            model: vehicleAccessPreviewModel(
                VehicleAccessUpdate(
                    status: .loaded,
                    connection: .offline,
                    drivers: vehicleAccessSampleDrivers,
                    invitations: [],
                    mobileEnabled: true,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }
#endif

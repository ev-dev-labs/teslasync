//
//  SoftwareUpdateStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  Xcode previews for each surface state (up-to-date / available / downloading /
//  installing / ready / compact / loading / empty / error / stale / offline).
//  DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ snapshot: SoftwareStatusSnapshot) -> SoftwareStatusModel {
        let source = InMemorySoftwareStatusSource(initial: snapshot)
        let model = SoftwareStatusModel(source: source)
        model.start()
        return model
    }

    private let upToDateInput = SoftwareStatusInput(softwareVersion: "2024.8.10")

    private let availableInput = SoftwareStatusInput(
        softwareVersion: "2024.8.10",
        updateVersion: "2024.20.1"
    )

    private let downloadingInput = SoftwareStatusInput(
        softwareVersion: "2024.8.10",
        updateVersion: "2024.20.1",
        downloadPct: 47
    )

    private let installingInput = SoftwareStatusInput(
        softwareVersion: "2024.8.10",
        updateVersion: "2024.20.1",
        installPct: 62,
        expectedDurationMinutes: 15,
        scheduledStart: "Tonight, 2:00 AM"
    )

    private let readyInput = SoftwareStatusInput(
        softwareVersion: "2024.8.10",
        updateVersion: "2024.20.1",
        downloadPct: 100,
        expectedDurationMinutes: 25
    )

    #Preview("Up to date") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(status: .loaded, input: upToDateInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Available") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(status: .loaded, input: availableInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Downloading") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(status: .loaded, input: downloadingInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Installing (tall)") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(status: .loaded, input: installingInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready to install") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(status: .loaded, input: readyInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(status: .loaded, input: availableInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SoftwareUpdateStatusWidget(model: previewModel(SoftwareStatusSnapshot(status: .loading)))
            .frame(width: 300, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SoftwareUpdateStatusWidget(model: previewModel(SoftwareStatusSnapshot(status: .loaded)))
            .frame(width: 300, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SoftwareUpdateStatusWidget(
            model: previewModel(SoftwareStatusSnapshot(status: .failed("Network unavailable")))
        )
        .frame(width: 300, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(
                    status: .loaded,
                    connection: .stale,
                    input: downloadingInput,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SoftwareUpdateStatusWidget(
            model: previewModel(
                SoftwareStatusSnapshot(
                    status: .loaded,
                    connection: .offline,
                    input: upToDateInput,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif

//
//  DoorWindowStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  Xcode previews for each surface state (content / open / partial / compact /
//  loading / empty / error / offline / stale). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DoorWindowUpdate) -> DoorWindowModel {
        let source = InMemoryDoorWindowSource(initial: update)
        let model = DoorWindowModel(source: source)
        model.start()
        return model
    }

    private let securedInput = DoorWindowLatestInput(
        doorState: .text("AllClosed"),
        frontDriverWindow: .text("closed"),
        frontPassengerWindow: .text("closed"),
        rearDriverWindow: .text("closed"),
        rearPassengerWindow: .text("closed")
    )

    private let openedInput = DoorWindowLatestInput(
        doorState: .text("DriverFrontOpen,PassengerRearOpen"),
        frontDriverWindow: .text("vented"),
        frontPassengerWindow: .text("closed"),
        rearDriverWindow: .boolean(true),
        rearPassengerWindow: .text("closed")
    )

    private let partialInput = DoorWindowLatestInput(
        doorState: .text("AllClosed"),
        frontDriverWindow: .text("vented"),
        frontPassengerWindow: .text("partial"),
        rearDriverWindow: .text("closed"),
        rearPassengerWindow: .text("closed")
    )

    #Preview("Content — all closed") {
        DoorWindowStatusWidget(
            model: previewModel(
                DoorWindowUpdate(status: .loaded, connection: .live, latest: securedInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — doors & windows open") {
        DoorWindowStatusWidget(
            model: previewModel(
                DoorWindowUpdate(status: .loaded, connection: .live, latest: openedInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — partial windows") {
        DoorWindowStatusWidget(
            model: previewModel(
                DoorWindowUpdate(status: .loaded, connection: .live, latest: partialInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact badges (1×1 layout)") {
        VStack(spacing: TSSpacing.md) {
            DoorWindowCompactBadges(openDoorCount: 0, openWindowCount: 0)
            DoorWindowCompactBadges(openDoorCount: 2, openWindowCount: 1)
        }
        .frame(width: 180, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DoorWindowStatusWidget(model: previewModel(DoorWindowUpdate(status: .loading, latest: nil)))
            .frame(width: 340, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No door/window data") {
        DoorWindowStatusWidget(model: previewModel(DoorWindowUpdate(status: .loaded, latest: nil)))
            .frame(width: 340, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DoorWindowStatusWidget(
            model: previewModel(DoorWindowUpdate(status: .failed("Network unavailable"), latest: nil))
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DoorWindowStatusWidget(
            model: previewModel(
                DoorWindowUpdate(
                    status: .loaded,
                    connection: .offline,
                    latest: openedInput,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        DoorWindowStatusWidget(
            model: previewModel(
                DoorWindowUpdate(
                    status: .loaded,
                    connection: .stale,
                    latest: securedInput,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif

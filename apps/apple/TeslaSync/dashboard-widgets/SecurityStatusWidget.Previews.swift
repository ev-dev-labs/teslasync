//
//  SecurityStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0085 · SecurityStatusWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / open-doors / content). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SecurityUpdate) -> SecurityModel {
        let source = InMemorySecuritySource(initial: update)
        let model = SecurityModel(source: source)
        model.start()
        return model
    }

    private let securedInput = SecurityLatestInput(
        locked: true,
        sentryMode: true,
        doorState: .text("DriverFrontClosed,PassengerFrontClosed"),
        frontDriverWindow: .text("closed"),
        frontPassengerWindow: .text("closed"),
        rearDriverWindow: .text("closed"),
        rearPassengerWindow: .text("closed")
    )

    private let breachedInput = SecurityLatestInput(
        locked: false,
        sentryMode: false,
        doorState: .text("DriverFrontOpen,PassengerRearOpen"),
        frontDriverWindow: .text("vented"),
        frontPassengerWindow: .text("closed"),
        rearDriverWindow: .boolean(true),
        rearPassengerWindow: .text("closed")
    )

    #Preview("Content — secured") {
        SecurityStatusWidget(
            model: previewModel(
                SecurityUpdate(status: .loaded, connection: .live, latest: securedInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — doors & windows open") {
        SecurityStatusWidget(
            model: previewModel(
                SecurityUpdate(status: .loaded, connection: .live, latest: breachedInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        SecurityStatusWidget(
            model: previewModel(SecurityUpdate(status: .loaded, latest: securedInput)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SecurityStatusWidget(model: previewModel(SecurityUpdate(status: .loading, latest: nil)))
            .frame(width: 320, height: 200)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No security data") {
        SecurityStatusWidget(model: previewModel(SecurityUpdate(status: .loaded, latest: nil)))
            .frame(width: 320, height: 200)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SecurityStatusWidget(
            model: previewModel(SecurityUpdate(status: .failed("Network unavailable"), latest: nil))
        )
        .frame(width: 320, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SecurityStatusWidget(
            model: previewModel(
                SecurityUpdate(
                    status: .loaded,
                    connection: .offline,
                    latest: securedInput,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 320, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SecurityStatusWidget(
            model: previewModel(
                SecurityUpdate(
                    status: .loaded,
                    connection: .stale,
                    latest: breachedInput,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 200)
        .padding()
        .background(Color.TS.bg)
    }
#endif

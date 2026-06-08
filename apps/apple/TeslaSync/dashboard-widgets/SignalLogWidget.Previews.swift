//
//  SignalLogWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  Xcode previews for each surface state (content / paused / loading / empty /
//  error / stale / offline) plus the compact signals/sec big number. DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SignalLogUpdate) -> SignalLogModel {
        let source = InMemorySignalLogSource(initial: update)
        let model = SignalLogModel(source: source)
        model.start()
        return model
    }

    private func previewObservations(now: Date = Date()) -> [SignalObservationDTO] {
        [
            SignalObservationDTO(
                timestamp: now.addingTimeInterval(-4),
                signalName: "BatteryLevel",
                valueNumeric: 76.4,
                source: .fleetTelemetry
            ),
            SignalObservationDTO(
                timestamp: now.addingTimeInterval(-22),
                signalName: "VehicleSpeed",
                valueNumeric: 0,
                source: .fleetTelemetry
            ),
            SignalObservationDTO(
                timestamp: now.addingTimeInterval(-95),
                signalName: "ChargeState",
                valueText: "Charging",
                source: .fleetApi
            ),
            SignalObservationDTO(
                timestamp: now.addingTimeInterval(-260),
                signalName: "Locked",
                valueBool: true,
                source: .manual
            ),
            SignalObservationDTO(
                timestamp: now.addingTimeInterval(-1180),
                signalName: "Odometer",
                valueNumeric: 48211.2,
                source: .backfill
            )
        ]
    }

    private func previewUpdate(
        status: SignalLogStatus = .loaded,
        connection: SignalLogConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        updatedAt: Date? = Date()
    ) -> SignalLogUpdate {
        SignalLogUpdate(
            status: status,
            connection: connection,
            isFetching: isFetching,
            isError: isError,
            vehicleID: 1,
            observations: previewObservations(),
            signalRates: [4.2, 3.1, 1.6],
            updatedAt: updatedAt
        )
    }

    private let previewEmpty = SignalLogUpdate(status: .loaded, observations: [])

    #Preview("Content") {
        SignalLogWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SignalLogWidget(model: previewModel(previewUpdate(status: .loading, updatedAt: nil)))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SignalLogWidget(model: previewModel(previewEmpty))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SignalLogWidget(
            model: previewModel(
                SignalLogUpdate(status: .failed("Network unavailable"), isError: true, observations: [])
            )
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SignalLogWidget(
            model: previewModel(previewUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-240)))
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SignalLogWidget(
            model: previewModel(previewUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600)))
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact · signals/sec") {
        SignalLogBigNumber(rate: 9)
            .frame(width: 160, height: 160)
            .padding()
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .padding()
            .background(Color.TS.bg)
    }
#endif

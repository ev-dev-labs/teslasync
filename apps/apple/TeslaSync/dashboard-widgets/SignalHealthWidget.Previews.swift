//
//  SignalHealthWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0088 · SignalHealthWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / wide-with-list /
//  loading / empty / error / offline). DEBUG-only; excluded from the app target's
//  release build.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SignalHealthUpdate) -> SignalHealthModel {
        let source = InMemorySignalHealthSource(initial: update)
        let model = SignalHealthModel(source: source)
        model.start()
        return model
    }

    private let previewNow = Date(timeIntervalSince1970: 1_733_700_000)

    private func secondsAgo(_ seconds: TimeInterval) -> Date {
        previewNow.addingTimeInterval(-seconds)
    }

    /// 26 available signal names (web `useSignals` flat list) used as the
    /// "Total Signals" denominator.
    private let sampleSignalNames: [String] = [
        "VehicleSpeed", "BatteryLevel", "ChargeState", "Odometer", "Gear",
        "EstBatteryRange", "InsideTemp", "OutsideTemp", "TpmsPressureFl", "TpmsPressureFr",
        "TpmsPressureRl", "TpmsPressureRr", "Soc", "ChargeAmps", "ChargerVoltage",
        "ChargerPower", "DCChargingPower", "ACChargingPower", "Locked", "SentryMode",
        "FrontTrunk", "RearTrunk", "DriverSeatBelt", "Heading", "PowerState", "RatedRange"
    ]

    /// A live-signal map (web `useSignalGaps`) mixing fresh, stale, and
    /// no-timestamp gap entries so the coverage / health math is non-trivial.
    private let sampleLiveEntries: [String: SignalHealthLiveEntry] = [
        "VehicleSpeed": SignalHealthLiveEntry(timestamp: secondsAgo(4)),
        "BatteryLevel": SignalHealthLiveEntry(timestamp: secondsAgo(11)),
        "ChargeState": SignalHealthLiveEntry(timestamp: secondsAgo(2)),
        "Soc": SignalHealthLiveEntry(timestamp: secondsAgo(35)),
        "InsideTemp": SignalHealthLiveEntry(timestamp: secondsAgo(58)),
        "Odometer": SignalHealthLiveEntry(timestamp: secondsAgo(8 * 60)),
        "TpmsPressureFl": SignalHealthLiveEntry(timestamp: secondsAgo(12 * 60)),
        "Heading": SignalHealthLiveEntry(timestamp: secondsAgo(40 * 60)),
        "RatedRange": SignalHealthLiveEntry(timestamp: secondsAgo(3 * 3600)),
        "Gear": SignalHealthLiveEntry(timestamp: nil)
    ]

    private func contentUpdate(
        connection: SignalHealthConnection = .live,
        updatedAt: Date? = previewNow
    ) -> SignalHealthUpdate {
        SignalHealthUpdate(
            status: .loaded,
            connection: connection,
            signals: sampleSignalNames,
            liveEntries: sampleLiveEntries,
            statsAvailable: true,
            now: previewNow,
            updatedAt: updatedAt
        )
    }

    #Preview("Content") {
        SignalHealthWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 340, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        SignalHealthWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 3)
        )
        .frame(width: 170, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (gap list)") {
        SignalHealthWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 8),
            onOpen: {}
        )
        .frame(width: 520, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SignalHealthWidget(
            model: previewModel(SignalHealthUpdate(status: .loading)),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no data)") {
        SignalHealthWidget(
            model: previewModel(SignalHealthUpdate(status: .loaded, signals: nil, liveEntries: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SignalHealthWidget(
            model: previewModel(SignalHealthUpdate(status: .failed("Network unavailable"))),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SignalHealthWidget(
            model: previewModel(
                contentUpdate(connection: .offline, updatedAt: secondsAgo(1800))
            ),
            size: DashboardWidgetSize(cols: 4, rows: 8)
        )
        .frame(width: 520, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif

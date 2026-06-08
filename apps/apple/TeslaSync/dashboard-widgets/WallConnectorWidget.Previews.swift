//
//  WallConnectorWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0112 · WallConnectorWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / compact / no-data /
//  no-site / loading / error / offline / stale). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: WallConnectorUpdate) -> WallConnectorModel {
        let source = InMemoryWallConnectorSource(initial: update)
        let model = WallConnectorModel(source: source)
        model.start()
        return model
    }

    private let previewSite = WallConnectorSiteInput(energySiteID: 42)

    /// Two weeks of synthetic home-charging sessions: most nights add a moderate
    /// top-up, a couple of days are skipped, and one weekend has a big charge.
    private func previewHistory(now: Date = Date()) -> [WallConnectorEntryInput] {
        func session(_ daysAgo: Int, hour: Int, kwh: Double) -> WallConnectorEntryInput {
            let day = Calendar.current.date(byAdding: .day, value: -daysAgo, to: now) ?? now
            let stamp = Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
            return WallConnectorEntryInput(timestamp: stamp, energyWh: kwh * 1000)
        }
        return [
            session(13, hour: 23, kwh: 18.4),
            session(12, hour: 22, kwh: 12.1),
            session(11, hour: 1, kwh: 9.7),
            session(9, hour: 23, kwh: 22.6),
            session(8, hour: 0, kwh: 6.3),
            session(7, hour: 2, kwh: 41.2),
            session(6, hour: 23, kwh: 14.8),
            session(4, hour: 22, kwh: 11.0),
            session(3, hour: 1, kwh: 8.2),
            session(2, hour: 23, kwh: 19.9),
            session(1, hour: 0, kwh: 7.4),
            session(0, hour: 2, kwh: 16.5)
        ]
    }

    #Preview("Content (2×4)") {
        WallConnectorWidget(
            model: previewModel(
                WallConnectorUpdate(
                    status: .loaded,
                    connection: .live,
                    site: previewSite,
                    history: previewHistory(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        WallConnectorWidget(
            model: previewModel(
                WallConnectorUpdate(status: .loaded, site: previewSite, history: previewHistory(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        WallConnectorWidget(
            model: previewModel(
                WallConnectorUpdate(status: .loaded, site: previewSite, history: previewHistory())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 200, height: 130)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No Wall Connector data") {
        WallConnectorWidget(
            model: previewModel(WallConnectorUpdate(status: .loaded, site: previewSite, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No site linked") {
        WallConnectorWidget(
            model: previewModel(WallConnectorUpdate(status: .loaded, site: nil, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WallConnectorWidget(
            model: previewModel(WallConnectorUpdate(status: .loading, site: nil, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        WallConnectorWidget(
            model: previewModel(WallConnectorUpdate(status: .failed("Network unavailable"), site: previewSite))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        WallConnectorWidget(
            model: previewModel(
                WallConnectorUpdate(
                    status: .loaded,
                    connection: .offline,
                    site: previewSite,
                    history: previewHistory(),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        WallConnectorWidget(
            model: previewModel(
                WallConnectorUpdate(
                    status: .loaded,
                    connection: .stale,
                    site: previewSite,
                    history: previewHistory(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif

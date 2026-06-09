//
//  ChargePlansWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / rates-only /
//  loading / empty / error / offline / stale). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChargePlansUpdate) -> ChargePlansModel {
        let source = InMemoryChargePlansSource(initial: update)
        let model = ChargePlansModel(source: source)
        model.start()
        return model
    }

    /// A fixed reference instant so the scheduled-window states render deterministically.
    private let previewNow: Date =
        ISO8601DateFormatter().date(from: "2026-06-01T00:00:00Z") ?? Date()

    private let previewPlans: [ChargePlanInput] = [
        ChargePlanInput(
            id: 1,
            status: "scheduled",
            targetSoc: 80,
            departBy: "2026-06-02T07:30:00Z",
            scheduledStart: "2026-06-02T01:00:00Z",
            scheduledEnd: "2026-06-02T05:30:00Z",
            ratePlan: "PG&E EV2-A",
            estimatedKwh: 42.6,
            estimatedCost: 6.39,
            savings: 4.12
        )
    ]

    private let previewRates: [RatePlanInput] = [
        RatePlanInput(id: "EV2-A", name: "EV2-A Time-of-Use", utility: "PG&E"),
        RatePlanInput(id: "EV-B", name: "EV-B Legacy", utility: "SCE")
    ]

    private let previewFormat = ChargePlansFormatting(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles",
        currencySymbol: "$",
        currencyPrecision: 2
    )

    private func previewUpdate(
        status: ChargePlansLoadStatus = .loaded,
        connection: ChargePlansConnection = .live,
        plans: [ChargePlanInput] = previewPlans,
        rates: [RatePlanInput] = previewRates,
        ageSeconds: TimeInterval = 0
    ) -> ChargePlansUpdate {
        ChargePlansUpdate(
            status: status,
            connection: connection,
            plans: plans,
            rates: rates,
            format: previewFormat,
            updatedAt: previewNow.addingTimeInterval(-ageSeconds)
        )
    }

    #Preview("Content (standard)") {
        ChargePlansWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        ChargePlansWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 160, height: 170)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Rates only") {
        ChargePlansWidget(
            model: previewModel(previewUpdate(plans: [])),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargePlansWidget(model: previewModel(previewUpdate(status: .loading, plans: [], rates: [])))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargePlansWidget(model: previewModel(previewUpdate(status: .loaded, plans: [], rates: [])))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargePlansWidget(
            model: previewModel(previewUpdate(status: .failed("Network unavailable"), plans: [], rates: []))
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ChargePlansWidget(
            model: previewModel(previewUpdate(connection: .stale, ageSeconds: 180)),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargePlansWidget(
            model: previewModel(previewUpdate(connection: .offline, ageSeconds: 900)),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif

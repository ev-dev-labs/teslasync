//
//  SubscriptionsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  error / offline / stale). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SubscriptionsUpdate) -> SubscriptionsModel {
        let source = InMemorySubscriptionsSource(initial: update)
        let model = SubscriptionsModel(source: source)
        model.start()
        return model
    }

    /// A fixed reference instant so the expiry-derived states render deterministically.
    private let previewNow: Date =
        ISO8601DateFormatter().date(from: "2026-06-01T00:00:00Z") ?? Date()

    private let previewData: [String: SubscriptionsValue] = [
        "premium_connectivity": .bool(true),
        "premium_connectivity_expiry_date": .string("2026-09-15T00:00:00Z"),
        "premium_connectivity_renewal": .string("Auto-renew"),
        "full_self_driving": .bool(true),
        "full_self_driving_renewal": .string("Owned"),
        "standard_connectivity": .bool(true),
        "subscriptions": .array([
            .object([
                "name": .string("Satellite Connectivity"),
                "status": .string("expired"),
                "expiry_date": .string("2025-01-10T00:00:00Z")
            ])
        ])
    ]

    private let previewFormat = SubscriptionsFormatting(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    private func previewUpdate(
        status: SubscriptionsLoadStatus = .loaded,
        connection: SubscriptionsConnection = .live,
        withData: Bool = true,
        ageSeconds: TimeInterval = 0
    ) -> SubscriptionsUpdate {
        SubscriptionsUpdate(
            status: status,
            connection: connection,
            data: withData ? previewData : nil,
            format: previewFormat,
            now: previewNow,
            updatedAt: previewNow.addingTimeInterval(-ageSeconds)
        )
    }

    #Preview("Content (standard)") {
        SubscriptionsWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        SubscriptionsWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SubscriptionsWidget(model: previewModel(previewUpdate(status: .loading, withData: false)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SubscriptionsWidget(model: previewModel(previewUpdate(status: .loaded, withData: false)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SubscriptionsWidget(
            model: previewModel(previewUpdate(status: .failed("Network unavailable"), withData: false))
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SubscriptionsWidget(
            model: previewModel(previewUpdate(connection: .stale, ageSeconds: 180)),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SubscriptionsWidget(
            model: previewModel(previewUpdate(connection: .offline, ageSeconds: 900)),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif

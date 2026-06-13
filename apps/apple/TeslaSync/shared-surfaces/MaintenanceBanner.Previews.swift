//
//  MaintenanceBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  Xcode previews for each surface state (maintenance with a countdown, degraded, a maintenance window
//  ending now, the resolved no-banner empty, loading, error, stale, offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope. Each preview seeds its own dismissal store
//  so a dismissal in one preview never bleeds into another.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum MaintenancePreviewData {
        /// An RFC-3339 timestamp `seconds` from now — drives the live countdown in the previews.
        static func iso(secondsFromNow seconds: TimeInterval) -> String {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: Date().addingTimeInterval(seconds))
        }
    }

    @MainActor
    private func previewModel(_ input: MaintenanceBannerInput) -> MaintenanceBannerModel {
        let source = InMemoryMaintenanceBannerSource(initial: input)
        let model = MaintenanceBannerModel(
            source: source,
            dismissalStore: SessionMaintenanceBannerDismissalStore()
        )
        model.start()
        return model
    }

    #Preview("Maintenance — countdown") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(
            mode: "maintenance",
            message: "We're upgrading the telemetry pipeline.",
            until: MaintenancePreviewData.iso(secondsFromNow: 2 * 3600 + 17 * 60),
            updatedAt: "2026-06-13T04:00:00Z",
            hasData: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Degraded — default copy") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(
            mode: "degraded",
            updatedAt: "2026-06-13T04:10:00Z",
            hasData: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Maintenance — ending now") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(
            mode: "maintenance",
            message: "Final reboot in progress.",
            until: MaintenancePreviewData.iso(secondsFromNow: 0),
            updatedAt: "2026-06-13T04:20:00Z",
            hasData: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — operational") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(mode: "ok", hasData: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(
            errorMessage: "The status service is unavailable"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(
            mode: "maintenance",
            message: "Database migration window.",
            until: MaintenancePreviewData.iso(secondsFromNow: 45 * 60),
            updatedAt: "2026-06-13T04:30:00Z",
            hasData: true,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        MaintenanceBanner(model: previewModel(MaintenanceBannerInput(
            mode: "degraded",
            message: "Some integrations are slow.",
            updatedAt: "2026-06-13T04:40:00Z",
            hasData: true,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif

//
//  SummarySlide.Previews.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  Xcode previews for each surface state (content live / imperial / stale /
//  no-savings / empty / loading / offline-cached / offline-no-data / error).
//  DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SummarySlidePreviewData {
        static func populated(savings: Double = 2310) -> YearReviewSummary {
            YearReviewSummary(
                year: 2025,
                vehicle: YearReviewVehicle(id: 1, displayName: "Aurora", model: "Model 3 Performance"),
                totalDrives: 342,
                totalDistanceKm: 15234.5,
                totalEnergyKwh: 3120,
                totalChargeSessions: 88,
                co2OffsetKg: 1420,
                gasSavings: savings
            )
        }

        static func empty() -> YearReviewSummary {
            YearReviewSummary(
                year: 2025,
                vehicle: YearReviewVehicle(id: 1, displayName: "Aurora", model: "Model 3")
            )
        }
    }

    @MainActor
    private func previewModel(
        _ state: SummarySlideLoadState<YearReviewSummary>,
        distanceUnit: DistanceDisplayUnit = .kilometers
    ) -> SummarySlideModel {
        SummarySlideModel(previewState: state, distanceUnit: distanceUnit)
    }

    #Preview("Content · live · metric") {
        SummarySlide(model: previewModel(.loaded(SummarySlidePreviewData.populated(), stale: false)))
            .frame(width: 520, height: 640)
            .background(Color.TS.bg)
    }

    #Preview("Content · imperial") {
        SummarySlide(model: previewModel(
            .loaded(SummarySlidePreviewData.populated(), stale: false),
            distanceUnit: .miles
        ))
        .frame(width: 520, height: 640)
        .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        SummarySlide(model: previewModel(.loaded(SummarySlidePreviewData.populated(), stale: true)))
            .frame(width: 520, height: 640)
            .background(Color.TS.bg)
    }

    #Preview("Content · no savings") {
        SummarySlide(model: previewModel(.loaded(SummarySlidePreviewData.populated(savings: 0), stale: false)))
            .frame(width: 520, height: 640)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SummarySlide(model: previewModel(.loaded(SummarySlidePreviewData.empty(), stale: false)))
            .frame(width: 520, height: 480)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SummarySlide(model: previewModel(.idle))
            .frame(width: 520, height: 640)
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        SummarySlide(model: previewModel(
            .failed(.offline, cached: SummarySlidePreviewData.populated(), stale: true)
        ))
        .frame(width: 520, height: 640)
        .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        SummarySlide(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 520, height: 480)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SummarySlide(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 520, height: 480)
            .background(Color.TS.bg)
    }
#endif

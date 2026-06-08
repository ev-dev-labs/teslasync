//
//  XRayHeader.Previews.swift
//  TeslaSync — P4 feature view · 0035 · XRayHeader (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline) at both a compact (1-up) and a wide (3-up) width, so the
//  responsive `default: 1 / sm: 3` strip is exercised. DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: XRayHeaderUpdate) -> XRayHeaderModel {
        let source = InMemoryXRayHeaderSource(initial: update)
        let model = XRayHeaderModel(source: source)
        model.start()
        return model
    }

    private func previewSummary() -> IngestXRaySummary {
        IngestXRaySummary(totalSamples: 184_502, uniqueFields: 47, generatedAt: Date())
    }

    #Preview("Content (wide, 3-up)") {
        XRayHeader(
            model: previewModel(
                XRayHeaderUpdate(
                    status: .loaded,
                    connection: .live,
                    window: .h1,
                    summary: previewSummary(),
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 720)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact, 1-up)") {
        XRayHeader(
            model: previewModel(
                XRayHeaderUpdate(
                    status: .loaded,
                    connection: .live,
                    window: .m15,
                    summary: previewSummary(),
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        XRayHeader(
            model: previewModel(XRayHeaderUpdate(status: .loading, window: .h6, summary: nil))
        )
        .frame(width: 720)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no samples)") {
        XRayHeader(
            model: previewModel(
                XRayHeaderUpdate(
                    status: .loaded,
                    connection: .live,
                    window: .m5,
                    summary: IngestXRaySummary(totalSamples: 0, uniqueFields: 0, generatedAt: Date())
                )
            )
        )
        .frame(width: 720)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        XRayHeader(
            model: previewModel(
                XRayHeaderUpdate(status: .failed("The X-Ray endpoint timed out"), window: .h1, summary: nil)
            )
        )
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        XRayHeader(
            model: previewModel(
                XRayHeaderUpdate(
                    status: .loaded,
                    connection: .stale,
                    window: .h1,
                    summary: previewSummary(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 720)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        XRayHeader(
            model: previewModel(
                XRayHeaderUpdate(
                    status: .loaded,
                    connection: .offline,
                    window: .h24,
                    summary: previewSummary(),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 720)
        .padding()
        .background(Color.TS.bg)
    }
#endif

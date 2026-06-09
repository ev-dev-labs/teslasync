//
//  DriveTimeline.Previews.swift
//  TeslaSync — P4 feature view · 0140 · DriveTimeline (Apple)
//
//  Xcode previews for each surface state (content · completed / content · in-progress
//  / content · stale / loading / empty / offline · cached / offline · no data /
//  error). DEBUG-only; skipped by the swiftc host gate and release builds.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DriveTimelinePreviewData {
        /// A completed ~1h13m afternoon drive.
        static func completed() -> DriveTimelineDrive {
            let start = Date(timeIntervalSince1970: 1_717_500_000)
            return DriveTimelineDrive(
                startTs: start,
                endTs: start.addingTimeInterval(4380),
                durationS: 4380
            )
        }

        /// A still-running drive (no end timestamp → "In progress").
        static func inProgress() -> DriveTimelineDrive {
            let start = Date(timeIntervalSince1970: 1_717_500_000)
            return DriveTimelineDrive(startTs: start, endTs: nil, durationS: 1500)
        }
    }

    @MainActor
    private func previewModel(_ state: DriveTimelineLoadState<DriveTimelineDrive>) -> DriveTimelineModel {
        DriveTimelineModel(previewState: state)
    }

    #Preview("Content · completed") {
        DriveTimeline(model: previewModel(.loaded(DriveTimelinePreviewData.completed(), stale: false)))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · in-progress") {
        DriveTimeline(model: previewModel(.loaded(DriveTimelinePreviewData.inProgress(), stale: false)))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        DriveTimeline(model: previewModel(.loaded(DriveTimelinePreviewData.completed(), stale: true)))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DriveTimeline(model: previewModel(.idle))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DriveTimeline(model: previewModel(.empty(stale: false)))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        DriveTimeline(
            model: previewModel(.failed(.offline, cached: DriveTimelinePreviewData.completed(), stale: true))
        )
        .frame(width: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        DriveTimeline(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DriveTimeline(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 420)
            .padding()
            .background(Color.TS.bg)
    }
#endif

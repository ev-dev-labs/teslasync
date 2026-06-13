//
//  BackgroundWorkSegment.Previews.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  Xcode previews for each surface state (active many / active one / icon-only / loading / empty / error /
//  stale / offline) plus the running-jobs popover content. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope. The previews drive the in-memory source so every branch
//  renders without a network or real time.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ snapshot: BackgroundWorkSnapshot) -> BackgroundWorkSegmentModel {
        let source = InMemoryBackgroundWorkSource(initial: snapshot)
        let model = BackgroundWorkSegmentModel(source: source)
        model.start()
        return model
    }

    private let previewJobs: [BackgroundJob] = [
        BackgroundJob(
            id: "export:1", kind: .export, label: "drives-2026-06.csv",
            description: "Processing", startedAt: "2026-06-13T10:00:00Z"
        ),
        BackgroundJob(
            id: "tanstack-mutations", kind: .mutation, label: "Saving 2 changes…",
            startedAt: "2026-06-13T10:01:00Z"
        ),
        BackgroundJob(
            id: "backup", kind: .custom, label: "Generating backup",
            description: "Encrypting", startedAt: "2026-06-13T10:02:00Z"
        )
    ]

    #Preview("Active — many") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot(jobs: previewJobs)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Active — one") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot(jobs: [previewJobs[0]])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Active — icon only") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot(jobs: previewJobs)), iconOnly: true)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading — first probe") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — no jobs") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error — probe failed") {
        BackgroundWorkSegment(model: previewModel(
            BackgroundWorkSnapshot(errorMessage: "The /export/jobs request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale — poll failed") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot(jobs: previewJobs, connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline — last known") {
        BackgroundWorkSegment(model: previewModel(BackgroundWorkSnapshot(jobs: previewJobs, connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Popover — running jobs") {
        BackgroundWorkPopoverContent(
            data: BackgroundWorkData(jobs: previewJobs, count: previewJobs.count),
            connection: .stale,
            onRefresh: {}
        )
        .padding()
        .background(Color.TS.surface)
    }
#endif

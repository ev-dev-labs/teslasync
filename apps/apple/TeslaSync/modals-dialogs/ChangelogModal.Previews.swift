//
//  ChangelogModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  Xcode previews exercising every prompt-required state of the changelog through the in-memory source:
//  since-last-visit (the unseen subset since a seen version), first-visit (the whole history + welcome
//  subtitle), loading, empty, error, and the stale / offline freshness envelopes. Copy resolves through
//  the real per-surface table; the in-memory source keeps the previews network-free.
//

#if DEBUG
    import SwiftUI

    private enum ChangelogPreviewFactory {
        @MainActor
        static func model(_ update: ChangelogUpdate) -> ChangelogModel {
            ChangelogModel(source: InMemoryChangelogSource(initial: update))
        }
    }

    #Preview("Since last visit") {
        ChangelogModal(model: ChangelogPreviewFactory.model(.live(seenVersion: "0.5.0")))
            .frame(width: 480, height: 680)
    }

    #Preview("First visit") {
        ChangelogModal(model: ChangelogPreviewFactory.model(.live(seenVersion: nil)))
            .frame(width: 480, height: 680)
    }

    #Preview("Loading") {
        ChangelogModal(model: ChangelogPreviewFactory.model(ChangelogUpdate(status: .loading)))
            .frame(width: 480, height: 680)
    }

    #Preview("Empty") {
        ChangelogModal(model: ChangelogPreviewFactory.model(ChangelogUpdate(status: .loaded, entries: [])))
            .frame(width: 480, height: 680)
    }

    #Preview("Error") {
        ChangelogModal(model: ChangelogPreviewFactory.model(ChangelogUpdate(status: .failed("Network unavailable"))))
            .frame(width: 480, height: 680)
    }

    #Preview("Stale") {
        ChangelogModal(model: ChangelogPreviewFactory.model(.live(seenVersion: "0.6.0", connection: .stale)))
            .frame(width: 480, height: 680)
    }

    #Preview("Offline (cached)") {
        ChangelogModal(model: ChangelogPreviewFactory.model(.live(seenVersion: "0.6.0", connection: .offline)))
            .frame(width: 480, height: 680)
    }
#endif

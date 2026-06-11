//
//  GuardedLink.Previews.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  Xcode previews for each surface state (data clean, data dirty/guarded, empty, loading, error, stale,
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The
//  preview labels + sample guard messages are local sample data, not shipped UI copy.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func guardedLinkPreviewModel(_ input: GuardedLinkInput) -> GuardedLinkModel {
        let source = InMemoryNavigationGuardSource(initial: input)
        let model = GuardedLinkModel(source: source, navigator: RecordingGuardedNavigator())
        model.start()
        return model
    }

    private let guardedLinkPreviewDestination = GuardedDestination(path: "/automations")

    #Preview("Data — clean") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput(
            destination: guardedLinkPreviewDestination
        ))) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — dirty (guarded)") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput(
            destination: guardedLinkPreviewDestination,
            isDirty: true,
            guardMessage: "You have an unsaved alert rule."
        ))) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput())) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput(isLoading: true))) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput(
            errorMessage: "The guard registry is unavailable"
        ))) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput(
            destination: guardedLinkPreviewDestination,
            isDirty: true,
            connection: .stale
        ))) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        GuardedLink(model: guardedLinkPreviewModel(GuardedLinkInput(
            destination: guardedLinkPreviewDestination,
            connection: .offline
        ))) {
            Text(verbatim: "Open Automations")
        }
        .padding()
        .background(Color.TS.bg)
    }
#endif

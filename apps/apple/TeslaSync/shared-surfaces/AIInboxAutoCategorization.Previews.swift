//
//  AIInboxAutoCategorization.Previews.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  Xcode previews for each surface state (idle / streaming / proposal / empty / stream-error /
//  gate-loading / gate-error / stale / offline / gated-off). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: InboxCategoryInput,
        configure: ((InboxCategoryModel, InMemoryInboxCategorySource) -> Void)? = nil
    ) -> InboxCategoryModel {
        let source = InMemoryInboxCategorySource(initial: input)
        let model = InboxCategoryModel(source: source, onApply: { _ in })
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7)

    private let sampleBuckets: [InboxCategoryBucket] = [
        InboxCategoryBucket(
            category: "Battery & charging",
            count: 14,
            ruleIDs: [11, 12],
            sampleTitles: ["Charge interrupted", "Battery below 20%"]
        ),
        InboxCategoryBucket(category: "Tire pressure", count: 6, ruleIDs: [21]),
        InboxCategoryBucket(category: "Security", count: 3, ruleIDs: [31, 32, 33]),
        InboxCategoryBucket(category: "Climate", count: 2)
    ]

    #Preview("Idle / invite") {
        AIInboxAutoCategorization(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIInboxAutoCategorization(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal") {
        AIInboxAutoCategorization(model: previewModel(readyInput) { _, source in
            source.pushProposal(sampleBuckets)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty / no categories") {
        AIInboxAutoCategorization(model: previewModel(readyInput) { _, source in
            source.pushProposal([])
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIInboxAutoCategorization(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIInboxAutoCategorization(model: previewModel(
            InboxCategoryInput(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIInboxAutoCategorization(model: previewModel(
            InboxCategoryInput(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIInboxAutoCategorization(model: previewModel(
            InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7, connection: .stale)
        ) { _, source in
            source.pushProposal(sampleBuckets)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIInboxAutoCategorization(model: previewModel(
            InboxCategoryInput(gate: .on, vehicleID: 7, windowDays: 7, connection: .offline)
        ) { _, source in
            source.pushProposal(sampleBuckets)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated off") {
        AIInboxAutoCategorization(model: previewModel(InboxCategoryInput(gate: .off)))
            .padding()
            .background(Color.TS.bg)
    }
#endif
